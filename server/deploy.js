// Deploy a saved config to its own URL + an ISOLATED Postgres schema.
// Each deployed app lives in `app_<slug>` with its own tables, `_fmd_documents`
// (stores), and `_fmd_configs` (its published document). The editor's working data in
// `public` is untouched, and apps can't see each other.
import { pool, q, qn, sqlTypeFor, cleanVal, reservedClash } from './db.js'
import { guard } from './permissions.js'

const APP_PREFIX = 'app_'
export const slugify = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
const schemaFor = (slug) => APP_PREFIX + slug

// Create the app schema and its reserved tables (_fmd_documents + _fmd_configs).
async function provision(client, schema) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${q(schema)}`)
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${qn(schema, '_fmd_documents')} (id SERIAL PRIMARY KEY, collection TEXT NOT NULL, doc JSONB NOT NULL)`)
  await client.query(`CREATE INDEX IF NOT EXISTS documents_collection_idx ON ${qn(schema, '_fmd_documents')} (collection)`)
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${qn(schema, '_fmd_configs')} (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
}

// Reconcile [List]/[Store] entities into the app schema (data-preserving on
// redeploy). Mirrors the public _apply logic, but schema-qualified and never
// touching the reserved `_fmd_configs`/`_fmd_documents` tables.
async function applyEntities(client, schema, entities) {
  const desired = new Map()
  for (const ent of entities) {
    const source = String(ent.source || '').trim()
    if (!source) continue
    const kind = ent.kind === 'store' ? 'store' : 'list'
    const fields = (Array.isArray(ent.fields) ? ent.fields : [])
      .map((f) => (typeof f === 'string' ? { name: f, type: 'text' } : f))
      .filter((f) => f && f.name)
      .map((f) => ({ name: String(f.name), type: f.type || 'text' }))
    desired.set(source, { kind, fields })
  }

  const { rows: tRows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       AND table_name NOT IN ('_fmd_configs', '_fmd_documents')`, [schema])
  const currentTables = new Set(tRows.map((r) => r.table_name))
  for (const t of currentTables) {
    const d = desired.get(t)
    if (!d || d.kind !== 'list') { await client.query(`DROP TABLE IF EXISTS ${qn(schema, t)}`); currentTables.delete(t) }
  }
  const { rows: cRows } = await client.query(`SELECT DISTINCT collection FROM ${qn(schema, '_fmd_documents')}`)
  for (const r of cRows) {
    const d = desired.get(r.collection)
    if (!d || d.kind !== 'store') await client.query(`DELETE FROM ${qn(schema, '_fmd_documents')} WHERE collection = $1`, [r.collection])
  }

  const applied = []
  for (const [source, def] of desired) {
    if (def.kind === 'list') {
      if (!currentTables.has(source)) {
        await client.query(`CREATE TABLE IF NOT EXISTS ${qn(schema, source)} ("_id" SERIAL PRIMARY KEY)`)
      }
      const { rows: colRows } = await client.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`, [schema, source])
      const existing = new Set(colRows.map((r) => r.column_name))
      const declared = new Set(def.fields.map((f) => f.name))
      for (const f of def.fields) {
        if (!existing.has(f.name)) await client.query(`ALTER TABLE ${qn(schema, source)} ADD COLUMN ${q(f.name)} ${sqlTypeFor(f.type)}`)
      }
      for (const c of existing) {
        if (c !== '_id' && !declared.has(c)) await client.query(`ALTER TABLE ${qn(schema, source)} DROP COLUMN IF EXISTS ${q(c)}`)
      }
    }
    applied.push({ source, kind: def.kind })
  }
  return applied
}

