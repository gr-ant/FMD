// OIDC (Authentik) auth for the browser: Authorization Code + PKCE against a
// public client. Graceful — if /api/_auth/config has no issuer (Authentik not
// configured), everything here is inert and the app runs in open mode.

const TOKEN_KEY = 'fmd_oidc_token'
const ROLES_KEY = 'fmd_oidc_roles'
const VERIFIER_KEY = 'fmd_pkce_verifier'
const STATE_KEY = 'fmd_oidc_state'
const RETURN_KEY = 'fmd_oidc_return'
const REDIRECT = window.location.origin + '/auth/callback'

interface AuthConfig { issuer: string; clientId: string }
let configCache: AuthConfig | null = null

export async function getAuthConfig(): Promise<AuthConfig> {
  if (configCache) return configCache
  try {
    const r = await fetch('/api/_auth/config')
    configCache = r.ok ? await r.json() : { issuer: '', clientId: '' }
  } catch {
    configCache = { issuer: '', clientId: '' }
  }
  return configCache!
}
export async function isAuthConfigured(): Promise<boolean> {
  return !!(await getAuthConfig()).issuer
}

async function discovery(issuer: string): Promise<{ authorization_endpoint: string; token_endpoint: string }> {
  const r = await fetch(issuer.replace(/\/$/, '') + '/.well-known/openid-configuration')
  if (!r.ok) throw new Error('OIDC discovery failed')
  return r.json()
}

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function rand(n: number): string {
  const a = new Uint8Array(n)
  crypto.getRandomValues(a)
  return b64url(a)
}
async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return b64url(new Uint8Array(digest))
}

// Sign in via a popup so the app stays put (no full-page jump). Resolves true
// once a token is stored. The PKCE verifier/state go in localStorage so the
// popup — same-origin when it returns to /auth/callback — can read them. If the
// browser blocks the popup we fall back to a classic full-page redirect.
export async function login(): Promise<boolean> {
  const { issuer, clientId } = await getAuthConfig()
  if (!issuer) return false
  const meta = await discovery(issuer)
  const verifier = rand(32)
  const state = rand(16)
  localStorage.setItem(VERIFIER_KEY, verifier)
  localStorage.setItem(STATE_KEY, state)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'openid profile email',
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  })
  const url = `${meta.authorization_endpoint}?${params}`

  const w = 480, h = 680
  const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2)
  const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2)
  const popup = window.open(url, 'fmd_signin', `width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`)
  if (!popup) {
    sessionStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search)
    window.location.href = url // popup blocked -> full redirect (returns to this page)
    return false
  }

  return new Promise<boolean>((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      window.removeEventListener('message', onMsg)
      clearInterval(poll)
      try { popup.close() } catch { /* ignore */ }
      resolve(ok)
    }
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'fmd-auth') return
      if (e.data.token) {
        sessionStorage.setItem(TOKEN_KEY, e.data.token)
        sessionStorage.setItem(ROLES_KEY, JSON.stringify(e.data.roles || []))
      }
      finish(!!e.data.token)
    }
    window.addEventListener('message', onMsg)
    // If the user closes the popup without finishing, stop waiting.
    const poll = setInterval(() => { if (popup.closed) finish(!!getToken()) }, 500)
  })
}

function decodeJwt(token: string): Record<string, unknown> {
  return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
}
function rolesFromToken(token: string): string[] {
  try {
    const groups = decodeJwt(token).groups
    return Array.isArray(groups) ? groups.map((g) => String(g).toLowerCase()) : []
  } catch {
    return []
  }
}

// Runs at /auth/callback. In a popup: exchange the code, post the result back to
// the opener, and close. In the full-redirect fallback (no opener): store the
// token here and navigate back to the originating page.
export async function handleCallback(): Promise<void> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const inPopup = !!(window.opener && window.opener !== window)
  const verifier = localStorage.getItem(VERIFIER_KEY)
  let token: string | null = null
  let roles: string[] = []
  try {
    if (code && verifier && state && state === localStorage.getItem(STATE_KEY)) {
      const { issuer, clientId } = await getAuthConfig()
      const meta = await discovery(issuer)
      const r = await fetch(meta.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier,
        }),
      })
      if (r.ok) { const tok = await r.json(); token = tok.access_token; roles = rolesFromToken(token) }
    }
  } finally {
    localStorage.removeItem(VERIFIER_KEY)
    localStorage.removeItem(STATE_KEY)
    if (inPopup) {
      try { window.opener.postMessage({ type: 'fmd-auth', token, roles }, window.location.origin) } catch { /* ignore */ }
      window.close()
    } else {
      if (token) {
        sessionStorage.setItem(TOKEN_KEY, token)
        sessionStorage.setItem(ROLES_KEY, JSON.stringify(roles))
      }
      const back = sessionStorage.getItem(RETURN_KEY) || '/'
      sessionStorage.removeItem(RETURN_KEY)
      window.location.replace(back)
    }
  }
}

export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY)
}
export function getRoles(): string[] {
  try { return JSON.parse(sessionStorage.getItem(ROLES_KEY) || '[]') } catch { return [] }
}
export function getUser(): { name: string; roles: string[] } | null {
  const t = getToken()
  if (!t) return null
  try {
    const p = decodeJwt(t)
    return { name: String(p.preferred_username || p.email || p.name || p.sub || 'user'), roles: getRoles() }
  } catch {
    return { name: 'user', roles: getRoles() }
  }
}
export function logout(): void {
  sessionStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(ROLES_KEY)
  window.location.reload()
}

// The editor's "Preview as" roles (the 👁 selector). Set ONLY in the editor
// (App.tsx); null in the deployed app. When set, it GOVERNS data-call access —
// the editor is the author's tool, so they choose what to test ('*' = full
// author access by default) regardless of whether they happen to be signed in.
let previewRoles: string[] | null = null
export function setPreviewRoles(roles: string[] | null): void { previewRoles = roles }

// fetch wrapper for /api data calls. Always attaches the signed-in bearer token
// when present so the server can authenticate the caller. In the editor it ALSO
// sends the "Preview as" role (X-FMD-Roles) — but the server honors that header
// only for an authenticated author (or open dev mode), so it can never be used
// by an anonymous caller to escalate. In a deployed app previewRoles is null, so
// only the real bearer token is sent and the user's true roles govern access.
export function apiFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers || {})
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (previewRoles != null) headers.set('X-FMD-Roles', previewRoles.join(','))
  return fetch(url, { ...opts, headers })
}

// The base URL for a data source. The reserved `users` source is backed by
// Authentik (the /api/_users proxy), not the app's own database. An `api`-kind
// source (declared with an [API] block) reads through the server-side proxy at
// /_ext/<source>, which holds the secret key and does the external fetch +
// field mapping — the document never carries the key. API sources are
// read-only for now, so only the read path passes `kind`.
export function dataBase(apiBase: string, source: string, kind?: string): string {
  if (source === 'users') return '/api/_users'
  if (kind === 'api') return `${apiBase}/_ext/${encodeURIComponent(source)}`
  return `${apiBase}/${encodeURIComponent(source)}`
}
