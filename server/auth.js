// OIDC authentication middleware (Authentik).
// -------------------------------------------------------------
// GRACEFUL DEGRADATION: if OIDC_ISSUER is unset (the normal dev case, and when
// Authentik isn't running) auth is skipped entirely — req.user.roles = ['*']
// ("all"), so nothing is enforced and the app works exactly as before.
//
// When OIDC_ISSUER is set, a valid Bearer JWT (verified against the issuer's
// JWKS) attaches req.user = { sub, roles }, where roles are the lowercased
// `groups` claim. No/invalid token -> anonymous (roles: []); we do NOT 401 here,
// route-level enforcement decides. `jose` is imported lazily so the dev
// container needs it only once Authentik is actually wired.
let issuerMeta = null
let jwks = null

// The public issuer (OIDC_ISSUER, e.g. http://localhost:9000/…) is what the
// browser uses and what lands in the token's `iss` — but from inside the docker
// network the api can't reach `localhost:9000`. OIDC_INTERNAL_ORIGIN (falling
// back to AUTHENTIK_URL, e.g. http://authentik-server:9000) is the in-network
// origin; we rewrite discovery + JWKS fetches to it while still validating the
// token's `iss` against the public issuer.
function internalUrl(u) {
  const internal = process.env.OIDC_INTERNAL_ORIGIN || process.env.AUTHENTIK_URL
  if (!internal || !process.env.OIDC_ISSUER) return u
  try {
    const pub = new URL(process.env.OIDC_ISSUER)
    const url = new URL(u)
    if (url.origin === pub.origin) {
      const intl = new URL(internal)
      url.protocol = intl.protocol
      url.host = intl.host
      return url.toString()
    }
  } catch { /* leave url as-is */ }
  return u
}

async function discover(issuer) {
  if (issuerMeta) return issuerMeta
  const url = internalUrl(issuer.replace(/\/$/, '') + '/.well-known/openid-configuration')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`)
  issuerMeta = await res.json()
  return issuerMeta
}

export function registerAuth(app) {
  // The frontend reads this to know whether (and how) to show login.
  app.get('/api/_auth/config', (req, res) => {
    res.json({ issuer: process.env.OIDC_ISSUER || '', clientId: process.env.OIDC_CLIENT_ID || '' })
  })

  app.use(async (req, res, next) => {
    const issuer = process.env.OIDC_ISSUER
    if (!issuer) {
      // No OIDC configured. Fall fully open ONLY when explicitly opted in
      // (FMD_OPEN=1) so a misconfigured internet-facing deploy doesn't silently
      // grant every caller '*'. Otherwise treat callers as anonymous — undeclared
      // sources still work (allow-by-default), protected ones are denied.
      req.user = { roles: process.env.FMD_OPEN === '1' ? ['*'] : [] }
      return next()
    }

    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) { req.user = { roles: [] }; return next() } // anonymous

    try {
      const { jwtVerify, createRemoteJWKSet } = await import('jose')
      const meta = await discover(issuer)
      if (!jwks) jwks = createRemoteJWKSet(new URL(internalUrl(meta.jwks_uri)))
      // Validate `iss` against the public issuer (what the token actually carries),
      // accepting the discovery doc's issuer too in case they differ by host.
      const expectIss = [issuer.replace(/\/$/, ''), issuer, meta.issuer].filter(Boolean)
      const { payload } = await jwtVerify(token, jwks, { issuer: expectIss })
      const groups = Array.isArray(payload.groups) ? payload.groups : []
      req.user = {
        sub: payload.sub,
        username: payload.preferred_username || payload.email || payload.sub,
        name: payload.name,
        roles: groups.map((g) => String(g).toLowerCase()),
      }
    } catch {
      req.user = { roles: [] } // invalid/expired token -> anonymous
    }
    next()
  })
}
