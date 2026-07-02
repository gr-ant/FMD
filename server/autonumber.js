// Server-side auto-numbering for [Auto] fields.
// -------------------------------------------------------------
// An `[Auto] OrderNo = "WO-####"` directive under a [List] entity marks a field
// as server-generated: on create, when the field is left empty, the server fills
// it with the next sequential value formatted by the declared pattern. Doing it
// server-side (against an atomic counter) makes the ids collision-safe under
// concurrency — two simultaneous creates never get the same number.
//
// The declared model lives in `_fmd_configs.autonumbers`:
//   { [source]: { [field]: pattern } }
// The counters live in the reserved `_fmd_seq` table (one row per source+field).
// Both are schema-qualified so the public editor DB and each deployed app schema
// keep independent config + counters.
import { qn } from './db.js'

// Format a counter value with a declared pattern:
//   - a run of `#`  -> the number, zero-padded to the run length ("####" + 42 -> "0042")
//   - `{year}`      -> the current 4-digit year (case-insensitive token)
//   - everything else is a literal prefix/suffix
// If the pattern has no `#` run, the number is appended so an id is always unique.
export function formatAutoNumber(pattern, n, now = new Date()) {
  let out = String(pattern ?? '')
  out = out.replace(/\{year\}/gi, String(now.getFullYear()))
  let padded = false
  out = out.replace(/#+/, (hashes) => { padded = true; return String(n).padStart(hashes.length, '0') })
  return padded ? out : out + String(n)
}

// Atomically claim the next counter value for a source+field. The upsert +
// RETURNING runs as a single statement, so concurrent creates are serialized by
// the row lock and never collide. Counters start at 1.
export async function nextValue(db, source, field, schema = 'public') {
  const seq = qn(schema, '_fmd_seq')
  const { rows } = await db.query(
    `INSERT INTO ${seq} (source, field, counter) VALUES ($1, $2, 1)
     ON CONFLICT (source, field) DO UPDATE SET counter = ${seq}.counter + 1
     RETURNING counter`,
    [source, field])
  return Number(rows[0].counter)
}

// Load the auto-number config for one source: { field: pattern } or null.
async function autoConfigFor(db, source, schema = 'public') {
  const { rows } = await db.query(
    `SELECT value FROM ${qn(schema, '_fmd_configs')} WHERE key = 'autonumbers'`)
  if (!rows.length) return null
  const all = rows[0].value || {}
  const cfg = all[source] || all[String(source).toLowerCase()]
  return cfg && typeof cfg === 'object' ? cfg : null
}

const isEmpty = (v) => v === undefined || v === null || String(v).trim() === ''

// Fill any empty [Auto] field on a create body with its next formatted value.
// Returns a (possibly new) body object; the original is never mutated. A no-op
// when the source has no auto fields, so it's cheap to call on every create.
export async function applyAutoNumbers(db, source, body, schema = 'public') {
  const cfg = await autoConfigFor(db, source, schema)
  if (!cfg) return body
  let out = body
  for (const [field, pattern] of Object.entries(cfg)) {
    if (!isEmpty(out[field])) continue
    const n = await nextValue(db, source, field, schema)
    if (out === body) out = { ...body } // copy-on-first-write
    out[field] = formatAutoNumber(pattern, n)
  }
  return out
}
