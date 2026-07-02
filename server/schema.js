// Schema routes: report storage kinds, reconstruct the DB to match an FMD
// data model, and a health check.
import { pool, KIND, q, ensureId, sqlTypeFor, reservedClash, listColumns } from './db.js'

export function registerSchemaRoutes(app) {
  // What kinds of stores exist (handy for debugging / inspectors).
  // ?detail=1 -> { source: { kind, columns } } so the editor can diff an apply
  // against what's live and warn before dropping tables/columns.
  app.get('/api/_schema', async (req, res) => {
    if (!req.query.detail) return res.json(KIND)
    const out = {}
    for (const [source, kind] of Object.entries(KIND)) {
      let columns = []
      if (kind === 'list') { try { columns = await listColumns(source) } catch { /* table may be gone */ } }
      out[source] = { kind, columns }
    }
    res.json(out)
  })

  // Apply an FMD data model to the databases. The editor POSTs the parsed [Data]
  // entities here and we RECONSTRUCT Postgres to match the model exactly:
  //   - [List]  -> a table whose columns are exactly the declared fields
  //                (add new columns, drop columns no longer declared)
  //   - [Store] -> a JSONB collection in the shared `_fmd_documents` table
  //   - anything in the DB but no longer in the model is dropped
  //   - kind changes (list<->store) drop the old representation
  // Overlapping data is preserved (rows survive; only removed columns/entities are
  // dropped). The whole sync runs in one transaction.
  app.post('/api/_apply', async (req, res) => {
    const entities = Array.isArray(req.body?.entities) ? req.body.entities : []

    // Reject reserved entity names up front with a clear message (otherwise
    // building an `_id` PK on the internal `_fmd_documents`/`_fmd_configs` table fails deep
    // in Postgres with "multiple primary keys ... not allowed").
    const clash = reservedClash(entities)
    if (clash.length) {
      return res.status(400).json({
        ok: false,
        error: `Reserved entity name: ${clash.join(', ')}. “_fmd_documents” and “_fmd_configs” are used internally — rename the entity (e.g. “EmployeeDocuments”).`,
      })
    }

    // Desired model: source -> { kind, fields, api? }
    const desired = new Map()
    for (const ent of entities) {
      const source = String(ent.source || '').trim()
      if (!source) continue
      const kind = ent.kind === 'store' ? 'store' : ent.kind === 'api' ? 'api' : 'list'
      // Fields may arrive as strings (legacy) or { name, type } objects.
      const fields = (Array.isArray(ent.fields) ? ent.fields : [])
        .map((f) => (typeof f === 'string' ? { name: f, type: 'text' } : f))
        .filter((f) => f && f.name)
        .map((f) => ({ name: String(f.name), type: f.type || 'text' }))
      // [API] entities carry an `api` object { url, auth, path, fields } that is
      // persisted to `_fmd_configs['api:<source>']` instead of a Postgres table.
      desired.set(source, { kind, fields, api: kind === 'api' ? (ent.api || {}) : null })
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
             AND table_name NOT IN ('_fmd_configs', '_fmd_documents')`)
        for (const r of rows) await client.query(`DROP TABLE IF EXISTS ${q(r.table_name)} CASCADE`)
        await client.query(`DELETE FROM _fmd_documents`)
      }

      // Current physical state. Exclude the reserved tables (`_fmd_configs` holds app
      // config + the saved-config library; `_fmd_documents` holds all [Store] data) so
      // the reconciliation below never treats them as stray entities and drops them.
      const { rows: tableRows } = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
           AND table_name NOT IN ('_fmd_configs', '_fmd_documents')`)
      const currentTables = new Set(tableRows.map((r) => r.table_name))
      const { rows: collRows } = await client.query(`SELECT DISTINCT collection FROM _fmd_documents`)
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
          await client.query(`DELETE FROM _fmd_documents WHERE collection = $1`, [c])
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
        } else if (def.kind === 'api') {
          // [API] entities have no Postgres table; persist their connection config
          // to `_fmd_configs['api:<source>']`, merging so an existing secret `key`
          // (saved via /api/_ext/:source/_key) AND any AI-derived path/fields are
          // preserved. Only OVERWRITE path/fields when the document explicitly
          // declares mappings ([Map]); otherwise the backend manages them.
          const { url = '', auth = 'bearer', path = null, fields: apiFields = [], want = null } = def.api || {}
          const patch = { url, auth, want }
          if (Array.isArray(apiFields) && apiFields.length) { patch.path = path; patch.fields = apiFields; patch.auto = 'done' }
          await client.query(
            `INSERT INTO _fmd_configs (key, value) VALUES ($1, $2)
             ON CONFLICT (key) DO UPDATE SET value = _fmd_configs.value || EXCLUDED.value, updated_at = now()`,
            [`api:${source.toLowerCase()}`, JSON.stringify(patch)])
        }
        // stores share the `_fmd_documents` table -- nothing structural to create.
        applied.push({ source, kind: def.kind, fields: def.fields })
      }

      await client.query('COMMIT')

      // Rebuild the routing map to be exactly the desired model.
      for (const k of Object.keys(KIND)) delete KIND[k]
      for (const [source, def] of desired) KIND[source] = def.kind

      // Persist the permission model (from [Permission] blocks) for enforcement.
      // Shape: { [source]: { [roleLower]: ["read","create","update","delete"] } }.
      if (req.body?.permissions && typeof req.body.permissions === 'object') {
        await pool.query(
          `INSERT INTO _fmd_configs (key, value) VALUES ('permissions', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [JSON.stringify(req.body.permissions)])
      }

      // Persist triggers + named rules so the server-side sweep can run them
      // (even with the app closed). triggers: [{source,condition,steps}];
      // rules: { name: expr }.
      for (const [key, fallback] of [['triggers', []], ['rules', {}]]) {
        await pool.query(
          `INSERT INTO _fmd_configs (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, JSON.stringify(req.body?.[key] ?? fallback)])
      }

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
