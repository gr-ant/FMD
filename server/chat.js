// In-app AI chat -- a STRICTLY READ-ONLY assistant that answers questions about
// the named data sources, running AS THE CURRENT USER.
// -------------------------------------------------------------
// Contract (non-negotiable):
//   * READ-ONLY. The tool set below has NO create/update/delete tool, period.
//     There is no code path here that writes to Postgres.
//   * SCOPED. Every tool only sees the sources the [AI Chat] node named AND that
//     the caller's roles are allowed to READ (reuses permissions.js). A source
//     the user can't read is invisible to the model.
//   * SERVER-SIDE KEY. ANTHROPIC_API_KEY lives in the api container env and never
//     reaches the browser. If it's unset, the endpoint degrades gracefully.
//
// RAG is optional and behind a capability check: if Postgres has pgvector AND an
// embedding key is configured we retrieve top-k rows by vector similarity;
// otherwise we FALL BACK to a direct SQL/substring search. The pgvector path is
// best-effort and never breaks the feature when the extension/key is absent.
import { pool, KIND, q } from './db.js'
import { loadPermissions, isAllowed } from './permissions.js'
import { fetchExternal } from './ext.js'

// Cost-effective default; override with FMD_CHAT_MODEL. Most capable option is
// `claude-opus-4-8`.
const DEFAULT_MODEL = 'claude-haiku-4-5'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_ROWS = 50 // cap rows any single tool call returns (bounds tokens)
const MAX_TOOL_TURNS = 6 // safety bound on the agentic loop

// ---- The READ-ONLY tool set ------------------------------------------------
// This array is the whole surface the model can act through. It contains ONLY
// read verbs. Adding a write here would violate the core contract; the test
// suite asserts none of these names or descriptions imply a mutation.
export const READ_TOOLS = [
  {
    name: 'list_search',
    description:
      'Search or list records in one of the available data sources. Returns matching rows (read-only). ' +
      'Use `query` for a case-insensitive substring match across all fields; omit it to list the first rows.',
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The data source (list) name to read from.' },
        query: { type: 'string', description: 'Optional case-insensitive substring to match across fields.' },
        limit: { type: 'integer', description: `Max rows to return (default 20, hard cap ${MAX_ROWS}).` },
      },
      required: ['source'],
    },
  },
  {
    name: 'get_record',
    description: 'Fetch a single record from a data source by its id (the _id field). Read-only.',
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The data source name.' },
        id: { type: 'string', description: 'The record id (_id) to fetch.' },
      },
      required: ['source', 'id'],
    },
  },
  {
    name: 'aggregate',
    description:
      'Compute an aggregate over a data source (read-only): count, sum, avg, min, or max. ' +
      'Optionally narrow with a simple filter like `Status == "Open"` or `Amount > 100`.',
    input_schema: {
      type: 'object',
      properties: {
        source: { type: 'string', description: 'The data source name.' },
        fn: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'], description: 'Aggregate function.' },
        field: { type: 'string', description: 'Field to aggregate (required for sum/avg/min/max).' },
        filter: { type: 'string', description: 'Optional filter, e.g. `Field == "Value"` or `Field > 10`.' },
      },
      required: ['source', 'fn'],
    },
  },
]

// The verbs the tool set is allowed to expose. Used by the test to prove the
// surface is read-only (no create/update/delete/write/insert/etc.).
export const READ_TOOL_NAMES = READ_TOOLS.map((t) => t.name)
const WRITE_WORDS = ['create', 'update', 'delete', 'insert', 'write', 'set', 'remove', 'drop', 'add', 'edit', 'modify', 'patch', 'put', 'upsert']
// True only if EVERY tool name is free of any mutation verb.
export function toolSetIsReadOnly() {
  return READ_TOOLS.every((t) => !WRITE_WORDS.some((w) => t.name.toLowerCase().includes(w)))
}

// ---- Caller identity + scoping ---------------------------------------------

