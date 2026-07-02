// Activity log / audit trail. Records every write across the app — record
// created/changed/deleted (with before -> after on updates), triggers firing,
// file uploads, and client-logged button/action presses — into one _fmd_audit
// table. Read back per-source (a table's history), per-record (a case's trail),
// or globally (the whole app feed). Auditing must NEVER break a request, so every
// write here is best-effort and swallows its own errors.
import { pool } from './db.js'
import { guard, loadPermissions, isAllowed } from './permissions.js'

// The human behind a request: the authenticated name/username, else the editor's
// "Preview as" role, else an anonymous fallback.
export function actorOf(req) {
  const u = req.user || {}
  // A server-verified identity (a valid OIDC token) is authoritative.
  if (u.name) return u.name
  if (u.username) return u.username
  if (u.sub) return u.sub
  // No verified identity. In OPEN DEV MODE (no OIDC) the caller is the author in
  // their own editor, so trust the name the client decoded from its sign-in token
  // (X-FMD-Actor). NEVER trust it in a secured deployment — there the verified
  // token above is the only identity, and an unauthenticated caller stays unknown.
  if (!process.env.OIDC_ISSUER) {
    const hdr = req.headers['x-fmd-actor']
    if (hdr && String(hdr).trim()) return String(hdr).trim().slice(0, 120)
  }
  const preview = req.headers['x-fmd-roles']
  if (preview !== undefined) {
    const role = String(preview).split(',')[0].trim()
    if (role) return `${role} (preview)`
  }
  return 'Someone'
}

// The action a write happened "via" — the client sets X-FMD-Via to a button/action
// name so a change caused by pressing a button is attributable to it.
export function viaOf(req) {
  const v = req.headers['x-fmd-via']
  return v ? String(v).slice(0, 120) : undefined
}

// Append one event. `verb` is create|update|delete|trigger|file|action|button.
export async function logAudit(db, { source = null, recordId = null, verb, actor = null, summary = null, detail = null }) {
  try {
    await (db || pool).query(
      `INSERT INTO _fmd_audit (source, record_id, verb, actor, summary, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [source, recordId != null ? String(recordId) : null, verb, actor, summary, detail ? JSON.stringify(detail) : null])
  } catch { /* auditing is best-effort; never surface to the caller */ }
}

export function registerAuditRoutes(app) {
  // Read the trail. `?source=` scopes to a table, `?record=` to one record, both
  // for a case; neither = the global app feed. Scoped reads reuse the data guard;
  // the global feed hides rows for sources the caller can't read.
  app.get('/api/_audit', async (req, res) => {
    const source = req.query.source ? String(req.query.source).toLowerCase() : null
    const record = req.query.record ? String(req.query.record) : null
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 500)
    try {
      if (source && !(await guard(req, res, source, 'GET'))) return
      const where = []
      const params = []
      if (source) { params.push(source); where.push(`source = $${params.length}`) }
      if (record) { params.push(record); where.push(`record_id = $${params.length}`) }
      params.push(limit)
      const { rows } = await pool.query(
        `SELECT id, ts, source, record_id, verb, actor, summary, detail FROM _fmd_audit
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
         ORDER BY ts DESC, id DESC LIMIT $${params.length}`, params)
      if (source) return res.json(rows)
      // Global feed: drop events for sources this caller can't read.
      const perms = await loadPermissions('public')
      let roles = req.user?.roles || []
      if (req.headers['x-fmd-roles'] !== undefined) {
        roles = String(req.headers['x-fmd-roles']).split(',').map((s) => s.trim()).filter(Boolean)
      }
      res.json(rows.filter((r) => !r.source || isAllowed(perms, r.source, 'read', roles)))
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })

  // Client-logged event: a button press or action run (its record writes are
  // logged server-side too, but this captures the intent + no-op presses).
  app.post('/api/_audit', async (req, res) => {
    const { source, record, verb, summary, detail } = req.body || {}
    if (!verb) return res.status(400).json({ error: 'verb required' })
    await logAudit(pool, {
      source: source ? String(source).toLowerCase() : null,
      recordId: record != null ? record : null,
      verb: String(verb).slice(0, 40),
      actor: actorOf(req),
      summary: summary ? String(summary).slice(0, 300) : null,
      detail: detail || null,
    })
    res.json({ ok: true })
  })
}
