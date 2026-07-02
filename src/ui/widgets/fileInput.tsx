// Upload + view components for [File]/[Files] fields. The field value is a JSON
// descriptor { id, name, mime } (or an array for [Files]); the bytes live on the
// server. Downloads are PERMISSION-CHECKED (a file inherits its source's read
// access), and a browser <img src> can't send an auth header — so every file is
// fetched through apiFetch (which carries the bearer / editor header) and rendered
// from the resulting blob. Images preview as thumbnails; others show named links.
import React, { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../state/auth'
import { useApiBase } from '../../data'

export type FileRef = { id: string; name: string; mime?: string; size?: number }

const isImg = (r: FileRef): boolean => /^image\//.test(r.mime || '')
const filesBase = (apiBase: string): string => `${String(apiBase).replace(/\/$/, '')}/_files`

// Parse a stored field value (JSON string, object, or array) into a list of refs.
export function parseRefs(value: unknown): FileRef[] {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((v) => v && v.id)
  if (typeof value === 'object') return (value as FileRef).id ? [value as FileRef] : []
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return []
    try {
      const p = JSON.parse(s)
      return Array.isArray(p) ? p.filter((v) => v && v.id) : (p && p.id ? [p] : [])
    } catch { return [] }
  }
  return []
}

// Fetch a file (auth carried by apiFetch) as a blob object URL; revoke on cleanup.
function useBlobUrl(id: string | null): { url: string | null; err: boolean } {
  const base = useApiBase()
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!id) return
    let alive = true
    let obj: string | null = null
    apiFetch(`${filesBase(base)}/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => { if (!alive) return; obj = URL.createObjectURL(blob); setUrl(obj) })
      .catch(() => alive && setErr(true))
    return () => { alive = false; if (obj) URL.revokeObjectURL(obj) }
  }, [id, base])
  return { url, err }
}

// Fetch a file and open it in a new tab or force a download (used on click).
async function grabFile(base: string, r: FileRef, mode: 'open' | 'download'): Promise<void> {
  const res = await apiFetch(`${filesBase(base)}/${encodeURIComponent(r.id)}`)
  if (!res.ok) return
  const url = URL.createObjectURL(await res.blob())
  if (mode === 'open') { window.open(url, '_blank', 'noopener') }
  else {
    const a = document.createElement('a')
    a.href = url; a.download = r.name || 'file'
    document.body.appendChild(a); a.click(); a.remove()
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}

// An image thumbnail loaded via an authenticated blob fetch.
function FileImage({ r, cls, onClick }: { r: FileRef; cls: string; onClick?: () => void }): React.ReactNode {
  const { url, err } = useBlobUrl(r.id)
  if (err) return <span className={`${cls} file-broken`} title="Not available">🔒</span>
  if (!url) return <span className={`${cls} file-loading`} />
  return <img className={cls} src={url} alt={r.name} onClick={onClick} style={onClick ? { cursor: 'zoom-in' } : undefined} />
}

// Native <input accept> attribute from an (img, pdf) list.
function acceptAttr(accept: string[] | null | undefined): string | undefined {
  if (!accept || !accept.length) return undefined
  return accept.map((a) => (a === 'img' || a === 'image' ? 'image/*' : a === 'pdf' ? '.pdf' : '.' + a)).join(',')
}
// Client-side check that a picked file matches the (img, pdf) restriction.
function acceptOk(file: File, accept: string[] | null | undefined): boolean {
  if (!accept || !accept.length) return true
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  const mime = (file.type || '').toLowerCase()
  return accept.some((a) => {
    if (a === 'img' || a === 'image') return mime.startsWith('image/')
    if (a === 'pdf') return mime === 'application/pdf' || ext === 'pdf'
    return ext === a || mime.endsWith('/' + a)
  })
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const rd = new FileReader()
    rd.onload = () => { const s = String(rd.result); resolve(s.slice(s.indexOf(',') + 1)) } // strip data:…;base64,
    rd.onerror = () => reject(new Error('read failed'))
    rd.readAsDataURL(file)
  })

async function uploadFile(file: File, source?: string | null): Promise<FileRef> {
  const data = await fileToBase64(file)
  const r = await apiFetch('/api/_files', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, mime: file.type || 'application/octet-stream', source: source || null, data }),
  })
  if (!r.ok) throw new Error((await r.json().catch(() => ({ error: '' }))).error || `upload failed (${r.status})`)
  return r.json()
}

// A preview chip: thumbnail for images, an icon + name for everything else.
// Clicking an image opens it; the name (or a non-image) downloads.
function FileChip({ r, onRemove }: { r: FileRef; onRemove?: () => void }): React.ReactNode {
  const base = useApiBase()
  return (
    <span className="file-chip">
      {isImg(r)
        ? <FileImage r={r} cls="file-thumb" onClick={() => grabFile(base, r, 'open')} />
        : <button type="button" className="file-link" onClick={() => grabFile(base, r, 'download')}>📄 {r.name}</button>}
      {isImg(r) && <button type="button" className="file-name" onClick={() => grabFile(base, r, 'download')}>{r.name}</button>}
      {onRemove && <button type="button" className="file-remove" title="Remove" onClick={onRemove}>×</button>}
    </span>
  )
}

type FileInputProps = {
  value: unknown
  onChange: (v: unknown) => void
  accept?: string[] | null
  multiple?: boolean // true for a [Files] field
  source?: string | null // owning entity, recorded on upload for access control
}
export function FileInput({ value, onChange, accept, multiple, source }: FileInputProps): React.ReactNode {
  const refs = parseRefs(value)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const store = (list: FileRef[]): void =>
    onChange(multiple ? (list.length ? JSON.stringify(list) : '') : (list[0] ? JSON.stringify(list[0]) : ''))

  const pick = async (files: FileList | null): Promise<void> => {
    if (!files || !files.length) return
    setErr(null)
    const chosen = Array.from(files)
    const bad = chosen.find((f) => !acceptOk(f, accept))
    if (bad) { setErr(`“${bad.name}” isn’t an allowed type (${(accept || []).join(', ')})`); return }
    setBusy(true)
    try {
      const uploaded: FileRef[] = []
      for (const f of chosen) uploaded.push(await uploadFile(f, source))
      store(multiple ? [...refs, ...uploaded] : uploaded.slice(0, 1))
    } catch (e) { setErr(e instanceof Error ? e.message : 'upload failed') }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = '' }
  }

  return (
    <div className="file-input">
      {refs.length > 0 && (
        <div className="file-chips">
          {refs.map((r, i) => (
            <FileChip key={r.id || i} r={r} onRemove={() => store(refs.filter((_, j) => j !== i))} />
          ))}
        </div>
      )}
      {(multiple || refs.length === 0) && (
        <button type="button" className="file-pick" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Uploading…' : multiple ? '＋ Add file' : '⬆ Upload'}
        </button>
      )}
      {!multiple && refs.length > 0 && (
        <button type="button" className="file-pick file-replace" disabled={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Uploading…' : 'Replace'}
        </button>
      )}
      <input ref={inputRef} type="file" className="file-hidden" multiple={multiple}
        accept={acceptAttr(accept)} onChange={(e) => pick(e.target.files)} />
      {err && <div className="file-error">{err}</div>}
    </div>
  )
}

// One row in the "list" layout: a small thumb/icon, the name, and a download link.
function FileRow({ r }: { r: FileRef }): React.ReactNode {
  const base = useApiBase()
  return (
    <span className="file-row">
      {isImg(r) ? <FileImage r={r} cls="file-row-thumb" /> : <span className="file-row-icon">📄</span>}
      <button type="button" className="file-row-name" onClick={() => grabFile(base, r, 'download')}>{r.name}</button>
      <button type="button" className="file-row-dl" title="Download" onClick={() => grabFile(base, r, 'download')}>↓</button>
    </span>
  )
}

// Read-only render of a [File]/[Files] value. Multiple files can be shown as
// thumbnail cards (default) or a compact list, toggled by the viewer. `toggle`
// (default on) hides the switch in tight spots like table cells.
export function FileView({ value, toggle = true }: { value: unknown; toggle?: boolean }): React.ReactNode {
  const refs = parseRefs(value)
  const [layout, setLayout] = useState<'cards' | 'list'>('cards')
  if (!refs.length) return <span className="file-empty">—</span>
  const showToggle = toggle && refs.length > 1
  return (
    <span className={`file-view file-view-${layout}`}>
      {showToggle && (
        <span className="file-toggle" role="group" aria-label="File layout">
          <button type="button" className={layout === 'cards' ? 'active' : ''} title="Cards" onClick={() => setLayout('cards')}>▦</button>
          <button type="button" className={layout === 'list' ? 'active' : ''} title="List" onClick={() => setLayout('list')}>☰</button>
        </span>
      )}
      {layout === 'cards'
        ? <span className="file-chips">{refs.map((r, i) => <FileChip key={r.id || i} r={r} />)}</span>
        : <span className="file-list">{refs.map((r, i) => <FileRow key={r.id || i} r={r} />)}</span>}
    </span>
  )
}
