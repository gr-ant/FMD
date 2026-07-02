import React, { useState } from 'react'
import { apiFetch } from '../../state/auth'
import { useApiBase } from '../../data'

// ===========================================================================
// Document helpers — find / read / rewrite an [API] block's child lines.
// The wizard only writes [URL]/[Auth]/[Want]; the parsing (array path + field
// mappings) and the secret key are set up + stored SERVER-SIDE, never here.
// ===========================================================================

export interface ApiBlockInfo { name: string; line: number; indent: number }
export interface ApiFieldMap { field: string; jsonPath: string }
export interface ApiBlockConfig { url: string; auth: string; want: string; path?: string; fields?: ApiFieldMap[] }

const indentOf = (line: string): number => (line.match(/^[ \t]*/)?.[0].length ?? 0)
const apiName = (line: string): string | null => {
  const m = line.match(/^\s*\[API\]\s*(.*)$/i)
  return m ? (m[1].trim() || 'API') : null
}
const norm = (s: string): string => s.trim().toLowerCase() || 'api'

// Every `[API] <name>` header in the document, with its line + indent.
export function findApiBlocks(text: string): ApiBlockInfo[] {
  const out: ApiBlockInfo[] = []
  text.split('\n').forEach((line, i) => {
    const name = apiName(line)
    if (name != null) out.push({ name, line: i, indent: indentOf(line) })
  })
  return out
}

// Read the existing [URL]/[Auth]/[Want] children of the named block to prefill
// the wizard. (The key + mappings live server-side, so they're not read here.)
export function parseApiBlock(text: string, name: string): ApiBlockConfig {
  const cfg: ApiBlockConfig = { url: '', auth: 'bearer', want: '' }
  const lines = text.split('\n')
  const target = norm(name)
  const header = lines.findIndex((l) => { const n = apiName(l); return n != null && norm(n) === target })
  if (header === -1) return cfg
  const base = indentOf(lines[header])
  for (let j = header + 1; j < lines.length; j++) {
    const line = lines[j]
    if (!line.trim()) continue
    if (indentOf(line) <= base) break
    const m = line.match(/^\s*\[(URL|Auth|Want)\]\s*(.*)$/i)
    if (!m) continue
    const tag = m[1].toLowerCase(), val = m[2].trim()
    if (tag === 'url') cfg.url = val
    else if (tag === 'auth') cfg.auth = val || 'bearer'
    else if (tag === 'want') cfg.want = val
  }
  return cfg
}

// Replace the [URL]/[Auth]/[Want] children of the named [API] block with
// `generated`. Also drops any legacy [Path]/[Map] lines (parsing now lives on the
// server). Other children (comments, blanks, nested) are preserved.
export function spliceApiBlock(text: string, name: string, generated: string): string {
  const lines = text.split('\n')
  const target = norm(name)
  const header = lines.findIndex((l) => { const n = apiName(l); return n != null && norm(n) === target })
  if (header === -1) return text
  const base = indentOf(lines[header])
  const childIndent = ' '.repeat(base + 2)
  let end = header + 1
  const kept: string[] = []
  for (; end < lines.length; end++) {
    const line = lines[end]
    if (line.trim() && indentOf(line) <= base) break // left the block
    if (/^\s*\[(URL|Auth|Path|Map|Want)\]/i.test(line)) continue // drop — replaced / server-managed
    kept.push(line)
  }
  const inserted = generated.split('\n').filter((l) => l.trim()).map((l) => childIndent + l.trim())
  return [...lines.slice(0, header + 1), ...inserted, ...kept, ...lines.slice(end)].join('\n')
}

// ===========================================================================
// The wizard modal — one-tap AI setup.
// ===========================================================================

type AuthMode = 'bearer' | 'header' | 'query'

interface Props {
  source: string                       // lowercased source id (for the proxy endpoints)
  name: string                         // the [API] block name (display + splice target)
  initial?: ApiBlockConfig             // existing [URL]/[Auth]/[Want] to prefill
  onApply: (lines: string) => void     // write the generated tag lines into the doc
  onClose: () => void
}

type AutoResult = { ai: boolean; count: number; fields: ApiFieldMap[]; preview: Record<string, unknown>[] }

function splitAuth(auth: string): { mode: AuthMode; name: string } {
  const a = (auth || 'bearer').trim()
  if (/^header:/i.test(a)) return { mode: 'header', name: a.slice(a.indexOf(':') + 1).trim() }
  if (/^query:/i.test(a)) return { mode: 'query', name: a.slice(a.indexOf(':') + 1).trim() }
  return { mode: 'bearer', name: '' }
}

