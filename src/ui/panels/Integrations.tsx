import React, { useCallback, useEffect, useState } from 'react'
import { useDialogs } from '../dialogs'

// A saved connection as the SERVER returns it — redacted (never the secret token,
// only whether one is set). Mirrors redact() in server/connections.js.
interface RedactedConn {
  name: string
  type: string
  baseUrl: string
  authKind: 'none' | 'bearer' | 'header'
  headerName: string
  hasSecret: boolean
  headers: Record<string, string>
}

// Type presets — scaffolding so a real integration can be dropped in later.
// `fixedAuth` types (slack) carry their credential inside the webhook URL, so
// they hide the auth controls.
interface Preset { label: string; baseLabel: string; authKind: RedactedConn['authKind']; fixedAuth: boolean; sampleBody: string; note: string }
const PRESETS: Record<string, Preset> = {
  slack: { label: 'Slack — incoming webhook', baseLabel: 'Webhook URL', authKind: 'none', fixedAuth: true, sampleBody: '{ "text": "Hello from FMD 👋" }', note: 'Paste the Slack incoming-webhook URL. The whole URL is the secret; it stays server-side.' },
  rest: { label: 'REST — generic', baseLabel: 'Base URL', authKind: 'bearer', fixedAuth: false, sampleBody: '{ "hello": "world" }', note: 'A generic REST endpoint. The path from [Post -> @name/path] is appended to the base URL.' },
  email: { label: 'Email (stub preset)', baseLabel: 'Base URL', authKind: 'bearer', fixedAuth: false, sampleBody: '{ "to": "", "subject": "", "text": "" }', note: 'Scaffolding preset — point at an email-sending API (e.g. a transactional provider).' },
  twilio: { label: 'Twilio SMS (stub preset)', baseLabel: 'Base URL', authKind: 'header', fixedAuth: false, sampleBody: '{ "To": "", "Body": "" }', note: 'Scaffolding preset — point at an SMS API. Header auth by default.' },
}
const TYPES = Object.keys(PRESETS)

// The editable form state for one connection.
interface Draft {
  name: string
  type: string
  baseUrl: string
  authKind: RedactedConn['authKind']
  headerName: string
  token: string // blank = leave the stored secret untouched (on edit)
  hasSecret: boolean
  isNew: boolean
}
const emptyDraft = (): Draft => ({ name: '', type: 'rest', baseUrl: '', authKind: 'bearer', headerName: '', token: '', hasSecret: false, isNew: true })