// list columns of an app table (excluding the reserved _id).
async function appColumns(schema, source) {
  const { rows } = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = $1 AND table_name = $2 AND column_name <> '_id'`, [schema, source])
  return rows.map((r) => r.column_name)
}
// A source is a list if it is a table in the app schema, else a store (a
// _fmd_documents collection).
async function kindOf(schema, source) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [schema, source])
  return rows.length ? 'list' : 'store'
}

export function registerDeployRoutes(app) {
  // Deploy (or redeploy) a config: provision its schema, apply its model, store
  // its published document, and register the deployment.
  app.post('/api/_deploy', async (req, res) => {
    const slug = slugify(req.body?.slug || req.body?.name)
    if (!slug) return res.status(400).json({ error: 'invalid slug' })
    const entities = Array.isArray(req.body?.entities) ? req.body.entities : []
    const clash = reservedClash(entities)
    if (clash.length) {
      return res.status(400).json({ ok: false, error: `Reserved entity name: ${clash.join(', ')}. Rename it (e.g. “EmployeeDocuments”) before deploying.` })
    }
    const doc = String(req.body?.doc ?? '')
    const name = String(req.body?.name ?? slug)
    const schema = schemaFor(slug)
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await provision(client, schema)
      const applied = await applyEntities(client, schema, entities)
      const triggers = Array.isArray(req.body?.triggers) ? req.body.triggers : []
      const rules = req.body?.rules && typeof req.body.rules === 'object' ? req.body.rules : {}
      // Persist the permission model alongside the app so its /api/_app/* routes
      // enforce it (without this, deployed apps would have no permissions to check).
      const permissions = req.body?.permissions && typeof req.body.permissions === 'object' ? req.body.permissions : {}
      for (const [k, v] of [['document', doc], ['appName', name], ['triggers', triggers], ['rules', rules], ['permissions', permissions]]) {
        await client.query(
          `INSERT INTO ${qn(schema, '_fmd_configs')} (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, JSON.stringify(v)])
      }
      await client.query('COMMIT')
      await pool.query(
        `INSERT INTO _fmd_configs (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [`deploy:${slug}`, JSON.stringify({ slug, name, deployedAt: new Date().toISOString(), entities: applied.length })])
      res.json({ ok: true, slug, url: `/app/${slug}`, applied })
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      res.status(500).json({ ok: false, error: String(e) })
    } finally {
      client.release()
    }
  })

  // All deployments (for listing in the UI).
  app.get('/api/_deploy', async (req, res) => {
    try {
      const { rows } = await pool.query(`SELECT value FROM _fmd_configs WHERE key LIKE 'deploy:%' ORDER BY key`)
      res.json(rows.map((r) => r.value))
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })

  // Full database structure: the editor's working schema (public) plus every
  // deployed app schema, with each table's columns/row-count and store collections.
  app.get('/api/_dbinfo', async (req, res) => {
    try {
      const { rows: schemas } = await pool.query(
        `SELECT schema_name FROM information_schema.schemata
         WHERE schema_name = 'public' OR schema_name LIKE 'app_%'
         ORDER BY (schema_name <> 'public'), schema_name`)
      const out = []
      for (const { schema_name: sch } of schemas) {
        const { rows: tRows } = await pool.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = $1 AND table_type = 'BASE TABLE'
             AND table_name NOT IN ('_fmd_documents', '_fmd_configs')
           ORDER BY table_name`, [sch])
        const tables = []
        for (const { table_name: t } of tRows) {
          const { rows: cRows } = await pool.query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = $1 AND table_name = $2 AND column_name <> '_id'
             ORDER BY ordinal_position`, [sch, t])
          let rowCount = 0
          try { rowCount = (await pool.query(`SELECT count(*)::int AS c FROM ${qn(sch, t)}`)).rows[0].c } catch { /* ignore */ }
          tables.push({ name: t, columns: cRows.map((r) => r.column_name), rows: rowCount })
        }
        let stores = []
        try {
          const { rows: sRows } = await pool.query(
            `SELECT collection, count(*)::int AS c FROM ${qn(sch, '_fmd_documents')} GROUP BY collection ORDER BY collection`)
          stores = sRows.map((r) => ({ name: r.collection, rows: r.c }))
        } catch { /* schema may predate the store table */ }
        const entry = { schema: sch, kind: sch === 'public' ? 'editor' : 'deploy', tables, stores }
        if (sch !== 'public') {
          entry.slug = sch.replace(/^app_/, '')
          try {
            const { rows } = await pool.query(`SELECT value FROM ${qn(sch, '_fmd_configs')} WHERE key = 'appName'`)
            entry.appName = rows[0]?.value || entry.slug
          } catch { /* ignore */ }
        }
        out.push(entry)
      }
      res.json({ schemas: out })
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })

  // Edit a deployment: rename its display `name` and/or change its URL `slug`.
  // Changing the slug renames the Postgres schema and moves the registry entry,
  // so /app/<old> stops working and /app/<new> serves it.
  app.patch('/api/_deploy/:slug', async (req, res) => {
    const slug = slugify(req.params.slug)
    const newName = req.body?.name != null ? String(req.body.name).trim() : null
    const newSlug = req.body?.slug != null ? slugify(req.body.slug) : null
    if (newName === '') return res.status(400).json({ error: 'name cannot be empty' })
    if (req.body?.slug != null && !newSlug) return res.status(400).json({ error: 'invalid path' })
    try {
      // Carry over the existing registry entry (name, deployedAt, …).
      const { rows: er } = await pool.query(`SELECT value FROM _fmd_configs WHERE key = $1`, [`deploy:${slug}`])
      const entry = { ...(er[0]?.value || { slug }) }

      let curSlug = slug
      let schema = schemaFor(slug)
      if (newSlug && newSlug !== slug) {
        const target = schemaFor(newSlug)
        const taken = (await pool.query(`SELECT 1 FROM information_schema.schemata WHERE schema_name = $1`, [target])).rows.length
        if (taken) return res.status(409).json({ error: `path “${newSlug}” is already in use` })
        await pool.query(`ALTER SCHEMA ${q(schema)} RENAME TO ${q(target)}`)
        await pool.query(`DELETE FROM _fmd_configs WHERE key = $1`, [`deploy:${slug}`])
        curSlug = newSlug
        schema = target
      }

      entry.slug = curSlug
      if (newName) {
        entry.name = newName
        await pool.query(
          `UPDATE ${qn(schema, '_fmd_configs')} SET value = $1, updated_at = now() WHERE key = 'appName'`, [JSON.stringify(newName)])
      }
      await pool.query(
        `INSERT INTO _fmd_configs (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [`deploy:${curSlug}`, JSON.stringify(entry)])
      res.json({ ok: true, slug: curSlug, url: `/app/${curSlug}`, name: entry.name })
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })

  // Tear down a deployed app: drop its schema and forget it.
  app.delete('/api/_deploy/:slug', async (req, res) => {
    const slug = slugify(req.params.slug)
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${q(schemaFor(slug))} CASCADE`)
      await pool.query(`DELETE FROM _fmd_configs WHERE key = $1`, [`deploy:${slug}`])
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })

  // Published app metadata: its name + document (what the URL renders).
  app.get('/api/_app/:slug/_meta', async (req, res) => {
    const schema = schemaFor(slugify(req.params.slug))
    try {
      const { rows } = await pool.query(`SELECT key, value FROM ${qn(schema, '_fmd_configs')} WHERE key IN ('document', 'appName')`)
      const m = Object.fromEntries(rows.map((r) => [r.key, r.value]))
      if (m.document == null) return res.status(404).json({ error: 'not deployed' })
      res.json({ name: m.appName ?? req.params.slug, doc: m.document })
    } catch (e) { res.status(404).json({ error: 'not deployed' }) }
  })

  // App-scoped CRUD: identical to the public routes, but inside the app schema.
  app.get('/api/_app/:slug/:source', async (req, res) => {
    const schema = schemaFor(slugify(req.params.slug))
    const { source } = req.params
    if (source.startsWith('_')) return res.status(404).json([])
    if (!(await guard(req, res, source, 'GET', { schema, requireAuth: true }))) return
    try {
      const kind = await kindOf(schema, source)
      if (kind === 'list') {
        const { rows } = await pool.query(`SELECT * FROM ${qn(schema, source)}`)
        return res.json(rows)
      }
      const { rows } = await pool.query(`SELECT id, doc FROM ${qn(schema, '_fmd_documents')} WHERE collection = $1 ORDER BY id`, [source])
      res.json(rows.map((r) => ({ ...r.doc, _id: r.id })))
    } catch (e) { res.status(404).json([]) }
  })

  app.post('/api/_app/:slug/:source', async (req, res) => {
    const schema = schemaFor(slugify(req.params.slug))
    const { source } = req.params
    if (source.startsWith('_')) return res.status(404).json({ error: 'reserved' })
    if (!(await guard(req, res, source, 'POST', { schema, requireAuth: true }))) return
    const body = req.body || {}
    try {
      if ((await kindOf(schema, source)) === 'list') {
        const cols = await appColumns(schema, source)
        const keys = Object.keys(body).filter((k) => cols.includes(k))
        if (!keys.length) return res.status(400).json({ error: 'no known columns' })
        const ph = keys.map((_, i) => `$${i + 1}`).join(', ')
        const { rows } = await pool.query(
          `INSERT INTO ${qn(schema, source)} (${keys.map(q).join(', ')}) VALUES (${ph}) RETURNING *`,
          keys.map((k) => cleanVal(body[k])))
        return res.json(rows[0])
      }
      const doc = { ...body }; delete doc._id
      const { rows } = await pool.query(
        `INSERT INTO ${qn(schema, '_fmd_documents')} (collection, doc) VALUES ($1, $2) RETURNING id, doc`, [source, JSON.stringify(doc)])
      res.json({ ...rows[0].doc, _id: rows[0].id })
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })

  app.patch('/api/_app/:slug/:source/:id', async (req, res) => {
    const schema = schemaFor(slugify(req.params.slug))
    const { source, id } = req.params
    if (!(await guard(req, res, source, 'PATCH', { schema, requireAuth: true }))) return
    const body = req.body || {}
    try {
      if ((await kindOf(schema, source)) === 'list') {
        const cols = await appColumns(schema, source)
        const keys = Object.keys(body).filter((k) => cols.includes(k))
        if (!keys.length) return res.json({ ok: true })
        const sets = keys.map((k, i) => `${q(k)} = $${i + 1}`).join(', ')
        await pool.query(`UPDATE ${qn(schema, source)} SET ${sets} WHERE "_id" = $${keys.length + 1}`,
          [...keys.map((k) => cleanVal(body[k])), id])
        return res.json({ ok: true })
      }
      const patch = { ...body }; delete patch._id
      await pool.query(`UPDATE ${qn(schema, '_fmd_documents')} SET doc = doc || $2::jsonb WHERE id = $1`, [id, JSON.stringify(patch)])
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })

  app.delete('/api/_app/:slug/:source/:id', async (req, res) => {
    const schema = schemaFor(slugify(req.params.slug))
    const { source, id } = req.params
    if (!(await guard(req, res, source, 'DELETE', { schema, requireAuth: true }))) return
    try {
      if ((await kindOf(schema, source)) === 'list') {
        await pool.query(`DELETE FROM ${qn(schema, source)} WHERE "_id" = $1`, [id])
      } else {
        await pool.query(`DELETE FROM ${qn(schema, '_fmd_documents')} WHERE id = $1`, [id])
      }
      res.json({ ok: true })
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })
}
