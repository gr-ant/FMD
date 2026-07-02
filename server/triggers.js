// Server-side trigger sweep. Triggers ([Trigger -> Source ? cond] + steps) are
// persisted (structured) into each app's `_fmd_configs` at save/deploy. Here we
// evaluate them with direct DB access — so they fire even when NOBODY has the
// app open, which is the whole point of doing it server-side (e.g. "mark overdue
// checkouts" at midnight). Runs on a 60s timer AND on demand (POST .../_triggers/run).
//
// The condition + assignment logic below is a faithful port of the browser's
// src/fmd/rules.ts (passes) + actions.ts (buildBody) + expr.ts (evalArith), so
// client and server evaluate triggers identically.
import { pool, q, qn, cleanVal } from './db.js'
import { slugify } from './deploy.js'

// ---------------------------------------------------------------------------
// Pure engine (ported, dependency-free) -------------------------------------
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function dateToken(tok) {
  const m = String(tok).trim().match(/^(today|now)(?:\s*([+-])\s*(\d+))?$/i)
  if (!m) return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (m[2]) d.setDate(d.getDate() + Number(m[3]) * (m[2] === '-' ? -1 : 1))
  return ymd(d)
}
const num = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, ''))
const isDateish = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())
const dayNum = (v) => new Date(String(v).trim().slice(0, 10)).getTime()
function truthy(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return /^(true|yes|y|confirmed|done|complete|completed|paid|active|ok|1)$/i.test(String(v ?? '').trim())
}
function looseEq(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const bool = typeof a === 'boolean' ? a : b
    const other = typeof a === 'boolean' ? b : a
    return truthy(other) === bool
  }
  if (isDateish(a) && isDateish(b)) return dayNum(a) === dayNum(b)
  if (typeof a === 'number' || typeof b === 'number') return num(a) === num(b)
  return String(a).toLowerCase() === String(b).toLowerCase()
}
function operand(tok, rec) {
  if (/^".*"$/.test(tok) || /^'.*'$/.test(tok)) return tok.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok)
  if (/^(true|false)$/i.test(tok)) return /^true$/i.test(tok)
  const dt = dateToken(tok)
  if (dt !== null) return dt
  const key = Object.keys(rec).find((k) => k.toLowerCase() === tok.toLowerCase())
  return key ? rec[key] : tok
}
function compEval(part, rec) {
  const m = part.match(/^(.+?)(==|!=|<=|>=|<|>)(.+)$/)
  if (!m) return truthy(operand(part.trim(), rec))
  const a = operand(m[1].trim(), rec)
  const b = operand(m[3].trim(), rec)
  const dateCmp = isDateish(a) || isDateish(b)
  const A = dateCmp ? dayNum(a) : num(a)
  const B = dateCmp ? dayNum(b) : num(b)
  switch (m[2]) {
    case '==': return looseEq(a, b)
    case '!=': return !looseEq(a, b)
    case '<': return A < B
    case '>': return A > B
    case '<=': return A <= B
    case '>=': return A >= B
    default: return false
  }
}
const andEval = (expr, rec) => expr.split('&&').every((p) => compEval(p, rec))
const orEval = (expr, rec) => expr.split('||').some((p) => andEval(p, rec))
function passes(cond, record, rules) {
  const c = String(cond ?? '').trim()
  const expr = rules && rules[c] != null ? rules[c] : cond
  if (!expr || !String(expr).trim()) return true
  try { return orEval(String(expr), record || {}) } catch { return true }
}
// arithmetic (evalArith) for `Count = Count + 1`
const anum = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) ? n : 0 }
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 }
function evalArith(expr, record) {
  try {
    const toks = []
    const re = /\s*([0-9.]+|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/])/g
    let m
    while ((m = re.exec(String(expr || '')))) toks.push(m[1])
    const out = [], ops = []
    for (const t of toks) {
      if (/^[0-9.]+$/.test(t) || /^[A-Za-z_]/.test(t)) out.push(t)
      else if (t === '(') ops.push(t)
      else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()); ops.pop() }
      else { while (ops.length && PREC[ops[ops.length - 1]] >= PREC[t]) out.push(ops.pop()); ops.push(t) }
    }
    while (ops.length) out.push(ops.pop())
    const st = []
    for (const t of out) {
      if (t === '+' || t === '-' || t === '*' || t === '/') {
        const b = st.pop(), a = st.pop()
        st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : (b ? a / b : 0))
      } else if (/^[0-9.]+$/.test(t)) st.push(parseFloat(t))
      else { const key = Object.keys(record || {}).find((k) => k.toLowerCase() === t.toLowerCase()); st.push(anum(key ? record[key] : 0)) }
    }
    return st.length ? st[st.length - 1] : 0
  } catch { return 0 }
}
function evalValue(expr, row) {
  const t = String(expr ?? '').trim()
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return t.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (/^(true|false)$/i.test(t)) return /^true$/i.test(t)
  const dt = dateToken(t)
  if (dt !== null) return dt
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && row) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === t.toLowerCase())
    if (key) return row[key]
  }
  return evalArith(t, row || {})
}
const buildBody = (assigns, row) => {
  const body = {}
  for (const a of assigns || []) body[a.field] = evalValue(a.expr, row || {})
  return body
}