export default function ApiSetup({ source, name, initial, onApply, onClose }: Props): React.ReactNode {
  const apiBase = useApiBase()
  const seedAuth = splitAuth(initial?.auth || 'bearer')

  const [url, setUrl] = useState(initial?.url || '')
  const [authMode, setAuthMode] = useState<AuthMode>(seedAuth.mode)
  const [authName, setAuthName] = useState(seedAuth.name)
  const [key, setKey] = useState('')
  const [want, setWant] = useState(initial?.want || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<AutoResult | null>(null)

  const authString = authMode === 'bearer' ? 'bearer' : `${authMode}:${authName.trim()}`

  // The minimal declaration written back to the document (no key, no parsing).
  const composeLines = (): string => {
    const out = [`[URL] ${url.trim()}`]
    if (authMode !== 'bearer') out.push(`[Auth] ${authString}`)
    if (want.trim()) out.push(`[Want] ${want.trim()}`)
    return out.join('\n')
  }

  // The whole setup in one tap: persist url/auth/key/want + let the server fetch a
  // sample and derive the parsing (AI, or passthrough if no Gemini key). Then
  // write the minimal declaration into the document.
  const autoConfigure = async (): Promise<void> => {
    if (!url.trim()) { setErr('Enter the API URL first.'); return }
    setErr(null); setBusy(true)
    try {
      const r = await apiFetch(`${apiBase}/_ext/${encodeURIComponent(source)}/_auto`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), auth: authString, key: key.trim() || undefined, want: want.trim() }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`)
      setResult({ ai: !!data.ai, count: data.count ?? 0, fields: data.fields || [], preview: data.preview || [] })
      onApply(composeLines())
    } catch (e) {
      setErr(`Setup failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal api-modal form-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">⚙ Connect API · {name}</div>
        <div className="form-body">
          <p className="api-hint">Give it the URL and key — AI figures out the rest (which fields to read) on the server. No paths or mappings to write.</p>

          <label className="form-field">
            <span className="form-label">API URL</span>
            <input className="form-input" placeholder="https://api.example.com/v1/products"
              value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>

          <div className="api-row-2">
            <label className="form-field">
              <span className="form-label">Auth</span>
              <select className="form-input" value={authMode} onChange={(e) => setAuthMode(e.target.value as AuthMode)}>
                <option value="bearer">Bearer token</option>
                <option value="header">Custom header</option>
                <option value="query">Query parameter</option>
              </select>
            </label>
            {authMode !== 'bearer' && (
              <label className="form-field">
                <span className="form-label">{authMode === 'header' ? 'Header name' : 'Param name'}</span>
                <input className="form-input" placeholder={authMode === 'header' ? 'X-Api-Key' : 'api_key'}
                  value={authName} onChange={(e) => setAuthName(e.target.value)} />
              </label>
            )}
          </div>

          <label className="form-field">
            <span className="form-label">Secret key — stored server-side, never in the document{initial?.url ? ' (leave blank to keep the saved key)' : ''}</span>
            <input className="form-input" type="password" autoComplete="off" placeholder="paste the API key / token"
              value={key} onChange={(e) => setKey(e.target.value)} />
          </label>

          <label className="form-field">
            <span className="form-label">What data do you want? <span className="api-optional">(optional — helps AI pick fields)</span></span>
            <input className="form-input" placeholder="e.g. product name, price, image, rating"
              value={want} onChange={(e) => setWant(e.target.value)} />
          </label>

          {err && <div className="form-error">{err}</div>}

          {result && (
            <div className="api-result">
              <div className="api-result-head">
                ✓ Connected — {result.count} record{result.count === 1 ? '' : 's'}
                {result.ai ? ' · fields picked by AI' : ' · showing all fields (add a Gemini key in ✨ AI for smart mapping)'}
              </div>
              <div className="api-chips">
                {result.fields.map((f) => <span className="api-chip" key={f.field}>{f.field}</span>)}
              </div>
              {result.preview.length > 0 && (
                <div className="viz-table-wrap api-preview">
                  <table className="viz-table">
                    <thead><tr>{result.fields.map((f) => <th key={f.field}>{f.field}</th>)}</tr></thead>
                    <tbody>
                      {result.preview.slice(0, 4).map((row, i) => (
                        <tr key={i}>{result.fields.map((f) => <td key={f.field}>{String((row as Record<string, unknown>)[f.field] ?? '')}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-actions">
          <button className="toggle" onClick={onClose}>{result ? 'Done' : 'Cancel'}</button>
          <button className="toggle primary" onClick={autoConfigure} disabled={busy || !url.trim()}>
            {busy ? 'Configuring…' : result ? '↻ Re-configure' : '✨ Auto-configure'}
          </button>
        </div>
      </div>
    </div>
  )
}
