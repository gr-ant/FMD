// The one endpoint the frontend uses plus CRUD. Routes by storage kind.
import { pool, KIND, q, listColumns, cleanVal } from './db.js'
import { guard } from './permissions.js'
import { fetchExternal } from './ext.js'
import { logAudit, actorOf, viaOf } from './audit.js'

export function registerCrudRoutes(app) {
  // The one endpoint the frontend uses. Routes by storage kind automatically.
  app.get('/api/:source', async (req, res) => {
    const { source } = req.params
    if (!(await guard(req, res, source, 'GET'))) return
    const kind = KIND[source]
    try {
      if (kind === 'list') {
        const { rows } = await pool.query(`SELECT * FROM ${q(source)}`)
        return res.json(rows)
      }
      if (kind === 'store') {
        const { rows } = await pool.query(
          `SELECT id, doc FROM _fmd_documents WHERE collection = $1 ORDER BY id`, [source],
        )
        return res.json(rows.map((r) => ({ ...r.doc, _id: r.id })))
      }
      if (kind === 'api') {
        // External API source: read its config and fetch live (canonical path is
        // /api/_ext/:source; this lets /api/:source resolve it too). Read-only.
        const { rows } = await pool.query(`SELECT value FROM _fmd_configs WHERE key = $1`, [`api:${source.toLowerCase()}`])
        if (!rows.length) return res.status(404).json([])
        return res.json(await fetchExternal(rows[0].value))
      }
      return res.status(404).json([])
    } catch (e) {
      return res.status(500).json({ error: String(e) })
    }
  })

  // ---- CRUD (for cTable/uTable/dTable interactive tables) -------------------
  // Insert a record. Body is a field->value object.
  app.post('/api/:source', async (req, res) => {
    const { source } = req.params
    if (source.startsWith('_')) return res.status(404).json({ error: 'reserved' })
    if (!(await guard(req, res, source, 'POST'))) return
    const kind = KIND[source]
    const body = req.body || {}
    try {
      if (kind === 'list') {
        const cols = await listColumns(source)
        const keys = Object.keys(body).filter((k) => cols.includes(k))
        if (!keys.length) return res.status(400).json({ error: 'no known columns' })
        const ph = keys.map((_, i) => `$${i + 1}`).join(', ')
        const { rows } = await pool.query(
          `INSERT INTO ${q(source)} (${keys.map(q).join(', ')}) VALUES (${ph}) RETURNING *`,
          keys.map((k) => cleanVal(body[k])))
        await logAudit(pool, { source, recordId: rows[0]._id, verb: 'create', actor: actorOf(req), detail: { fields: keys, via: viaOf(req) } })
        return res.json(rows[0])
      }
      if (kind === 'store') {
        const doc = { ...body }; delete doc._id
        const { rows } = await pool.query(
          `INSERT INTO _fmd_documents (collection, doc) VALUES ($1, $2) RETURNING id, doc`, [source, JSON.stringify(doc)])
        await logAudit(pool, { source, recordId: rows[0].id, verb: 'create', actor: actorOf(req), detail: { fields: Object.keys(doc), via: viaOf(req) } })
        return res.json({ ...rows[0].doc, _id: rows[0].id })
      }
      return res.status(404).json({ error: 'unknown source' })
    } catch (e) { return res.status(500).json({ error: String(e) }) }
  })

  // Update a record by its _id. Body is the changed fields.
  app.patch('/api/:source/:id', async (req, res) => {
    const { source, id } = req.params
    if (!(await guard(req, res, source, 'PATCH'))) return
    const kind = KIND[source]
    const body = req.body || {}
    try {
      if (kind === 'list') {
        const cols = await listColumns(source)
        const keys = Object.keys(body).filter((k) => cols.includes(k))
        if (!keys.length) return res.json({ ok: true })
        // Read the old values first so the audit trail shows before -> after.
        const prev = (await pool.query(`SELECT ${keys.map(q).join(', ')} FROM ${q(source)} WHERE "_id" = $1`, [id])).rows[0] || {}
        const sets = keys.map((k, i) => `${q(k)} = $${i + 1}`).join(', ')
        await pool.query(`UPDATE ${q(source)} SET ${sets} WHERE "_id" = $${keys.length + 1}`,
          [...keys.map((k) => cleanVal(body[k])), id])
        const changes = keys
          .map((k) => ({ field: k, from: prev[k], to: cleanVal(body[k]) }))
          .filter((c) => String(c.from ?? '') !== String(c.to ?? ''))
        if (changes.length) await logAudit(pool, { source, recordId: id, verb: 'update', actor: actorOf(req), detail: { changes, via: viaOf(req) } })
        return res.json({ ok: true })
      }
      if (kind === 'store') {
        const patch = { ...body }; delete patch._id
        await pool.query(`UPDATE _fmd_documents SET doc = doc || $2::jsonb WHERE id = $1`, [id, JSON.stringify(patch)])
        await logAudit(pool, { source, recordId: id, verb: 'update', actor: actorOf(req), detail: { changes: Object.keys(patch).map((k) => ({ field: k, to: patch[k] })), via: viaOf(req) } })
        return res.json({ ok: true })
      }
      return res.status(404).json({ error: 'unknown source' })
    } catch (e) { return res.status(500).json({ error: String(e) }) }
  })

  // Delete a record by its _id.
  app.delete('/api/:source/:id', async (req, res) => {
    const { source, id } = req.params
    if (!(await guard(req, res, source, 'DELETE'))) return
    const kind = KIND[source]
    try {
      if (kind === 'list') {
        await pool.query(`DELETE FROM ${q(source)} WHERE "_id" = $1`, [id])
        await logAudit(pool, { source, recordId: id, verb: 'delete', actor: actorOf(req), detail: { via: viaOf(req) } })
        return res.json({ ok: true })
      }
      if (kind === 'store') {
        await pool.query(`DELETE FROM _fmd_documents WHERE id = $1`, [id])
        await logAudit(pool, { source, recordId: id, verb: 'delete', actor: actorOf(req), detail: { via: viaOf(req) } })
        return res.json({ ok: true })
      }
      return res.status(404).json({ error: 'unknown source' })
    } catch (e) { return res.status(500).json({ error: String(e) }) }
  })
}
