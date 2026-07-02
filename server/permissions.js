// Server-side permission enforcement helpers for the data CRUD routes.
// The permission model (from a doc's [Permission] blocks) is stored in
// _fmd_configs under key "permissions":
//   { [source]: { [roleLower]: ["read","create","update","delete"] } }
import { pool, qn } from './db.js'

// HTTP method -> CRUD verb.
export const VERB_FOR = { GET: 'read', POST: 'create', PATCH: 'update', DELETE: 'delete' }

// The permission model for a schema ('public' = the editor's working DB; an
// 'app_<slug>' schema = a deployed app). Stored in that schema's _fmd_configs.
export async function loadPermissions(schema = 'public') {
  try {
    const { rows } = await pool.query(`SELECT value FROM ${qn(schema, '_fmd_configs')} WHERE key = 'permissions'`)
    return rows[0]?.value || {}
  } catch {
    return {}
  }
}

// Allow if: open dev mode ('*'); OR the entity has no [Permission] block (only
// protected entities are enforced — backward compatible); OR one of the user's
// roles grants the verb on this source.
export function isAllowed(perms, source, verb, roles) {
  const r = roles || []
  if (r.includes('*')) return true
  const ent = perms[source]
  if (!ent) return true
  return r.some((role) => Array.isArray(ent[role]) && ent[role].includes(verb))
}

// Express guard: allow/deny a data request for the caller's effective roles.
// Options:
//   schema      — which permission model to enforce (default 'public' = editor).
//   requireAuth — deployed apps: when a PROTECTED source denies an anonymous
//                 caller, answer 401 (prompt sign-in) instead of a dead 403, and
//                 NEVER honor the X-FMD-Roles preview header (real roles only).
// A source with NO [Permission] stays public (isAllowed is true for any roles,
// including anonymous []), so open apps remain accessible without sign-in — only
// sources that declare a permission require the granting role. The X-FMD-Roles
// header ("Preview as") is honored ONLY on the editor routes and only for a
// trusted caller (an authenticated author, or open dev mode); an anonymous
// caller can never assert roles.
export async function guard(req, res, source, method, { schema = 'public', requireAuth = false } = {}) {
  const secured = !!process.env.OIDC_ISSUER
  const perms = await loadPermissions(schema)
  let roles = req.user?.roles || []
  const mayPreview = !requireAuth && (secured ? !!req.user?.sub : true)
  if (mayPreview && req.headers['x-fmd-roles'] !== undefined) {
    roles = String(req.headers['x-fmd-roles']).split(',').map((s) => s.trim()).filter(Boolean)
  }
  if (isAllowed(perms, source, VERB_FOR[method] || 'read', roles)) return true
  // Denied: on a deployed app, an anonymous hit to a protected source prompts
  // sign-in (they may hold the role once authenticated); otherwise it's a 403.
  if (requireAuth && secured && !req.user?.sub) {
    res.status(401).json({ error: 'sign-in required' })
    return false
  }
  res.status(403).json({ error: 'forbidden' })
  return false
}

// Require an authenticated admin (a user holding the `admin` role, or open dev
// mode). Used to protect the /api/_users* management surface. Returns true when
// allowed; otherwise sends 401/403 and returns false.
export function requireAdmin(req, res) {
  const secured = !!process.env.OIDC_ISSUER
  const roles = req.user?.roles || []
  if (!secured || roles.includes('*')) return true // open dev mode
  if (!req.user?.sub) { res.status(401).json({ error: 'sign-in required' }); return false }
  if (!roles.includes('admin')) { res.status(403).json({ error: 'admin role required' }); return false }
  return true
}