// ---------------------------------------------------------------------------
// DB access (schema-aware: 'public' for the editor app, app_<slug> for deploys)
async function isList(schema, source) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [schema, source])
  return rows.length > 0
}
async function colsOf(schema, source) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name <> '_id'`, [schema, source])
  return rows.map((r) => r.column_name)
}
// pg returns DATE/TIMESTAMP columns as JS Date objects on a direct query, but the
// rules engine (and the client, which sees JSON) expects ISO strings. Normalize
// so `DueDate < today` and date assignments behave identically server-side.
function normalizeRow(r) {
  const o = {}
  for (const k of Object.keys(r)) o[k] = r[k] instanceof Date ? r[k].toISOString() : r[k]
  return o
}
async function readRows(schema, source) {
  if (await isList(schema, source)) {
    const { rows } = await pool.query(`SELECT * FROM ${qn(schema, source)}`)
    return { kind: 'list', rows: rows.map(normalizeRow) }
  }
  const { rows } = await pool.query(
    `SELECT id, doc FROM ${qn(schema, '_fmd_documents')} WHERE collection = $1 ORDER BY id`, [source])
  return { kind: 'store', rows: rows.map((r) => ({ ...r.doc, _id: r.id })) }
}
async function insertRow(schema, source, body) {
  if (await isList(schema, source)) {
    const cols = await colsOf(schema, source)
    const keys = Object.keys(body).filter((k) => cols.includes(k))
    if (!keys.length) return
    const ph = keys.map((_, i) => `$${i + 1}`).join(', ')
    await pool.query(`INSERT INTO ${qn(schema, source)} (${keys.map(q).join(', ')}) VALUES (${ph})`,
      keys.map((k) => cleanVal(body[k])))
  } else {
    const doc = { ...body }; delete doc._id
    await pool.query(`INSERT INTO ${qn(schema, '_fmd_documents')} (collection, doc) VALUES ($1, $2)`,
      [source, JSON.stringify(doc)])
  }
}
async function updateRow(schema, source, kind, id, body) {
  if (kind === 'list') {
    const cols = await colsOf(schema, source)
    const keys = Object.keys(body).filter((k) => cols.includes(k))
    if (!keys.length) return
    const sets = keys.map((k, i) => `${q(k)} = $${i + 1}`).join(', ')
    await pool.query(`UPDATE ${qn(schema, source)} SET ${sets} WHERE "_id" = $${keys.length + 1}`,
      [...keys.map((k) => cleanVal(body[k])), id])
  } else {
    const patch = { ...body }; delete patch._id
    await pool.query(`UPDATE ${qn(schema, '_fmd_documents')} SET doc = doc || $2::jsonb WHERE id = $1`,
      [id, JSON.stringify(patch)])
  }
}
async function deleteRow(schema, source, kind, id) {
  if (kind === 'list') await pool.query(`DELETE FROM ${qn(schema, source)} WHERE "_id" = $1`, [id])
  else await pool.query(`DELETE FROM ${qn(schema, '_fmd_documents')} WHERE id = $1`, [id])
}

// One explicit-source global step (update/delete by its own filter) — run once.
async function runGlobalStep(schema, step, rules) {
  const { kind, rows } = await readRows(schema, step.source)
  for (const row of rows) {
    if (row._id == null || !passes(step.filter, row, rules)) continue
    if (step.op === 'delete') await deleteRow(schema, step.source, kind, row._id)
    else if (step.op === 'update') await updateRow(schema, step.source, kind, row._id, buildBody(step.assigns, row))
  }
}

// Evaluate one trigger; returns how many records it acted on.
async function runTrigger(schema, trigger, rules) {
  if (!trigger || !trigger.source) return 0
  const { kind, rows } = await readRows(schema, trigger.source)
  const matched = rows.filter((row) => passes(trigger.condition, row, rules))
  for (const row of matched) {
    for (const step of trigger.steps || []) {
      if (step.op === 'create' && step.source) {
        await insertRow(schema, step.source, buildBody(step.assigns, row))
      } else if (step.source) {
        await runGlobalStep(schema, step, rules) // explicit-source update/delete
      } else if (row._id != null) {
        const id = row._id
        if (step.op === 'delete') await deleteRow(schema, trigger.source, kind, id)
        else if (step.op === 'update') await updateRow(schema, trigger.source, kind, id, buildBody(step.assigns, row))
      }
    }
  }
  return matched.length
}

// Load an app's persisted triggers + named rules from its _fmd_configs.
async function loadConfig(schema) {
  try {
    const { rows } = await pool.query(
      `SELECT key, value FROM ${qn(schema, '_fmd_configs')} WHERE key IN ('triggers', 'rules')`)
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
    return {
      triggers: Array.isArray(m.triggers) ? m.triggers : [],
      rules: m.rules && typeof m.rules === 'object' ? m.rules : {},
    }
  } catch { return { triggers: [], rules: {} } }
}

// Per-schema coalescing: if a run is already in flight for this app, reuse it.
// This serializes the 60s timer with on-demand pokes so triggers never
// double-fire (which would duplicate [Create] steps).
const inFlight = new Map()
export function runTriggersForApp(schema) {
  if (inFlight.has(schema)) return inFlight.get(schema)
  const p = (async () => {
    const { triggers, rules } = await loadConfig(schema)
    let acted = 0
    for (const t of triggers) { try { acted += await runTrigger(schema, t, rules) } catch { /* skip */ } }
    return acted
  })().finally(() => inFlight.delete(schema))
  inFlight.set(schema, p)
  return p
}

// Sweep the editor app (public) + every deployed app schema.
async function sweepAll() {
  const schemas = ['public']
  try {
    const { rows } = await pool.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'app\\_%'`)
    for (const r of rows) schemas.push(r.schema_name)
  } catch { /* ignore */ }
  for (const s of schemas) { try { await runTriggersForApp(s) } catch { /* ignore */ } }
}

export function startTriggerSweep() {
  setTimeout(() => { sweepAll().catch(() => {}) }, 5000) // shortly after boot
  setInterval(() => { sweepAll().catch(() => {}) }, 60000) // every minute thereafter
}

// On-demand: the client pokes these right after an action (and on its own timer)
// so trigger effects appear without waiting for the next sweep.
export function registerTriggerRoutes(app) {
  app.post('/api/_triggers/run', async (req, res) => {
    try { res.json({ ok: true, acted: await runTriggersForApp('public') }) }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
  })
  app.post('/api/_app/:slug/_triggers/run', async (req, res) => {
    try { res.json({ ok: true, acted: await runTriggersForApp('app_' + slugify(req.params.slug)) }) }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
  })
}
