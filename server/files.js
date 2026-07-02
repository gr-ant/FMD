// File upload/download for [File]/[Files] fields. Blobs live in the global
// `_fmd_files` table (see db.js). A record only stores a small {id,name,mime}
// descriptor; the bytes are fetched from here by id.
//
//   POST /api/_files                { name, mime, source, data(base64) } -> {id,name,mime,size}
//   GET  /api/_files/:id            (editor / public schema)   -> the bytes
//   GET  /api/_app/:slug/_files/:id (a deployed app's schema)  -> the bytes
//
// ACCESS CONTROL (Option 2 — identity-based, not a public capability URL):
// each file records its owning `source`. On download we re-check the caller's
// READ permission on that source with the SAME guard the CRUD reads use, so a
// document is exactly as accessible as the records it belongs to. Because a
// browser <img src> can't send an auth header, the client fetches files through
// apiFetch (bearer / editor header) and renders the resulting blob. A file with
// no source (uploaded outside a form) stays an unguessable capability URL.
import { randomBytes } from 'crypto'
import { pool, sendErr } from './db.js'
import { guard } from './permissions.js'
import { slugify } from './deploy.js'
import { logAudit, actorOf } from './audit.js'

const MAX_BYTES = 25 * 1024 * 1024 // 25 MB per file

async function serveFile(req, res, schema) {
  const { rows } = await pool.query(
    `SELECT name, mime, data, source FROM _fmd_files WHERE id = $1`, [req.params.id])
  if (!rows.length) return res.status(404).json({ error: 'not found' })
  const f = rows[0]
  // A file bound to a source inherits that source's read permission. Deployed
  // apps demand a signed-in user; the editor honors its "Preview as" header.
  if (f.source) {
    const ok = await guard(req, res, f.source, 'GET', { schema, requireAuth: schema !== 'public' })
    if (!ok) return // guard already sent 401/403
  }
  res.set('Content-Type', f.mime || 'application/octet-stream')
  res.set('Cache-Control', 'private, max-age=31536000, immutable') // id is content-stable
  const inline = /^image\//.test(f.mime) || f.mime === 'application/pdf'
  res.set('Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(f.name || 'file')}"`)
  res.send(f.data)
}

export function registerFileRoutes(app) {
  app.post('/api/_files', async (req, res) => {
    try {
      // Who may upload: open dev mode, an authenticated user (deployed apps), or
      // the editor author (the editor sends X-FMD-Roles like its other writes).
      // A deployed-app anonymous caller (no token, no editor header) is refused.
      const isEditor = req.headers['x-fmd-roles'] !== undefined
      if (process.env.OIDC_ISSUER && !req.user?.sub && !isEditor) {
        return res.status(401).json({ error: 'sign-in required to upload' })
      }
      const { name, mime, data, source } = req.body || {}
      if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'file data required' })
      const buf = Buffer.from(data, 'base64')
      if (!buf.length) return res.status(400).json({ error: 'empty file' })
      if (buf.length > MAX_BYTES) return res.status(413).json({ error: `file too large (max ${MAX_BYTES / 1024 / 1024}MB)` })
      const id = randomBytes(16).toString('hex')
      const safeName = String(name || 'file').slice(0, 200)
      const safeMime = String(mime || 'application/octet-stream').slice(0, 120)
      const src = source ? String(source).toLowerCase().slice(0, 120) : null
      await pool.query(
        `INSERT INTO _fmd_files (id, name, mime, size, source, data) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, safeName, safeMime, buf.length, src, buf])
      logAudit(pool, { source: src, verb: 'file', actor: actorOf(req), summary: `Uploaded “${safeName}”`, detail: { name: safeName, mime: safeMime, size: buf.length } })
      res.json({ id, name: safeName, mime: safeMime, size: buf.length })
    } catch (e) { sendErr(res, e) }
  })

  // Editor / public-schema download.
  app.get('/api/_files/:id', async (req, res) => {
    try { await serveFile(req, res, 'public') } catch (e) { sendErr(res, e) }
  })
  // A deployed app's download (its own schema's permission model).
  app.get('/api/_app/:slug/_files/:id', async (req, res) => {
    try { await serveFile(req, res, 'app_' + slugify(req.params.slug)) } catch (e) { sendErr(res, e) }
  })
}
