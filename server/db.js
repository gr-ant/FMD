// FMD backend -- database pool, type helpers, and DB init/seed.
// -------------------------------------------------------------
// One Postgres database, two storage styles. The FMD document decides which:
//   [List X]  -> a relational TABLE  (SQL)
//   [Store X] -> a JSONB COLLECTION  (NoSQL)
//
// The frontend just fetches /api/<source>. This service knows, from the seed,
// whether <source> is a list (table) or a store (_fmd_documents) and queries the
// right way. The author never annotates sql/nosql -- it just happens.
// -------------------------------------------------------------
import pg from 'pg'
import { lists, stores } from './seed.js'

const { Pool } = pg
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://fmd:fmd@db:5432/fmd',
})

// Map every known source name to its storage kind (the routing table).
export const KIND = {}
for (const name of Object.keys(lists)) KIND[name] = 'list'
for (const name of Object.keys(stores)) KIND[name] = 'store'

// Infer a Postgres column type from the values in that column.
export function sqlType(values) {
  const vals = values.filter((v) => v !== null && v !== undefined)
  if (vals.length && vals.every((v) => typeof v === 'boolean')) return 'BOOLEAN'
  if (vals.length && vals.every((v) => typeof v === 'number' && Number.isInteger(v))) return 'INTEGER'
  if (vals.length && vals.every((v) => typeof v === 'number')) return 'DOUBLE PRECISION'
  return 'TEXT'
}

export const q = (id) => `"${String(id).replace(/"/g, '""')}"` // safe quoted identifier
export const qn = (schema, id) => `${q(schema)}.${q(id)}` // schema-qualified identifier
// Standard JSON error response (honours an optional e.status / e.body).
export const sendErr = (res, e) => res.status(e?.status || 500).json({ error: e?.body || e?.message || String(e) })

// FMD field type (from the txt/num/cur/bool/date prefix) -> Postgres column type.
const SQL_TYPE = { text: 'TEXT', memo: 'TEXT', number: 'NUMERIC', currency: 'NUMERIC(12,2)', boolean: 'BOOLEAN', date: 'DATE', drop: 'TEXT', link: 'TEXT', msel: 'TEXT', file: 'TEXT', files: 'TEXT' }
export const sqlTypeFor = (t) => SQL_TYPE[t] || 'TEXT'

// Every [List] table gets a reserved `_id` row identifier (for CRUD), separate
// from the user's declared columns.
export async function ensureId(db, table) {
  const { rows } = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = '_id'`, [table])
  if (!rows.length) await db.query(`ALTER TABLE ${q(table)} ADD COLUMN "_id" SERIAL PRIMARY KEY`)
}

// The user-facing columns of a list table (everything but the reserved `_id`).
export async function listColumns(table) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name <> '_id'`, [table])
  return rows.map((r) => r.column_name)
}

export const cleanVal = (v) => (v === '' ? null : v)

// Source names FMD uses for its own tables; a [List]/[Store] can't reuse them.
export const RESERVED_SOURCES = new Set(['_fmd_documents', '_fmd_configs', '_fmd_files', '_fmd_audit', '_fmd_seq'])
// The reserved names a model tries to use (lowercased, de-duped), if any. Any
// `_`-prefixed name is reserved for FMD internals; `documents`/`configs` are now
// ordinary, usable entity names.
export function reservedClash(entities) {
  const names = (entities || []).map((e) => String(e?.source || '').trim().toLowerCase())
  return [...new Set(names)].filter((s) => RESERVED_SOURCES.has(s) || s.startsWith('_'))
}

async function waitForDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query('SELECT 1')
      return
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  throw new Error('Database never became reachable')
}

