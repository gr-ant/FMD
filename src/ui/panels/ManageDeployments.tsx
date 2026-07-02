import React, { useCallback, useEffect, useState } from 'react'
import { useDialogs } from '../dialogs'

interface Table { name: string; columns: string[]; rows: number }
interface Store { name: string; rows: number }
interface SchemaInfo {
  schema: string
  kind: 'editor' | 'deploy'
  slug?: string
  appName?: string
  tables: Table[]
  stores: Store[]
}

// Manage deployed apps: rename, download the .fmd config, or delete (drops the
// schema). Each deployment's live structure (tables/stores) is shown for context,
// plus the editor's working database at the bottom.
export default function ManageDeployments({ onClose }: { onClose: () => void }): React.ReactNode {
  const dialogs = useDialogs()
  const [data, setData] = useState<SchemaInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/_dbinfo')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { schemas: SchemaInfo[] }) => setData(d.schemas))
      .catch((e) => setError(String(e)))
  }, [])
  useEffect(() => { load() }, [load])

  const deployments = (data || []).filter((s) => s.kind === 'deploy')
  const editor = (data || []).find((s) => s.kind === 'editor')

  const rename = async (s: SchemaInfo) => {
    const name = (await dialogs.prompt({ title: 'Rename deployment', message: 'Display name:', defaultValue: s.appName || s.slug, confirmLabel: 'Save' }))?.trim()
    if (!name) return
    const r = await fetch(`/api/_deploy/${encodeURIComponent(s.slug!)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    })
    if (r.ok) { dialogs.toast('Deployment renamed', { kind: 'success' }); load() } else dialogs.toast('Rename failed', { kind: 'error' })
  }

  const changePath = async (s: SchemaInfo) => {
    const raw = (await dialogs.prompt({
      title: 'Change URL path',
      message: `New path — the app will live at /app/<path>.\nChanging it breaks the current /app/${s.slug} link.`,
      defaultValue: s.slug, confirmLabel: 'Change path',
    }))?.trim()
    if (!raw || raw === s.slug) return
    const r = await fetch(`/api/_deploy/${encodeURIComponent(s.slug!)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: raw }),
    })
    const d = await r.json().catch(() => ({}))
    if (r.ok) { dialogs.toast(`Path changed to ${d.url}`, { kind: 'success' }); load() } else dialogs.toast(`Failed: ${d.error || r.status}`, { kind: 'error' })
  }

  const remove = async (s: SchemaInfo) => {
    const ok = await dialogs.confirm({
      title: 'Delete deployment',
      message: `Delete “${s.appName || s.slug}” and drop its database (${s.schema})? This can't be undone.`,
      confirmLabel: 'Delete', danger: true,
    })
    if (!ok) return
    const r = await fetch(`/api/_deploy/${encodeURIComponent(s.slug!)}`, { method: 'DELETE' })
    if (r.ok) { dialogs.toast('Deployment deleted', { kind: 'success' }); load() } else dialogs.toast('Delete failed', { kind: 'error' })
  }

  const download = async (s: SchemaInfo) => {
    try {
      const m = await fetch(`/api/_app/${encodeURIComponent(s.slug!)}/_meta`).then((r) => r.json())
      const blob = new Blob([String(m?.doc ?? '')], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${s.slug}.fmd`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
    } catch { dialogs.toast('Download failed', { kind: 'error' }) }
  }

  const entities = (s: SchemaInfo) => (
    <>
      {s.tables.map((t) => (
        <div className="db-entity" key={t.name}>
          <span className="db-kind" title="SQL table (List)">▦</span>
          <span className="db-entity-name">{t.name}</span>
          <span className="db-rows">{t.rows} row{t.rows === 1 ? '' : 's'}</span>
          <span className="db-cols">{t.columns.join(', ') || '—'}</span>
        </div>
      ))}
      {s.stores.map((st) => (
        <div className="db-entity" key={`s-${st.name}`}>
          <span className="db-kind" title="JSON collection (Store)">⬡</span>
          <span className="db-entity-name">{st.name}</span>
          <span className="db-rows">{st.rows} doc{st.rows === 1 ? '' : 's'}</span>
          <span className="db-cols db-muted">JSON store</span>
        </div>
      ))}
    </>
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal db-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">🚀 Manage Deployments</div>
        {error && <div className="dialog-message">Couldn’t load: {error}</div>}
        {!data && !error && <div className="dialog-message">Loading…</div>}
        <div className="db-list">
          {data && deployments.length === 0 && (
            <div className="db-empty">No deployments yet — deploy a saved app from the Configs ▾ menu (🚀).</div>
          )}
          {deployments.map((s) => (
            <div key={s.schema} className="db-schema db-deploy">
              <div className="db-schema-head">
                <span className="db-badge">DEPLOY</span>
                <span className="db-schema-name">{s.appName || s.slug}</span>
                <a className="db-open" href={`/app/${s.slug}`} target="_blank" rel="noreferrer">/app/{s.slug} ↗</a>
                <div className="db-actions">
                  <button className="db-act" title="Rename" onClick={() => rename(s)}>✎ Rename</button>
                  <button className="db-act" title="Change URL path" onClick={() => changePath(s)}>🔗 Path</button>
                  <button className="db-act" title="Download .fmd config" onClick={() => download(s)}>⤓ Download</button>
                  <button className="db-act db-del" title="Delete deployment" onClick={() => remove(s)}>🗑 Delete</button>
                </div>
              </div>
              {entities(s)}
            </div>
          ))}
          {editor && (
            <div className="db-schema db-editor">
              <div className="db-schema-head">
                <span className="db-badge">EDITOR</span>
                <span className="db-schema-name">Working database</span>
                <span className="db-schema-id">{editor.schema}</span>
              </div>
              {entities(editor)}
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button className="toggle primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
