// External API data sources. An [API] source fetches records from a third-party
// REST API and returns them like any [List]/[Store] source. The secret API key is
// a SERVER-SIDE secret: it lives in `_fmd_configs` under `api:<source>` and is
// never returned to the browser or carried in the FMD document.
//
// Stored config shape (key `api:<source>`, source lowercased):
//   { url, auth, path, fields: [{ field, jsonPath }], key?, want?, auto? }
//   - auth: "bearer" | "header:HeaderName" | "query:ParamName"  (default "bearer")
//   - path: dot-path to the record ARRAY in the response (null = root / autoguess)
//   - fields: maps each FMD field name to a dot-path into each array item. When
//     EMPTY, the proxy passes through each item's own top-level fields.
//   - key: the secret, stored here, NEVER returned to clients
//   - want: optional natural-language hint of desired fields (guides AI mapping)
//   - auto: 'done' once AI (or the wizard) has derived path/fields, so it's cached
//
// "AI sets up the parsing": path + fields can be derived automatically on the
// server from a sample response (see aiDeriveMapping), using the Gemini key saved
// in _fmd_configs.ai — so an [API] source needs only a URL + key in the document.
import { pool, sendErr } from './db.js'

// Safe dot-path getter: getByPath(obj, "a.b.c"), supports array index "a.0.b".
export function getByPath(obj, path) {
  if (path === null || path === undefined || path === '') return obj
  let cur = obj
  for (const part of String(path).split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = cur[part]
  }
  return cur
}

// Common wrapper keys an API might nest its record array under.
const WRAPPERS = ['data', 'results', 'items', 'records']

// Pull the record array out of a parsed JSON response.
//   - explicit path  -> getByPath
//   - response is an array -> use it
//   - else try the common wrapper keys that hold an array
//   - else []
export function extractArray(json, path) {
  if (path) {
    const v = getByPath(json, path)
    return Array.isArray(v) ? v : []
  }
  if (Array.isArray(json)) return json
  if (json && typeof json === 'object') {
    for (const k of WRAPPERS) if (Array.isArray(json[k])) return json[k]
  }
  return []
}

// Best-guess the dot-path to an array within a parsed response (for the wizard).
// Returns "" if the response is itself the array, a wrapper key, or null.
function guessArrayPath(json) {
  if (Array.isArray(json)) return ''
  if (json && typeof json === 'object') {
    for (const k of WRAPPERS) if (Array.isArray(json[k])) return k
    // Shallow scan for any array-valued property.
    for (const [k, v] of Object.entries(json)) if (Array.isArray(v)) return k
    // One level deeper (e.g. "data.items").
    for (const [k, v] of Object.entries(json)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k2, v2] of Object.entries(v)) if (Array.isArray(v2)) return `${k}.${k2}`
      }
    }
  }
  return null
}

// Build the request {url, headers} from cfg.auth + cfg.key. The key is applied as
// a Bearer token, a custom header, or a query param depending on `auth`.
function buildRequest(cfg) {
  const auth = String(cfg.auth || 'bearer')
  const key = cfg.key || ''
  let url = String(cfg.url || '')
  const headers = { Accept: 'application/json' }
  if (key) {
    if (auth.startsWith('header:')) {
      headers[auth.slice('header:'.length) || 'Authorization'] = key
    } else if (auth.startsWith('query:')) {
      const param = auth.slice('query:'.length) || 'key'
      url += (url.includes('?') ? '&' : '?') + `${encodeURIComponent(param)}=${encodeURIComponent(key)}`
    } else {
      headers.Authorization = `Bearer ${key}`
    }
  }
  return { url, headers }
}

// Fetch + parse an external API into a parsed JSON value. Throws { status, body }
// on a network/parse/non-2xx error.
async function fetchJson(cfg) {
  const { url, headers } = buildRequest(cfg)
  let r
  try {
    r = await fetch(url, { headers })
  } catch (e) {
    throw { status: 502, body: `fetch failed: ${e?.message || String(e)}` }
  }
  const text = await r.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { throw { status: 502, body: 'response was not JSON' } }
  if (!r.ok) throw { status: r.status, body: json }
  return json
}

// Turn an array of raw items into FMD records. With explicit `fields`, each
// record is { ...field: getByPath(item, jsonPath), _id }. With NO fields
// (nothing configured yet), we PASS THROUGH each item's own top-level scalar
// properties — so an [API] source works immediately, before/without AI mapping.
export function mapRecords(arr, fields) {
  const fs = Array.isArray(fields) ? fields.filter((f) => f && f.field) : []
  if (fs.length) {
    return arr.map((item, i) => {
      const rec = { _id: i }
      for (const f of fs) rec[f.field] = getByPath(item, f.jsonPath)
      return rec
    })
  }
  return arr.map((item, i) => {
    const rec = { _id: i }
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      for (const [k, v] of Object.entries(item)) if (v === null || typeof v !== 'object') rec[k] = v
    } else {
      rec.value = item
    }
    return rec
  })
}

// Fetch + parse an external API, returning the mapped records array. Throws
// { status, body } on a network/parse/non-2xx error.
export async function fetchExternal(cfg) {
  const json = await fetchJson(cfg)
  return mapRecords(extractArray(json, cfg.path), cfg.fields)
}

// Read any _fmd_configs value (e.g. the saved Gemini settings under 'ai').
async function readConfigValue(key) {
  const { rows } = await pool.query(`SELECT value FROM _fmd_configs WHERE key = $1`, [key])
  return rows.length ? rows[0].value : null
}