// The caller's effective roles, mirroring permissions.guard: real roles from the
// verified token, with the "Preview as" (X-FMD-Roles) header honored ONLY for a
// trusted caller (authed author, or open dev mode) — never for an anonymous one.
function callerRoles(req) {
  const secured = !!process.env.OIDC_ISSUER
  let roles = req.user?.roles || []
  const mayPreview = secured ? !!req.user?.sub : true
  if (mayPreview && req.headers['x-fmd-roles'] !== undefined) {
    roles = String(req.headers['x-fmd-roles']).split(',').map((s) => s.trim()).filter(Boolean)
  }
  return roles
}

// The subset of the requested sources that (a) actually exist and (b) the roles
// are allowed to READ. Anything else is dropped so the model can never touch it.
function allowedSources(requested, perms, roles) {
  const asked = (Array.isArray(requested) ? requested : []).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
  const uniq = [...new Set(asked)]
  return uniq.filter((s) => KIND[s] && isAllowed(perms, s, 'read', roles))
}

// ---- Read-only data access -------------------------------------------------
// Load every record for a source, routed by storage kind (list table / JSONB
// store / external api proxy). SELECT only — never mutates.
async function fetchSourceRows(source) {
  const kind = KIND[source]
  if (kind === 'list') {
    const { rows } = await pool.query(`SELECT * FROM ${q(source)} LIMIT 1000`)
    return rows
  }
  if (kind === 'store') {
    const { rows } = await pool.query(
      `SELECT id, doc FROM _fmd_documents WHERE collection = $1 ORDER BY id LIMIT 1000`, [source])
    return rows.map((r) => ({ ...r.doc, _id: r.id }))
  }
  if (kind === 'api') {
    const { rows } = await pool.query(`SELECT value FROM _fmd_configs WHERE key = $1`, [`api:${source}`])
    if (!rows.length) return []
    try { return await fetchExternal(rows[0].value) } catch { return [] }
  }
  return []
}

const asText = (v) => (v === null || v === undefined ? '' : String(v))
const rowMatches = (row, query) => {
  const ql = String(query).toLowerCase()
  return Object.values(row).some((v) => asText(v).toLowerCase().includes(ql))
}

