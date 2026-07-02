// Named outbound connections — the integration library's server side.
// -------------------------------------------------------------
// A "connection" is a saved, reusable way to call OUT to a third-party service
// (Slack, a generic REST API, email/SMS later). It lives in the existing
// `_fmd_configs` key/value table under the key `conn:<name>` (name lowercased).
//
// Stored value shape (key `conn:<name>`):
//   { name, type, baseUrl, auth: { kind, token?, headerName? }, headers }
//   - type:    'slack' | 'rest' | 'email' | 'twilio'  (presets; scaffolding)
//   - baseUrl: the endpoint the call is made against (for slack = the incoming
//              webhook URL; for rest = the API base that `path` is appended to)
//   - auth:    the SECRET credential. `kind`:
//                'none'   — no auth
//                'bearer' — Authorization: Bearer <token>
//                'header' — <headerName>: <token>  (e.g. X-Api-Key)
//              `token` is the secret; it lives ONLY here and is NEVER returned
//              to the browser (see redact()).
//   - headers: static, non-secret headers merged into every call.
//
// This mirrors the server-side-credential + outbound-fetch pattern in ext.js:
// the client asks the server to make the call by name; the key stays server-side.
import { pool } from './db.js'

const keyFor = (name) => `conn:${String(name || '').trim().toLowerCase()}`

// Read the raw (secret-bearing) connection config, or null.
export async function readConnection(name) {
  const { rows } = await pool.query('SELECT value FROM _fmd_configs WHERE key = $1', [keyFor(name)])
  return rows.length ? rows[0].value : null
}

// Strip secrets before anything goes to the client: the token never leaves the
// server. The UI sees only whether a secret is set, plus the non-secret shape.
function redact(name, cfg) {
  const auth = cfg.auth || {}
  return {
    name: cfg.name || name,
    type: cfg.type || 'rest',
    baseUrl: cfg.baseUrl || '',
    authKind: auth.kind || 'none',
    headerName: auth.headerName || '',
    hasSecret: Boolean(auth.token),
    headers: cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {},
  }
}

// Perform the outbound call. Merges baseUrl + path, applies the connection's auth
// + static headers SERVER-SIDE, fetches, and returns a redacted result. Reused by
// the /api/_call route (client-driven) AND by server-side triggers.
export async function performCall(cfg, { path = '', method = 'POST', body = {} } = {}) {
  const m = String(method || 'POST').toUpperCase()
  let url = String(cfg.baseUrl || '')
  const p = String(path || '')
  if (p) url = url.replace(/\/+$/, '') + (p.startsWith('/') ? p : '/' + p)

  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (cfg.headers && typeof cfg.headers === 'object') Object.assign(headers, cfg.headers)
  const auth = cfg.auth || {}
  if (auth.token) {
    if (auth.kind === 'header') headers[auth.headerName || 'Authorization'] = auth.token
    else if (auth.kind === 'bearer') headers.Authorization = `Bearer ${auth.token}`
  }

  const hasBody = m !== 'GET' && m !== 'HEAD'
  let r
  try {
    r = await fetch(url, { method: m, headers, ...(hasBody ? { body: JSON.stringify(body ?? {}) } : {}) })
  } catch (e) {
    return { status: 0, ok: false, body: `fetch failed: ${e?.message || String(e)}` }
  }
  const text = await r.text()
  let parsed
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text } // slack replies "ok" as text
  return { status: r.status, ok: r.ok, body: parsed }
}

// Look up a connection by name and call it. Throws { status, body } if missing.
export async function callConnection(name, opts) {
  const cfg = await readConnection(name)
  if (!cfg) throw { status: 404, body: `no connection named "${name}"` }
  return performCall(cfg, opts || {})
}

export function registerConnectionRoutes(app) {
  // List every saved connection, redacted (never any secret).
  app.get('/api/_conns', async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT key, value FROM _fmd_configs WHERE key LIKE 'conn:%' ORDER BY key")
      res.json(rows.map((r) => redact(r.key.slice('conn:'.length), r.value || {})))
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })

  // One connection, redacted.
  app.get('/api/_conn/:name', async (req, res) => {
    try {
      const cfg = await readConnection(req.params.name)
      if (!cfg) return res.status(404).json({ error: 'not found' })
      res.json(redact(req.params.name, cfg))
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })

  // Create / update a connection. The secret token is merged: when the client
  // omits it (or sends a blank), an already-stored token is preserved — so the
  // UI can edit a connection without ever re-entering (or seeing) the secret.
  app.put('/api/_conn/:name', async (req, res) => {
    try {
      const b = req.body || {}
      const prev = (await readConnection(req.params.name)) || {}
      const prevAuth = prev.auth || {}
      const inAuth = b.auth || {}
      const kind = inAuth.kind || prevAuth.kind || 'none'
      const token = (typeof inAuth.token === 'string' && inAuth.token !== '') ? inAuth.token : prevAuth.token
      const value = {
        name: b.name || prev.name || req.params.name,
        type: b.type || prev.type || 'rest',
        baseUrl: typeof b.baseUrl === 'string' ? b.baseUrl : (prev.baseUrl || ''),
        auth: { kind, headerName: inAuth.headerName ?? prevAuth.headerName ?? '', ...(token ? { token } : {}) },
        headers: (b.headers && typeof b.headers === 'object') ? b.headers : (prev.headers || {}),
      }
      await pool.query(
        `INSERT INTO _fmd_configs (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [keyFor(req.params.name), JSON.stringify(value)])
      res.json(redact(req.params.name, value))
    } catch (e) { res.status(500).json({ error: String(e) }) }
  })

  app.delete('/api/_conn/:name', async (req, res) => {
    try { await pool.query('DELETE FROM _fmd_configs WHERE key = $1', [keyFor(req.params.name)]); res.json({ ok: true }) }
    catch (e) { res.status(500).json({ error: String(e) }) }
  })

  // The outbound executor: POST /api/_call/:connection { path?, method?, body? }.
  // Merges baseUrl + auth server-side and performs the fetch. Used by the client
  // "Test" button, by [Post]/[Call] action steps, and (indirectly) by triggers.
  app.post('/api/_call/:connection', async (req, res) => {
    try {
      const { path, method, body } = req.body || {}
      res.json(await callConnection(req.params.connection, { path, method, body }))
    } catch (e) {
      if (e && e.status) return res.status(e.status).json({ status: e.status, ok: false, body: e.body })
      res.status(500).json({ status: 500, ok: false, body: String(e) })
    }
  })
}
