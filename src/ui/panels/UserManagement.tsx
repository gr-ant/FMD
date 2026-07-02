import React, { useCallback, useEffect, useState } from 'react'
import { useDialogs } from '../dialogs'
import { apiFetch } from '../../state/auth'

interface User { pk: number; username: string; name: string; email: string; active: boolean; roles: string[] }

// User-management window: connect to Authentik (URL + admin token), then
// add / edit / delete users and assign them to roles declared in the config.
export default function UserManagement({ roles, onClose }: { roles: string[]; onClose: () => void }): React.ReactNode {
  const dialogs = useDialogs()
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [url, setUrl] = useState('http://authentik-server:9000')
  const [token, setToken] = useState('')
  const [users, setUsers] = useState<User[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Partial<User> & { password?: string } | null>(null)

  // Turn any error value (string, {detail}, {message}, Authentik field errors,
  // or a raw object) into a readable one-line message instead of "{}".
  const errText = (e: unknown): string => {
    if (e == null) return 'Unknown error'
    if (typeof e === 'string') return e
    if (typeof e === 'object') {
      const o = e as Record<string, unknown>
      if (typeof o.detail === 'string') return o.detail
      if (typeof o.error === 'string') return o.error
      if (typeof o.message === 'string') return o.message
      const parts = Object.entries(o).flatMap(([k, v]) =>
        Array.isArray(v) ? v.map((m) => `${k}: ${m}`) : typeof v === 'string' ? [`${k}: ${v}`] : [])
      if (parts.length) return parts.join('; ')
    }
    return JSON.stringify(e)
  }
  // Reject a failed response with its parsed error body (tolerating non-JSON,
  // e.g. a 502 HTML page when Authentik is unreachable).
  const failBody = async (r: Response): Promise<unknown> =>
    (await r.json().catch((): null => null)) ?? `HTTP ${r.status}`

  const loadUsers = useCallback(() => {
    setError(null)
    apiFetch('/api/_users')
      .then(async (r) => (r.ok ? r.json() : Promise.reject(await failBody(r))))
      .then((u: User[]) => setUsers(u))
      .catch((e) => { setUsers([]); setError(errText(e)) })
  }, [])

  useEffect(() => {
    apiFetch('/api/_users/_status').then((r) => r.json()).then((s: { configured: boolean; url?: string }) => {
      setConfigured(s.configured)
      if (s.url) setUrl(s.url)
      if (s.configured) loadUsers()
    }).catch(() => setConfigured(false))
  }, [loadUsers])

  const saveConnection = async () => {
    const r = await apiFetch('/api/_users/_config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim(), token: token.trim() }),
    })
    if (r.ok) { setConfigured(true); dialogs.toast('Authentik connection saved', { kind: 'success' }); loadUsers() }
    else dialogs.toast('Failed to save connection', { kind: 'error' })
  }

  const blank = (): Partial<User> & { password?: string } => ({ username: '', name: '', email: '', roles: [], active: true, password: '' })

  const save = async () => {
    if (!editing) return
    const isNew = editing.pk == null
    if (isNew && !editing.username?.trim()) { dialogs.toast('Username required', { kind: 'error' }); return }
    const body = { username: editing.username, name: editing.name, email: editing.email, roles: editing.roles, active: editing.active, password: editing.password || undefined }
    const r = await apiFetch(isNew ? '/api/_users' : `/api/_users/${editing.pk}`, {
      method: isNew ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (r.ok) {
      const d = await r.json().catch(() => ({} as { tempPassword?: string }))
      setEditing(null)
      loadUsers()
      if (isNew && d.tempPassword) {
        await dialogs.confirm({
          title: 'User created',
          message: `Temporary password for “${body.username}”:\n\n${d.tempPassword}\n\nShare it with them — they’ll be required to set their own password on first sign-in.`,
          confirmLabel: 'Done',
        })
      } else dialogs.toast(isNew ? 'User created' : 'User updated', { kind: 'success' })
    } else { dialogs.toast(`Failed: ${errText(await failBody(r))}`, { kind: 'error' }) }
  }

  const del = async (u: User) => {
    if (!(await dialogs.confirm({ title: 'Delete user', message: `Delete “${u.username}”?`, confirmLabel: 'Delete', danger: true }))) return
    const r = await apiFetch(`/api/_users/${u.pk}`, { method: 'DELETE' })
    if (r.ok) { dialogs.toast('User deleted', { kind: 'success' }); loadUsers() } else dialogs.toast('Delete failed', { kind: 'error' })
  }

  // Only the roles declared in the config (not Authentik's built-in groups).
  const cfgRoles = new Set(roles.map((r) => r.toLowerCase()))
  const configOnly = (rs: string[] | undefined) => (rs || []).filter((r) => cfgRoles.has(r.toLowerCase()))

  const toggleRole = (role: string) => setEditing((e) => {
    if (!e) return e
    const cur = e.roles || []
    const has = cur.some((r) => r.toLowerCase() === role.toLowerCase())
    // Toggling a config role never touches the user's other (system) groups,
    // which stay in `roles` and are preserved on save.
    return { ...e, roles: has ? cur.filter((r) => r.toLowerCase() !== role.toLowerCase()) : [...cur, role] }
  })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal um-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">👤 User Management</div>

        {configured === false && (
          <div className="um-connect">
            <div className="dialog-message">Connect to Authentik to manage users. Create an admin API token in Authentik (Directory → Tokens).</div>
            <label className="form-field"><span className="form-label">Authentik URL</span>
              <input className="form-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://authentik-server:9000" /></label>
            <label className="form-field"><span className="form-label">Admin API token</span>
              <input className="form-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="ak-…" /></label>
            <div className="modal-actions"><button className="toggle primary" onClick={saveConnection} disabled={!token.trim()}>Connect</button></div>
          </div>
        )}

        {configured && (
          <>
            {error && <div className="dialog-message um-err">{error}</div>}
            <div className="um-toolbar">
              <button className="toggle primary" onClick={() => setEditing(blank())}>＋ New user</button>
              <button className="toggle" onClick={() => setConfigured(false)} title="Authentik connection">⚙ Connection</button>
            </div>

            {editing && (
              <div className="um-form">
                <div className="um-form-row">
                  <label className="form-field"><span className="form-label">Username</span>
                    <input className="form-input" value={editing.username || ''} disabled={editing.pk != null}
                      onChange={(e) => setEditing({ ...editing, username: e.target.value })} /></label>
                  <label className="form-field"><span className="form-label">Name</span>
                    <input className="form-input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
                </div>
                <div className="um-form-row">
                  <label className="form-field"><span className="form-label">Email</span>
                    <input className="form-input" value={editing.email || ''} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></label>
                  <label className="form-field"><span className="form-label">{editing.pk == null ? 'Password' : 'Reset password (optional)'}</span>
                    <input className="form-input" type="password" value={editing.password || ''} onChange={(e) => setEditing({ ...editing, password: e.target.value })} /></label>
                </div>
                <div className="um-roles">
                  <span className="form-label">Roles</span>
                  <div className="um-role-chips">
                    {roles.length === 0 && <span className="muted-cell">No [Role]s declared in the config.</span>}
                    {roles.map((r) => (
                      <label key={r} className={`um-chip${(editing.roles || []).includes(r) ? ' on' : ''}`}>
                        <input type="checkbox" checked={(editing.roles || []).some((x) => x.toLowerCase() === r.toLowerCase())} onChange={() => toggleRole(r)} />{r}
                      </label>
                    ))}
                  </div>
                </div>
                <label className="um-active"><input type="checkbox" checked={editing.active !== false} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active</label>
                <div className="modal-actions">
                  <button className="toggle" onClick={() => setEditing(null)}>Cancel</button>
                  <button className="toggle primary" onClick={save}>{editing.pk == null ? 'Create' : 'Save'}</button>
                </div>
              </div>
            )}

            <div className="um-list">
              {users == null && <div className="dialog-message">Loading…</div>}
              {users && users.length === 0 && !error && <div className="db-empty">No users yet.</div>}
              {(users || []).map((u) => (
                <div className={`um-user${u.active ? '' : ' inactive'}`} key={u.pk}>
                  <span className="um-user-name">{u.name || u.username}<span className="um-username">@{u.username}</span></span>
                  <span className="um-user-roles">{configOnly(u.roles).length ? configOnly(u.roles).join(', ') : <span className="muted-cell">no roles</span>}</span>
                  <button className="db-act" onClick={() => setEditing({ ...u, password: '' })}>✎ Edit</button>
                  <button className="db-act db-del" onClick={() => del(u)}>🗑</button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="modal-actions"><button className="toggle" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}
