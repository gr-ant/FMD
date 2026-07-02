// User management proxy to Authentik's REST API. The FMD app never holds users
// itself; this forwards create/edit/delete + role(group) assignment to Authentik
// using a stored admin token. Connection settings live in _fmd_configs.authentik
// = { url, token }. Role names map to Authentik groups (created on demand).
import { pool, sendErr } from './db.js'
import { requireAdmin } from './permissions.js'
import { randomBytes } from 'crypto'

// A readable temporary password that satisfies typical complexity policies
// (upper + lower + digits + symbol). Returned to the admin once, on creation.
function tempPassword() {
  return 'Tmp-' + randomBytes(6).toString('base64').replace(/[+/=]/g, '').slice(0, 8) + '9'
}

async function authentikCfg() {
  // Prefer env (set by docker-compose — reproducible, no manual token step):
  // AUTHENTIK_API_TOKEN is provisioned by Authentik's AUTHENTIK_BOOTSTRAP_TOKEN.
  const envUrl = process.env.AUTHENTIK_URL
  const envToken = process.env.AUTHENTIK_API_TOKEN
  if (envUrl && envToken) return { url: envUrl.replace(/\/+$/, ''), token: envToken, fromEnv: true }
  const { rows } = await pool.query(`SELECT value FROM _fmd_configs WHERE key = 'authentik'`)
  const v = rows[0]?.value || {}
  return { url: String(v.url || '').replace(/\/+$/, ''), token: String(v.token || ''), fromEnv: false }
}