// The Integrations library: manage named outbound connections (Slack / REST /
// email / SMS). Secrets are entered here but live ONLY server-side — the list
// shows a redacted status. A "Test" fires a sample call through /api/_call.
export default function Integrations({ onClose }: { onClose: () => void }): React.ReactNode {
  const dialogs = useDialogs()
  const [list, setList] = useState<RedactedConn[] | null>(null)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [testPath, setTestPath] = useState('')
  const [testBody, setTestBody] = useState(PRESETS.rest.sampleBody)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ status: number; ok: boolean; body: unknown } | null>(null)

  const load = useCallback(() => {
    fetch('/api/_conns')
      .then((r): Promise<RedactedConn[]> => (r.ok ? r.json() : Promise.resolve([])))
      .then(setList)
      .catch(() => setList([]))
  }, [])
  useEffect(() => { load() }, [load])

  const preset = PRESETS[draft.type] || PRESETS.rest

  // Pull an existing connection into the editor (secret stays blank = untouched).
  function edit(c: RedactedConn): void {
    setDraft({ name: c.name, type: c.type, baseUrl: c.baseUrl, authKind: c.authKind, headerName: c.headerName, token: '', hasSecret: c.hasSecret, isNew: false })
    setTestBody((PRESETS[c.type] || PRESETS.rest).sampleBody)
    setResult(null)
  }

  function pickType(type: string): void {
    const p = PRESETS[type] || PRESETS.rest
    setDraft((d) => ({ ...d, type, authKind: p.fixedAuth ? 'none' : d.authKind }))
    setTestBody(p.sampleBody)
  }

  async function save(): Promise<void> {
    const name = draft.name.trim()
    if (!name) { dialogs.toast('Name is required', { kind: 'error' }); return }
    if (!draft.baseUrl.trim()) { dialogs.toast(`${preset.baseLabel} is required`, { kind: 'error' }); return }
    const body = {
      name, type: draft.type, baseUrl: draft.baseUrl.trim(),
      auth: { kind: draft.authKind, headerName: draft.headerName.trim(), ...(draft.token ? { token: draft.token } : {}) },
    }
    const r = await fetch(`/api/_conn/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (r.ok) { dialogs.toast(`Saved “${name}”`, { kind: 'success' }); setDraft(emptyDraft()); load() }
    else dialogs.toast('Save failed', { kind: 'error' })
  }

  async function remove(c: RedactedConn): Promise<void> {
    if (!(await dialogs.confirm({ title: 'Delete connection', message: `Delete “${c.name}”? Steps that call @${c.name} will stop working.`, confirmLabel: 'Delete', danger: true }))) return
    const r = await fetch(`/api/_conn/${encodeURIComponent(c.name)}`, { method: 'DELETE' })
    if (r.ok) { dialogs.toast('Deleted', { kind: 'success' }); load() } else dialogs.toast('Delete failed', { kind: 'error' })
  }

  // Fire a sample call through the server executor and show the redacted result.
  async function test(name: string): Promise<void> {
    setTesting(true); setResult(null)
    let parsed: unknown = {}
    try { parsed = testBody.trim() ? JSON.parse(testBody) : {} } catch { dialogs.toast('Test body is not valid JSON', { kind: 'error' }); setTesting(false); return }
    try {
      const r = await fetch(`/api/_call/${encodeURIComponent(name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: testPath.trim(), method: 'POST', body: parsed }),
      })
      setResult(await r.json())
    } catch (e) {
      setResult({ status: 0, ok: false, body: String(e) })
    } finally { setTesting(false) }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal conn-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">🔌 Integrations — outbound connections</div>
        <p className="conn-intro">Named ways to call OUT to a service. Reference one from an action with <code>[Post -&gt; @name/path]</code>. Secrets are stored server-side and never sent back to the browser.</p>

        <div className="conn-body">
          <div className="conn-list">
            {list === null && <div className="conn-empty">Loading…</div>}
            {list && list.length === 0 && <div className="conn-empty">No connections yet. Create one on the right.</div>}
            {list && list.map((c) => (
              <div className="conn-row" key={c.name}>
                <div className="conn-row-main">
                  <span className={`conn-badge conn-${c.type}`}>{c.type}</span>
                  <span className="conn-name">{c.name}</span>
                  <span className="conn-url" title={c.baseUrl}>{c.baseUrl}</span>
                </div>
                <div className="conn-row-meta">
                  <span className={`conn-secret ${c.hasSecret ? 'set' : 'none'}`}>{c.hasSecret ? '🔒 secret set' : 'no secret'}</span>
                  <span className="conn-auth">{c.authKind === 'none' ? '' : c.authKind === 'header' ? `header: ${c.headerName || '—'}` : 'bearer'}</span>
                  <div className="conn-acts">
                    <button className="db-act" onClick={() => edit(c)}>✎ Edit</button>
                    <button className="db-act" onClick={() => test(c.name)} disabled={testing}>▶ Test</button>
                    <button className="db-act db-del" onClick={() => remove(c)}>🗑</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="conn-form">
            <div className="conn-form-head">{draft.isNew ? 'New connection' : `Edit “${draft.name}”`}</div>
            <label className="conn-field"><span>Name</span>
              <input className="form-input" value={draft.name} disabled={!draft.isNew} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. alerts" />
            </label>
            <label className="conn-field"><span>Type</span>
              <select className="form-input" value={draft.type} onChange={(e) => pickType(e.target.value)}>
                {TYPES.map((t) => <option key={t} value={t}>{PRESETS[t].label}</option>)}
              </select>
            </label>
            <label className="conn-field"><span>{preset.baseLabel}</span>
              <input className="form-input" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder={preset.fixedAuth ? 'https://hooks.slack.com/services/…' : 'https://api.example.com'} />
            </label>
            {!preset.fixedAuth && (
              <>
                <label className="conn-field"><span>Auth</span>
                  <select className="form-input" value={draft.authKind} onChange={(e) => setDraft({ ...draft, authKind: e.target.value as RedactedConn['authKind'] })}>
                    <option value="none">None</option>
                    <option value="bearer">Bearer token</option>
                    <option value="header">Custom header</option>
                  </select>
                </label>
                {draft.authKind === 'header' && (
                  <label className="conn-field"><span>Header name</span>
                    <input className="form-input" value={draft.headerName} onChange={(e) => setDraft({ ...draft, headerName: e.target.value })} placeholder="X-Api-Key" />
                  </label>
                )}
                {draft.authKind !== 'none' && (
                  <label className="conn-field"><span>Secret {draft.hasSecret && !draft.token && <em className="conn-hint">(stored — leave blank to keep)</em>}</span>
                    <input className="form-input" type="password" value={draft.token} onChange={(e) => setDraft({ ...draft, token: e.target.value })} placeholder={draft.hasSecret ? '•••••••• saved' : 'paste secret key'} />
                  </label>
                )}
              </>
            )}
            <p className="conn-note">{preset.note}</p>
            <div className="conn-form-acts">
              {!draft.isNew && <button className="toggle" onClick={() => setDraft(emptyDraft())}>Cancel</button>}
              <button className="toggle primary" onClick={save}>{draft.isNew ? 'Create' : 'Save'}</button>
            </div>

            <div className="conn-test">
              <div className="conn-form-head">Test</div>
              <label className="conn-field"><span>Path (appended to base URL)</span>
                <input className="form-input" value={testPath} onChange={(e) => setTestPath(e.target.value)} placeholder="/ or /messages" />
              </label>
              <label className="conn-field"><span>Body (JSON)</span>
                <textarea className="form-input memo-input" value={testBody} onChange={(e) => setTestBody(e.target.value)} />
              </label>
              <div className="conn-form-acts">
                <span className="conn-hint">Saves first, then run Test on a row at left.</span>
              </div>
              {result && (
                <div className={`conn-result ${result.ok ? 'ok' : 'bad'}`}>
                  <div className="conn-result-head">{result.ok ? '✓' : '✕'} HTTP {result.status}</div>
                  <pre>{typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="modal-actions">
          <button className="toggle" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