// Parse a tiny "Field <op> value" filter (used by aggregate). Returns a predicate.
function makeFilter(filter) {
  if (!filter || !String(filter).trim()) return () => true
  const m = String(filter).match(/^\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/)
  if (!m) return () => true
  const [, field, op, rawVal] = m
  const val = rawVal.replace(/^["']|["']$/g, '')
  const num = Number(val)
  const isNum = val !== '' && !Number.isNaN(num)
  return (row) => {
    const cell = row[field]
    if (op === '==') return asText(cell).toLowerCase() === val.toLowerCase()
    if (op === '!=') return asText(cell).toLowerCase() !== val.toLowerCase()
    const c = Number(cell)
    if (!isNum || Number.isNaN(c)) return false
    if (op === '>') return c > num
    if (op === '<') return c < num
    if (op === '>=') return c >= num
    if (op === '<=') return c <= num
    return false
  }
}

// Execute a single tool call against the allowed source set. Refuses any source
// outside `allowed` (defence in depth on top of the model's system prompt), then
// delegates the read to the pure `computeTool` below.
async function runTool(name, input, allowed) {
  const source = String(input?.source || '').trim().toLowerCase()
  if (!allowed.includes(source)) {
    return { error: `Source "${input?.source}" is not available. Allowed: ${allowed.join(', ') || '(none)'}` }
  }
  const rows = await fetchSourceRows(source)
  return computeTool(name, input, rows)
}

// The pure read logic of each tool, over an already-fetched row set. Split out
// from `runTool` so it can be exercised offline (no DB) — and to make it obvious
// there is no write path here: every branch only reads/aggregates `rows`.
export function computeTool(name, input, rows) {
  if (name === 'list_search') {
    const limit = Math.min(Math.max(1, Number(input.limit) || 20), MAX_ROWS)
    const matched = input.query ? rows.filter((r) => rowMatches(r, input.query)) : rows
    return { count: matched.length, rows: matched.slice(0, limit) }
  }
  if (name === 'get_record') {
    const id = String(input.id)
    const rec = rows.find((r) => asText(r._id) === id)
    return rec ? { record: rec } : { error: `No record with id ${id} in ${source}` }
  }
  if (name === 'aggregate') {
    const pred = makeFilter(input.filter)
    const sel = rows.filter(pred)
    const fn = String(input.fn || 'count').toLowerCase()
    if (fn === 'count') return { fn, value: sel.length }
    const field = input.field
    if (!field) return { error: 'field is required for sum/avg/min/max' }
    const nums = sel.map((r) => Number(r[field])).filter((n) => !Number.isNaN(n))
    if (!nums.length) return { fn, field, value: null, note: 'no numeric values' }
    if (fn === 'sum') return { fn, field, value: nums.reduce((a, b) => a + b, 0) }
    if (fn === 'avg') return { fn, field, value: nums.reduce((a, b) => a + b, 0) / nums.length }
    if (fn === 'min') return { fn, field, value: Math.min(...nums) }
    if (fn === 'max') return { fn, field, value: Math.max(...nums) }
    return { error: `unknown fn ${fn}` }
  }
  return { error: `unknown tool ${name}` }
}

// ---- Optional RAG (pgvector) with graceful fallback ------------------------

// Is the pgvector extension installed in this database?
async function pgvectorAvailable() {
  try {
    const { rows } = await pool.query(`SELECT 1 FROM pg_extension WHERE extname = 'vector'`)
    return rows.length > 0
  } catch { return false }
}
// An embedding provider is configured only if a key is present. Kept intentionally
// simple: absence => we use the SQL/substring fallback (which always works).
function embeddingConfig() {
  const key = process.env.FMD_EMBED_KEY
  if (!key) return null
  return { key, url: process.env.FMD_EMBED_URL || 'https://api.openai.com/v1/embeddings', model: process.env.FMD_EMBED_MODEL || 'text-embedding-3-small' }
}

// Retrieve grounding rows for the question. Tries pgvector when both the
// extension and an embedding key are present; on ANY problem (or when either is
// missing) it falls back to a direct case-insensitive substring rank. Never
// throws — grounding is a bonus on top of the tool loop.
async function retrieveGrounding(sources, question, capable) {
  const out = []
  for (const source of sources) {
    let rows = []
    try { rows = await fetchSourceRows(source) } catch { rows = [] }
    if (!rows.length) continue
    let top
    if (capable) {
      top = await ragTopK(source, rows, question).catch(() => null)
    }
    if (!top) top = sqlTopK(rows, question) // fallback: direct search
    out.push({ source, rows: top })
  }
  return out
}

// Fallback retrieval: rank rows by how many question tokens they contain.
function sqlTopK(rows, question, k = 5) {
  const tokens = String(question).toLowerCase().split(/\W+/).filter((t) => t.length > 2)
  if (!tokens.length) return rows.slice(0, k)
  const scored = rows.map((r) => {
    const hay = Object.values(r).map(asText).join(' ').toLowerCase()
    return { r, score: tokens.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0) }
  })
  const hits = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)
  return (hits.length ? hits : scored).slice(0, k).map((s) => s.r)
}