// One call to Authentik's API. Throws { status, body } on a non-2xx.
async function ak(cfg, path, opts = {}) {
  const r = await fetch(`${cfg.url}/api/v3${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  const text = await r.text()
  let body
  try { body = text ? JSON.parse(text) : null } catch { body = text }
  if (!r.ok) throw { status: r.status, body }
  return body
}

// Fetch EVERY page of an Authentik list endpoint. A single page_size cap would
// silently truncate groups/users — and because a user edit round-trips the
// reconstructed role list, a dropped group would be stripped from the user on save.
async function akAll(cfg, path) {
  const sep = path.includes('?') ? '&' : '?'
  const out = []
  let page = 1
  for (let i = 0; i < 100; i++) { // hard cap so a pagination glitch can't loop forever
    const data = await ak(cfg, `${path}${sep}page=${page}&page_size=100`)
    const results = data?.results || []
    out.push(...results)
    const next = data?.pagination?.next
    if (!next || next <= page || !results.length) break
    page = next
  }
  return out
}

// Map role names -> Authentik group UUIDs, creating any group that doesn't exist.
async function resolveGroups(cfg, names) {
  if (!Array.isArray(names) || !names.length) return []
  const existing = await akAll(cfg, '/core/groups/')
  const byName = new Map(existing.map((g) => [String(g.name).toLowerCase(), g.pk]))
  const out = []
  for (const name of names) {
    let pk = byName.get(String(name).toLowerCase())
    if (!pk) { pk = (await ak(cfg, '/core/groups/', { method: 'POST', body: JSON.stringify({ name }) })).pk; byName.set(String(name).toLowerCase(), pk) }
    out.push(pk)
  }
  return out
}

// Resolve the Authentik connection, or send a 400 and return null when it isn't
// configured. Callers: `const cfg = await requireAuthentik(res); if (!cfg) return`.
async function requireAuthentik(res) {
  const cfg = await authentikCfg()
  if (!cfg.url || !cfg.token) { res.status(400).json({ error: 'Authentik not configured' }); return null }
  return cfg
}

// Read a field from the body case-insensitively (the table/form sends the
// display-cased names: Username, Name, Email, Roles, Active, Password).
const pick = (body, key) => {
  const k = Object.keys(body || {}).find((x) => x.toLowerCase() === key)
  return k === undefined ? undefined : body[k]
}
const roleList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const isOn = (v) => v === true || v === 'true' || v === 1 || v === '1' || v === 't'

export function registerUserRoutes(app) {
  // Is the Authentik connection configured? (so the UI can prompt for settings)
  app.get('/api/_users/_status', async (req, res) => {
    if (!requireAdmin(req, res)) return
    const cfg = await authentikCfg()
    res.json({ configured: !!(cfg.url && cfg.token), url: cfg.url, fromEnv: cfg.fromEnv })
  })

  // Save the Authentik base URL + admin API token.
  app.put('/api/_users/_config', async (req, res) => {
    if (!requireAdmin(req, res)) return
    const { url, token } = req.body || {}
    await pool.query(
      `INSERT INTO _fmd_configs (key, value) VALUES ('authentik', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ url: String(url || ''), token: String(token || '') })])
    res.json({ ok: true })
  })

  // The signed-in user's own status — does the deployed app need to force a
  // password change before letting them in? (Open mode / anonymous -> no.)
  app.get('/api/_users/_me', async (req, res) => {
    try {
      const cfg = await authentikCfg()
      const username = req.user?.username
      if (!cfg.url || !cfg.token || !username) return res.json({ mustChange: false })
      const found = (await ak(cfg, `/core/users/?username=${encodeURIComponent(username)}`)).results || []
      const u = found[0]
      if (!u) return res.json({ mustChange: false })
      res.json({ username: u.username, name: u.name, mustChange: !!(u.attributes && u.attributes.fmd_must_change) })
    } catch (e) { sendErr(res, e) }
  })

  // The signed-in user sets their own password (clears the must-change flag).
  app.post('/api/_users/_me/password', async (req, res) => {
    try {
      const cfg = await requireAuthentik(res)
      if (!cfg) return
      const username = req.user?.username
      if (!username) return res.status(401).json({ error: 'not signed in' })
      const newPassword = pick(req.body || {}, 'newpassword') ?? pick(req.body || {}, 'password')
      if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
      const found = (await ak(cfg, `/core/users/?username=${encodeURIComponent(username)}`)).results || []
      const u = found[0]
      if (!u) return res.status(404).json({ error: 'user not found' })
      await ak(cfg, `/core/users/${u.pk}/set_password/`, { method: 'POST', body: JSON.stringify({ password: newPassword }) })
      const attributes = { ...(u.attributes || {}), fmd_must_change: false }
      await ak(cfg, `/core/users/${u.pk}/`, { method: 'PATCH', body: JSON.stringify({ attributes }) })
      res.json({ ok: true })
    } catch (e) { sendErr(res, e) }
  })

  // List users with their role (group) names.
  app.get('/api/_users', async (req, res) => {
    if (!requireAdmin(req, res)) return
    try {
      const cfg = await requireAuthentik(res)
      if (!cfg) return
      const groups = await akAll(cfg, '/core/groups/')
      const byPk = new Map(groups.map((g) => [g.pk, g.name]))
      const users = await akAll(cfg, '/core/users/')
      // Hide system accounts: service accounts (outposts), IdP superusers, and
      // the bootstrap admin — they're not app users.
      const appUsers = users.filter((u) =>
        !String(u.type || '').includes('service_account') &&
        !u.is_superuser &&
        u.username !== 'akadmin')
      res.json(appUsers.map((u) => ({
        _id: u.pk, pk: u.pk, username: u.username, name: u.name, email: u.email, active: u.is_active,
        roles: (u.groups || []).map((p) => byPk.get(p)).filter(Boolean),
      })))
    } catch (e) { sendErr(res, e) }
  })

  // Create a user (+ optional password + roles).
  app.post('/api/_users', async (req, res) => {
    if (!requireAdmin(req, res)) return
    try {
      const cfg = await requireAuthentik(res)
      if (!cfg) return
      const body = req.body || {}
      const username = pick(body, 'username')
      const name = pick(body, 'name'); const email = pick(body, 'email')
      if (!username) return res.status(400).json({ error: 'username required' })
      const groups = await resolveGroups(cfg, roleList(pick(body, 'roles')))
      const active = pick(body, 'active')
      // No password given -> auto-generate a temporary one and flag the account
      // so the user is forced to set their own on first sign-in.
      let password = pick(body, 'password')
      let temp = null
      const attributes = {}
      if (!password) { password = temp = tempPassword(); attributes.fmd_must_change = true }
      const u = await ak(cfg, '/core/users/', {
        method: 'POST',
        body: JSON.stringify({ username, name: name || username, email: email || '', is_active: active == null ? true : isOn(active), path: 'users', groups, attributes }),
      })
      await ak(cfg, `/core/users/${u.pk}/set_password/`, { method: 'POST', body: JSON.stringify({ password }) })
      res.json({ ok: true, pk: u.pk, tempPassword: temp })
    } catch (e) { sendErr(res, e) }
  })

  // Edit a user: name/email/active/roles and/or reset password.
  app.patch('/api/_users/:pk', async (req, res) => {
    if (!requireAdmin(req, res)) return
    try {
      const cfg = await requireAuthentik(res)
      if (!cfg) return
      const body = req.body || {}
      const name = pick(body, 'name'); const email = pick(body, 'email')
      const active = pick(body, 'active'); const roles = pick(body, 'roles'); const password = pick(body, 'password')
      const patch = {}
      if (name != null) patch.name = name
      if (email != null) patch.email = email
      if (active != null) patch.is_active = isOn(active)
      if (roles != null) patch.groups = await resolveGroups(cfg, roleList(roles))
      if (Object.keys(patch).length) await ak(cfg, `/core/users/${req.params.pk}/`, { method: 'PATCH', body: JSON.stringify(patch) })
      if (password) await ak(cfg, `/core/users/${req.params.pk}/set_password/`, { method: 'POST', body: JSON.stringify({ password }) })
      res.json({ ok: true })
    } catch (e) { sendErr(res, e) }
  })

  // Delete a user.
  app.delete('/api/_users/:pk', async (req, res) => {
    if (!requireAdmin(req, res)) return
    try {
      const cfg = await requireAuthentik(res)
      if (!cfg) return
      await ak(cfg, `/core/users/${req.params.pk}/`, { method: 'DELETE' })
      res.json({ ok: true })
    } catch (e) { sendErr(res, e) }
  })
}
