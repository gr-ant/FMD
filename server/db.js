// FMD backend -- database pool, type helpers, and DB init/seed.
// -------------------------------------------------------------
// One Postgres database, two storage styles. The FMD document decides which:
//   [List X]  -> a relational TABLE  (SQL)
//   [Store X] -> a JSONB COLLECTION  (NoSQL)
//
// The frontend just fetches /api/<source>. This service knows, from the seed,
// whether <source> is a list (table) or a store (documents) and queries the
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

// FMD field type (from the txt/num/cur/bool/date prefix) -> Postgres column type.
const SQL_TYPE = { text: 'TEXT', number: 'NUMERIC', currency: 'NUMERIC(12,2)', boolean: 'BOOLEAN', date: 'DATE', drop: 'TEXT', link: 'TEXT' }
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

export async function init() {
  await waitForDb()

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

  // [Store] entities -> one JSONB documents table, partitioned by `collection`.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      collection TEXT NOT NULL,
      doc JSONB NOT NULL
    )`)
  await pool.query(`CREATE INDEX IF NOT EXISTS documents_collection_idx ON documents (collection)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS documents_doc_gin ON documents USING GIN (doc)`)

  for (const [name, docs] of Object.entries(stores)) {
    const { rows: [{ count }] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM documents WHERE collection = $1`, [name],
    )
    if (count === 0) {
      for (const doc of docs) {
        await pool.query(
          `INSERT INTO documents (collection, doc) VALUES ($1, $2)`,
          [name, JSON.stringify(doc)],
        )
      }
    }
  }

  // App config store: arbitrary key -> JSON value (the FMD document, prefs, etc.)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS configs (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`)

  console.log(`[fmd-api] ready. sources:`, KIND)
}