function parseJsonLoose(t) {
  if (!t) return null
  try { return JSON.parse(t) } catch { /* fall through */ }
  const m = String(t).match(/\{[\s\S]*\}/)
  if (m) { try { return JSON.parse(m[0]) } catch { /* fall through */ } }
  return null
}

// Ask the saved Gemini model to derive { path, fields } from a sample response —
// this is the "let AI set up the parsing" step, run entirely on the server using
// the key stored in _fmd_configs.ai. `want` is an optional natural-language hint
// of which fields the user cares about. Returns null if no AI key / on failure.
async function aiDeriveMapping(json, want) {
  const ai = await readConfigValue('ai')
  if (!ai || !ai.apiKey) return null
  const model = ai.model || 'gemini-2.0-flash'
  let s = JSON.stringify(json)
  if (s.length > 8000) s = s.slice(0, 8000)
  const wantLine = want
    ? `The user wants these fields (map each to the closest available data): ${want}.`
    : 'Pick the most useful fields for displaying these records.'
  const prompt = `You are configuring how an app reads records from a JSON API response.
Reply with ONLY a JSON object of the form:
{"path":"<dot-path to the array of records; empty string if the response IS the array>","fields":[{"field":"<Nice Title Case Name>","jsonPath":"<dot-path within one record>"}]}
${wantLine} Use 3-12 fields. jsonPath may be nested (e.g. "company.name").
Sample response:
${s}`
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(ai.apiKey)}`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    })
  } catch { return null }
  if (!res.ok) return null
  let data
  try { data = await res.json() } catch { return null }
  const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  const parsed = parseJsonLoose(txt)
  if (!parsed || !Array.isArray(parsed.fields)) return null
  const fields = parsed.fields
    .filter((f) => f && f.field && f.jsonPath)
    .map((f) => ({ field: String(f.field), jsonPath: String(f.jsonPath) }))
  if (!fields.length) return null
  return { path: typeof parsed.path === 'string' ? parsed.path : '', fields }
}

// Read the stored config for a source (key `api:<source>`), or null.
async function readApiConfig(source) {
  const { rows } = await pool.query(`SELECT value FROM _fmd_configs WHERE key = $1`, [`api:${String(source).toLowerCase()}`])
  return rows.length ? rows[0].value : null
}

// Merge a partial config into `api:<source>`, creating the row if missing. Used
// to persist the secret key without disturbing the rest of the config.
async function mergeApiConfig(source, patch) {
  await pool.query(
    `INSERT INTO _fmd_configs (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = _fmd_configs.value || EXCLUDED.value, updated_at = now()`,
    [`api:${String(source).toLowerCase()}`, JSON.stringify(patch)])
}

export function registerExtRoutes(app) {
  // Canonical read path: fetch + map the external source's records. If no field
  // mapping has been configured yet, auto-configure it once via AI (cached), so
  // the source "just works" from only a URL + key. Falls back to passthrough.
  app.get('/api/_ext/:source', async (req, res) => {
    try {
      let cfg = await readApiConfig(req.params.source)
      if (!cfg) return res.status(404).json({ error: 'no api config for source' })
      const unmapped = !Array.isArray(cfg.fields) || !cfg.fields.length
      if (unmapped && cfg.url && cfg.auto !== 'done') {
        const json = await fetchJson(cfg)
        const ai = await aiDeriveMapping(json, cfg.want)
        if (ai) {
          await mergeApiConfig(req.params.source, { path: ai.path, fields: ai.fields, auto: 'done' })
          cfg = { ...cfg, path: ai.path, fields: ai.fields }
        }
        return res.json(mapRecords(extractArray(json, cfg.path), cfg.fields))
      }
      res.json(await fetchExternal(cfg))
    } catch (e) { sendErr(res, e) }
  })

  // "Auto-configure": persist any provided url/auth/key/want, then fetch a sample
  // and let AI derive the array path + field mappings on the server (cached).
  // Returns the detected fields + a small preview. Falls back to passthrough when
  // no AI key is set. This is the one-tap setup the wizard calls.
  app.post('/api/_ext/:source/_auto', async (req, res) => {
    try {
      const { url, auth, key, want } = req.body || {}
      const patch = {}
      if (typeof url === 'string' && url) patch.url = url
      if (typeof auth === 'string' && auth) patch.auth = auth
      if (typeof key === 'string' && key) patch.key = key
      if (typeof want === 'string') patch.want = want
      if (Object.keys(patch).length) await mergeApiConfig(req.params.source, patch)

      const cfg = await readApiConfig(req.params.source)
      if (!cfg || !cfg.url) return res.status(400).json({ error: 'a URL is required' })

      const json = await fetchJson(cfg)
      const ai = await aiDeriveMapping(json, cfg.want)
      const path = ai ? ai.path : (guessArrayPath(json) || '')
      const fields = ai ? ai.fields : []
      await mergeApiConfig(req.params.source, { path, fields, auto: 'done' })

      const arr = extractArray(json, path)
      const preview = mapRecords(arr.slice(0, 5), fields)
      // when passthrough, report the discovered column names so the UI can show them
      const shown = fields.length
        ? fields
        : Object.keys(preview[0] || {}).filter((k) => k !== '_id').map((f) => ({ field: f, jsonPath: f }))
      res.json({ ok: true, ai: Boolean(ai), path, count: arr.length, fields: shown, preview })
    } catch (e) { sendErr(res, e) }
  })
}