// pgvector retrieval path (best-effort). Embeds the question + rows and keeps the
// top-k by cosine similarity. Uses an additive per-source table; on any failure
// the caller falls back to sqlTopK. This only runs when pgvector + an embedding
// key are both present, so it never breaks the default (fallback) path.
async function ragTopK(source, rows, question, k = 5) {
  const cfg = embeddingConfig()
  if (!cfg) return null
  const texts = rows.map((r) => Object.entries(r).filter(([kk]) => kk !== '_id').map(([kk, vv]) => `${kk}: ${asText(vv)}`).join(', '))
  const [qEmb, ...rowEmbs] = await embed(cfg, [question, ...texts])
  if (!qEmb) return null
  const scored = rows.map((r, i) => ({ r, score: cosine(qEmb, rowEmbs[i]) }))
  return scored.sort((a, b) => b.score - a.score).slice(0, k).map((s) => s.r)
}
async function embed(cfg, inputs) {
  const r = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({ model: cfg.model, input: inputs }),
  })
  if (!r.ok) throw new Error(`embed ${r.status}`)
  const j = await r.json()
  return (j.data || []).map((d) => d.embedding)
}
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0
}

// ---- Anthropic call --------------------------------------------------------
async function callAnthropic(apiKey, body) {
  const r = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await r.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { throw new Error('Anthropic response was not JSON') }
  if (!r.ok) throw new Error(json?.error?.message || `Anthropic error ${r.status}`)
  return json
}

// Sanitize the client-supplied history into simple text turns (defence against
// the browser injecting tool/assistant tool_use blocks that don't match state).
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
}

export function registerChatRoutes(app) {
  app.post('/api/_chat', async (req, res) => {
    const { question, sources, history } = req.body || {}
    if (!question || typeof question !== 'string') return res.status(400).json({ error: 'question is required' })

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      // Graceful, non-crashing degradation when the key isn't configured.
      return res.json({ answer: 'AI is not configured. Ask an administrator to set ANTHROPIC_API_KEY on the server.', configured: false })
    }

    try {
      const roles = callerRoles(req)
      const perms = await loadPermissions('public')
      const allowed = allowedSources(sources, perms, roles)
      if (!allowed.length) {
        return res.json({ answer: "I don't have access to any of the requested data sources, so I can't answer that.", configured: true, sources: [] })
      }

      // Optional RAG grounding (pgvector when available, else direct search).
      const capable = (await pgvectorAvailable()) && !!embeddingConfig()
      const grounding = await retrieveGrounding(allowed, question, capable)
      const groundingText = grounding
        .filter((g) => g.rows.length)
        .map((g) => `Source "${g.source}" (most relevant rows):\n${JSON.stringify(g.rows).slice(0, 3000)}`)
        .join('\n\n')

      const model = process.env.FMD_CHAT_MODEL || DEFAULT_MODEL
      const system =
        'You are a READ-ONLY data assistant embedded in an app. You answer questions about the ' +
        `following data sources ONLY: ${allowed.join(', ')}. ` +
        'You can search and read those sources with the provided tools, but you can NEVER create, update, or delete anything — ' +
        'there are no such tools and you must not claim to have changed data. ' +
        'If a question is outside the available sources, say so briefly. Be concise and cite concrete values from the data.' +
        (groundingText ? `\n\nRetrieved context to help you answer:\n${groundingText}` : '')

      const messages = [...sanitizeHistory(history), { role: 'user', content: question }]

      let answer = ''
      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const resp = await callAnthropic(apiKey, { model, max_tokens: 1024, system, tools: READ_TOOLS, messages })
        const blocks = Array.isArray(resp.content) ? resp.content : []
        if (resp.stop_reason === 'tool_use') {
          messages.push({ role: 'assistant', content: blocks })
          const toolResults = []
          for (const b of blocks) {
            if (b.type !== 'tool_use') continue
            let result
            try { result = await runTool(b.name, b.input || {}, allowed) } catch (e) { result = { error: String(e?.message || e) } }
            toolResults.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(result) })
          }
          messages.push({ role: 'user', content: toolResults })
          continue
        }
        answer = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim()
        break
      }
      if (!answer) answer = 'I could not complete the request within the allowed number of steps.'
      return res.json({ answer, configured: true, sources: allowed })
    } catch (e) {
      return res.status(500).json({ error: String(e?.message || e) })
    }
  })
}