// One-time migration: move the pre-prefix internal tables into the reserved
// `_fmd_` namespace, freeing `documents`/`configs` for use as entity names. Runs
// for the public schema and every deployed app schema; ALTER ... RENAME
// preserves all rows, and the `old && !new` guard makes it a no-op afterwards.
async function migrateReserved() {
  const { rows } = await pool.query(
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name = 'public' OR schema_name LIKE 'app_%'`)
  for (const { schema_name: sch } of rows) {
    for (const [oldN, newN] of [['documents', '_fmd_documents'], ['configs', '_fmd_configs']]) {
      const oldT = (await pool.query(`SELECT to_regclass($1) AS t`, [`${sch}.${oldN}`])).rows[0].t
      const newT = (await pool.query(`SELECT to_regclass($1) AS t`, [`${sch}.${newN}`])).rows[0].t
      if (oldT && !newT) {
        await pool.query(`ALTER TABLE ${q(sch)}.${q(oldN)} RENAME TO ${q(newN)}`)
        console.log(`[fmd-api] migrated ${sch}.${oldN} -> ${newN}`)
      }
    }
  }
}

export async function init() {
  await waitForDb()
  await migrateReserved()

  // [List] entities -> relational tables with inferred column types.
  for (const [name, def] of Object.entries(lists)) {
    const cols = def.columns
    const types = cols.map((c) => sqlType(def.rows.map((r) => r[c])))
    const colDefs = ['"_id" SERIAL PRIMARY KEY', ...cols.map((c, i) => `${q(c)} ${types[i]}`)].join(', ')
    await pool.query(`CREATE TABLE IF NOT EXISTS ${q(name)} (${colDefs})`)
    await ensureId(pool, name) // migrate tables created before _id existed

    const { rows: [{ count }] } = await pool.query(`SELECT COUNT(*)::int AS count FROM ${q(name)}`)
    if (count === 0) {
      for (const row of def.rows) {
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
        try {
          await pool.query(
            `INSERT INTO ${q(name)} (${cols.map(q).join(', ')}) VALUES (${placeholders})`,
            cols.map((c) => row[c]),
          )
        } catch (e) {
          // A type mismatch on one row shouldn't take down the whole server.
          console.warn(`[fmd-api] skipped seeding a ${name} row:`, e.message)
        }
      }
    }
  }

  // [Store] entities -> one JSONB _fmd_documents table, partitioned by `collection`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _fmd_documents (
      id SERIAL PRIMARY KEY,
      collection TEXT NOT NULL,
      doc JSONB NOT NULL
    )`)
  await pool.query(`CREATE INDEX IF NOT EXISTS documents_collection_idx ON _fmd_documents (collection)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS documents_doc_gin ON _fmd_documents USING GIN (doc)`)

  for (const [name, docs] of Object.entries(stores)) {
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM _fmd_documents WHERE collection = $1`, [name],
    )
    if (count === 0) {
      for (const doc of docs) {
        await pool.query(
          `INSERT INTO _fmd_documents (collection, doc) VALUES ($1, $2)`,
          [name, JSON.stringify(doc)],
        )
      }
    }
  }

  // App config store: arbitrary key -> JSON value (the FMD document, prefs, etc.)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _fmd_configs (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)

  // Uploaded files ([File]/[Files] fields). Global + shared across apps; the
  // record only stores a small {id,name,mime} descriptor pointing here. `source`
  // is the owning entity: downloads re-check the caller's READ permission on it,
  // so files inherit the same access control as their records. The blob is `data`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _fmd_files (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mime TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      source TEXT,
      data BYTEA NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)
  await pool.query(`ALTER TABLE _fmd_files ADD COLUMN IF NOT EXISTS source TEXT`) // migrate older tables

  // Activity log / audit trail: one append-only row per write across the app
  // (create/update/delete, trigger fired, file upload, button press). `detail`
  // holds the field before->after changes for an update. Read via /api/_audit.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _fmd_audit (
      id SERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      source TEXT,
      record_id TEXT,
      verb TEXT NOT NULL,
      actor TEXT,
      summary TEXT,
      detail JSONB
    )`)
  await pool.query(`CREATE INDEX IF NOT EXISTS _fmd_audit_source_idx ON _fmd_audit (source, ts DESC)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS _fmd_audit_record_idx ON _fmd_audit (record_id)`)

  // Auto-number counters ([Auto] fields). One row per source+field holds the
  // last-issued value; the server bumps it atomically on create (see
  // server/autonumber.js). Keyed per source+field so each auto field counts
  // independently. A plain counter table (not a Postgres SEQUENCE) so it lives in
  // whatever schema owns the data — the public editor DB and each deployed app.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _fmd_seq (
      source TEXT NOT NULL,
      field TEXT NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (source, field)
    )`)

  // Rebuild the routing map from what is PHYSICALLY in the database, so entities
  // applied in a previous session (via /api/_apply) keep routing across API
  // restarts -- the seed alone no longer knows about them. Stores are registered
  // first, then list tables, so a real table wins any name collision with a
  // leftover document collection.
  const { rows: collRows } = await pool.query(`SELECT DISTINCT collection FROM _fmd_documents`)
  for (const r of collRows) KIND[r.collection] = 'store'
  const { rows: tableRows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       AND table_name NOT IN ('_fmd_configs', '_fmd_documents', '_fmd_files', '_fmd_audit', '_fmd_seq')`)
  for (const r of tableRows) KIND[r.table_name] = 'list'

  // [API] external sources have no table -- they live in _fmd_configs as `api:<source>`.
  // Register them so the generic /api/:source GET can optionally route them too
  // (the canonical read path remains /api/_ext/:source).
  const { rows: apiRows } = await pool.query(
    `SELECT key FROM _fmd_configs WHERE key LIKE 'api:%'`)
  for (const r of apiRows) KIND[r.key.slice('api:'.length)] = 'api'

  console.log(`[fmd-api] ready. sources:`, KIND)
}
