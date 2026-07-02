import React, { useCallback, useEffect, useState } from 'react'
import Preview from './Preview'
import { parseFMD, collectRoles } from '../parser'
import { isAuthConfigured, getToken, getRoles, getUser, login, logout, apiFetch } from '../state/auth'

// Does this deployed config gate on sign-in? True if it declares roles or has a
// [User Management] element — i.e. it's role-aware.
function requiresSignIn(doc: string): boolean {
  const tree = parseFMD(doc)
  if (collectRoles(tree).length > 0) return true
  let found = false
  const walk = (n: { type: string; children?: unknown[] }) => {
    if (n.type === 'UserManagement') found = true
    for (const c of (n.children || []) as { type: string; children?: unknown[] }[]) walk(c)
  }
  walk(tree as unknown as { type: string; children?: unknown[] })
  return found
}

// First-login password reset: shown when /api/_users/_me reports must-change
// (i.e. the account was created with an auto-generated temporary password).
function ChangePassword({ name, onDone }: { name: string; onDone: () => void }): React.ReactNode {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (pw !== confirm) { setErr('Passwords don’t match.'); return }
    setBusy(true); setErr(null)
    try {
      const r = await apiFetch('/api/_users/_me/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword: pw }),
      })
      if (r.ok) onDone()
      else { const d = await r.json().catch(() => ({})); setErr(typeof d.error === 'string' ? d.error : 'Could not set password.') }
    } catch { setErr('Could not set password.') } finally { setBusy(false) }
  }

  return (
    <div className="published-status">
      <h2>Set your password</h2>
      <p>Welcome{name ? `, ${name}` : ''}. Choose a new password to finish signing in.</p>
      <div className="pw-form">
        <input className="form-input" type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} />
        <input className="form-input" type="password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        {err && <div className="dialog-message um-err">{err}</div>}
        <button className="toggle primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Set password'}</button>
      </div>
    </div>
  )
}

// The deployed-app view served at /app/<slug>: no editor, just the running app.
// Loads the published document and points data calls at /api/_app/<slug>. If the
// config is role-aware and Authentik is configured, it requires sign-in first.
export default function PublishedApp({ slug }: { slug: string }): React.ReactNode {
  const [state, setState] = useState<{ doc: string; name: string } | null | 'error'>(null)
  const [gate, setGate] = useState<'loading' | 'open' | 'signin' | 'mustchange' | 'in'>('loading')

  // Decide the gate for a role-aware app: signed out -> sign in; signed in but
  // owing a first-login password change -> mustchange; otherwise -> in.
  const evaluateSignedIn = useCallback(async () => {
    if (!getToken()) { setGate('signin'); return }
    try {
      const r = await apiFetch('/api/_users/_me')
      const me = r.ok ? await r.json() : { mustChange: false }
      setGate(me.mustChange ? 'mustchange' : 'in')
    } catch { setGate('in') }
  }, [])

  const onSignIn = useCallback(async () => {
    const ok = await login()
    if (ok) evaluateSignedIn()
  }, [evaluateSignedIn])

  useEffect(() => {
    fetch(`/api/_app/${encodeURIComponent(slug)}/_meta`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(async (m: { doc: string; name: string }) => {
        setState(m)
        const needs = requiresSignIn(m.doc)
        if (!needs) { setGate('open'); return }
        const configured = await isAuthConfigured()
        if (!configured) { setGate('open'); return } // no IdP -> can't gate; stay open
        await evaluateSignedIn()
      })
      .catch(() => setState('error'))
  }, [slug, evaluateSignedIn])

  if (state === null || gate === 'loading') return <div className="published-status">Loading “{slug}” …</div>
  if (state === 'error') {
    return (
      <div className="published-status">
        <h2>App not found</h2>
        <p>No deployed app at <code>/app/{slug}</code>. Deploy it from the editor’s Configs menu.</p>
      </div>
    )
  }

  if (gate === 'signin') {
    return (
      <div className="published-status">
        <h2>{state.name}</h2>
        <p>Please sign in to continue.</p>
        <button className="toggle primary" onClick={onSignIn}>Sign in</button>
      </div>
    )
  }

  if (gate === 'mustchange') {
    const u = getUser()
    return <ChangePassword name={u?.name || ''} onDone={() => setGate('in')} />
  }

  const roles = gate === 'in' ? getRoles() : ['*']
  const user = getUser()
  return (
    <>
      {gate === 'in' && user && (
        <div className="published-userbar">
          <span>Signed in as <strong>{user.name}</strong>{user.roles.length ? ` · ${user.roles.join(', ')}` : ''}</span>
          <button className="toggle" onClick={() => logout()}>Sign out</button>
        </div>
      )}
      <Preview source={state.doc} apiBase={`/api/_app/${slug}`} roles={roles} />
    </>
  )
}
