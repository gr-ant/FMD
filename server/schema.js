// Schema routes: report storage kinds, reconstruct the DB to match an FMD
// data model, and a health check.
import { pool, KIND, q, ensureId, sqlTypeFor } from './db.js'

export function registerSchemaRoutes(app) {
  // What kinds of stores exist (handy for debugging / inspectors).
  app.get('/api/_schema', (req, res) => res.json(KIND))

  // Apply an FMD data model to the databases. The editor POSTs the parsed [Data]
  // entities here and we RECONSTRUCT Postgres to match the model exactly:
  //   - [List]  -> a table whose columns are exactly the declared fields
  //                (add new columns, drop columns no longer declared)
  //   - [Store] -> a JSONB collection in the shared `documents` table
  //   - anything in the DB but no longer in the model is dropped
  //   - kind changes (list<->store) drop the old representation
  // Overlapping data is preserved (rows survive; only removed columns/entities are
  // dropped). The whole sync runs in one transaction.
  app.post('/api/_apply', async (req, res) => {
    const entities = Array.isArray(req.body?.entities) ? req.body.entities : []

    // Desired model: source -> { kind, fields }
    const desired = new Map()
    for (const ent of entities) {
      const source = String(ent.source || '').trim()
      if (!source) continue
      const kind = ent.kind === 'store' ? 'store' : 'list'
      // Fields may arrive as strings (legacy) or { name, type } objects.
      const fields = (Array.isArray(ent.fields) ? ent.fields : [])
        .map((f) => (typeof f === 'string' ? { name: f, type: 'text' } : f))
        .filter((f) => f && f.name)
        .map((f) => ({ name: String(f.name), type: f.type || 'text' }))
      desired.set(source, { kind, fields })
    }

    const reset = req.body?.reset === true

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Full rewrite (e.g. the app was renamed): drop every data table and clear
      // every store collection, so nothing from the previous config survives.
      if (reset) {
        const { rows } = await client.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
             AND table_name NOT IN ('configs', 'documents')`)
        for (const r of rows) await client.query(`DROP TABLE IF EXISTS ${q(r.table_name)} CASCADE`)
        await client.query(`DELETE FROM documents`)
      }

      // Current physical state.
      const { rows: tableRows } = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
           AND table_name <> 'documents'`)
      const currentTables = new Set(tableRows.map((r) => r.table_name))
      const { rows: collRows } = await client.query(`SELECT DISTINCT collection FROM documents`)
      const currentCollections = new Set(collRows.map((r) => r.collection))

      // Drop tables that are no longer a [List] in the model (gone, or now a store).
      for (const t of currentTables) {
        const d = desired.get(t)
        if (!d || d.kind !== 'list') {
          await client.query(`DROP TABLE IF EXISTS ${q(t)}`)
          currentTables.delete(t)
        }
      }
      // Drop document collections that are no longer a [Store] in the model.
      for (const c of currentCollections) {
        const d = desired.get(c)
        if (!d || d.kind !== 'store') {
          await client.query(`DELETE FROM documents WHERE collection = $1`, [c])
          currentCollections.delete(c)
        }
      }

      // Create / sync every desired entity.
      const applied = []
      for (const [source, def] of desired) {
        if (def.kind === 'list') {
          if (!currentTables.has(source)) {
            await client.query(`CREATE TABLE IF NOT EXISTS ${q(source)} ("_id" SERIAL PRIMARY KEY)`)
          }
          await ensureId(client, source)
          const { rows: colRows } = await client.query(
            `SELECT column_name, data_type FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = $1`, [source])
          const existing = new Set(colRows.map((r) => r.column_name))
          const typeOf = Object.fromEntries(colRows.map((r) => [r.column_name, r.data_type]))
          const declared = new Set(def.fields.map((f) => f.name))
          // Add declared columns with their typed SQL type (existing columns keep
          // their current type -- altering a populated column's type can fail).
          for (const f of def.fields) {
            if (!existing.has(f.name)) {
              await client.query(`ALTER TABLE ${q(source)} ADD COLUMN ${q(f.name)} ${sqlTypeFor(f.type)}`)
            } else if ((f.type === 'currency' || f.type === 'number') && typeOf[f.name] === 'integer') {
              // Widen integer columns to numeric so currency keeps its decimals.
              await client.query(
                `ALTER TABLE ${q(source)} ALTER COLUMN ${q(f.name)} TYPE ${sqlTypeFor(f.type)} USING ${q(f.name)}::numeric`)
            }
          }
          // Drop columns no longer declared -- but never the reserved `_id`.
          for (const c of existing) {
            if (c !== '_id' && !declared.has(c)) await client.query(`ALTER TABLE ${q(source)} DROP COLUMN IF EXISTS ${q(c)}`)
          }
        }
        // stores share the `documents` table -- nothing structural to create.
        applied.push({ source, kind: def.kind, fields: def.fields })
      }

      await client.query('COMMIT')

      // Rebuild the routing map to be exactly the desired model.
      for (const k of Object.keys(KIND)) delete KIND[k]
      for (const [source, def] of desired) KIND[source] = def.kind

      res.json({ ok: true, applied, kinds: KIND })
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      res.status(500).json({ ok: false, error: String(e) })
    } finally {
      client.release()
    }
  })

  app.get('/api/_health', async (req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true }) }
    catch (e) { res.status(500).json({ ok: false, error: String(e) }) }
  })
}
