// CSV Import widget: [Import -> Source] Label
// A button that opens a modal — paste/upload CSV → map columns → preview → bulk-POST.

import React, { useState, useRef, useCallback } from 'react'
import { useRefresh, useApiBase } from '../../data'
import { useFields } from './vizShared'
import { apiFetch, dataBase } from '../../state/auth'
import type { ImportNode } from '../../fmd/types'

// ---------------------------------------------------------------------------
// Dependency-free RFC 4180-compliant CSV parser.
// Handles: quoted fields, commas/newlines inside quotes, doubled-quote escape.
// ---------------------------------------------------------------------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let i = 0
  const n = text.length

  while (i <= n) {
    if (i === n) {
      // end of input — flush last row if non-empty
      if (row.length > 0) rows.push(row)
      break
    }

    if (text[i] === '"') {
      // quoted field
      i++ // skip opening quote
      let field = ''
      while (i < n) {
        if (text[i] === '"') {
          if (i + 1 < n && text[i + 1] === '"') {
            // escaped double-quote
            field += '"'
            i += 2
          } else {
            i++ // skip closing quote
            break
          }
        } else {
          field += text[i]
          i++
        }
      }
      row.push(field)
      // skip delimiter or newline after the closing quote
      if (i < n && text[i] === ',') i++
      else if (i < n && text[i] === '\r') { i++; if (i < n && text[i] === '\n') i++; rows.push(row); row = [] }
      else if (i < n && text[i] === '\n') { i++; rows.push(row); row = [] }
    } else {
      // unquoted field
      let field = ''
      while (i < n && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
        field += text[i]
        i++
      }
      row.push(field)
      if (i < n && text[i] === ',') i++
      else if (i < n && text[i] === '\r') { i++; if (i < n && text[i] === '\n') i++; rows.push(row); row = [] }
      else if (i < n && text[i] === '\n') { i++; rows.push(row); row = [] }
    }
  }

  // remove empty trailing row (common when CSV ends with a newline)
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop()
  return rows
}

// ---------------------------------------------------------------------------
// CsvImportButton — the button that opens the modal.
// ---------------------------------------------------------------------------
export function CsvImportButton({ node }: { node: ImportNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="fmd-button csv-import-btn" onClick={() => setOpen(true)}>
        {node.label}
      </button>
      {open && <CsvImportModal source={node.source} onClose={() => setOpen(false)} />}
    </>
  )
}

// ---------------------------------------------------------------------------
// Step labels.
// ---------------------------------------------------------------------------
type Step = 'paste' | 'map' | 'preview' | 'done'

// ---------------------------------------------------------------------------
// CsvImportModal — the full multi-step modal.
// ---------------------------------------------------------------------------
function CsvImportModal({ source, onClose }: { source: string | null; onClose: () => void }) {
  const fields = useFields(source)
  const refresh = useRefresh()
  const base = useApiBase()
  const fileRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('paste')
  const [csvText, setCsvText] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [dataRows, setDataRows] = useState<string[][]>([])
  // mapping[fieldName] = csvColumn (or '' = skip)
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: number; fail: number } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // ---- step 1: parse CSV -------------------------------------------------
  const parseStep = useCallback(() => {
    setErr(null)
    if (!csvText.trim()) { setErr('Paste some CSV text first.'); return }
    const rows = parseCsv(csvText)
    if (rows.length < 2) { setErr('Need at least a header row + one data row.'); return }
    const [hdrs, ...data] = rows
    setHeaders(hdrs)
    setDataRows(data)
    // auto-map: exact case-insensitive match between field name and CSV header
    const autoMap: Record<string, string> = {}
    const declaredFields = fields || []
    for (const f of declaredFields) {
      const match = hdrs.find((h) => h.trim().toLowerCase() === f.name.toLowerCase())
      autoMap[f.name] = match ?? ''
    }
    // if no declared fields, auto-map headers to themselves
    if (!declaredFields.length) {
      for (const h of hdrs) autoMap[h] = h
    }
    setMapping(autoMap)
    setStep('map')
  }, [csvText, fields])

  // ---- step 2: build preview rows ----------------------------------------
  const mappedRows = dataRows.map((row) => {
    const obj: Record<string, string> = {}
    for (const [field, col] of Object.entries(mapping)) {
      if (!col) continue
      const idx = headers.indexOf(col)
      if (idx === -1) continue
      const val = row[idx] ?? ''
      if (val.trim()) obj[field] = val
    }
    return obj
  })

  const PREVIEW_N = 5

  // ---- step 3: import ----------------------------------------------------
  const runImport = async () => {
    if (!source) { setErr('No source declared.'); return }
    setBusy(true); setErr(null)
    let ok = 0; let fail = 0
    // run with a concurrency of 4
    const CONC = 4
    const rows = mappedRows.filter((r) => Object.keys(r).length > 0)
    for (let i = 0; i < rows.length; i += CONC) {
      const batch = rows.slice(i, i + CONC)
      const results = await Promise.allSettled(
        batch.map((body) =>
          apiFetch(dataBase(base, source), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).then((res) => { if (!res.ok) throw new Error(String(res.status)) })
        )
      )
      for (const r of results) r.status === 'fulfilled' ? ok++ : fail++
    }
    setBusy(false)
    setResult({ ok, fail })
    setStep('done')
    if (ok > 0) refresh()
  }

  // ---- file reader -------------------------------------------------------
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => setCsvText(String(ev.target?.result || ''))
    reader.readAsText(file)
  }

  // ---- active mapped fields (for display) --------------------------------
  const activeFields = (() => {
    const entries = Object.entries(mapping).filter(([, col]) => col)
    if (entries.length) return entries
    // fallback: all headers mapped to themselves
    return headers.map((h) => [h, h] as [string, string])
  })()

  // ---- render ------------------------------------------------------------
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal csv-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">
          Import CSV{source ? ` → ${source}` : ''}
        </div>

        {/* STEP 1: paste */}
        {step === 'paste' && (
          <div className="csv-step">
            <p className="csv-hint">Paste CSV text below, or pick a file. The first row must be headers.</p>
            <textarea
              className="csv-textarea"
              placeholder={'name,email,status\nAlice,alice@example.com,Active\nBob,bob@example.com,Inactive'}
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              rows={8}
            />
            <div className="csv-file-row">
              <button className="toggle" onClick={() => fileRef.current?.click()}>Choose file…</button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onFile} />
              <span className="csv-or">or paste above</span>
            </div>
            {err && <div className="csv-error">{err}</div>}
            <div className="modal-actions">
              <button className="toggle" onClick={onClose}>Cancel</button>
              <button className="toggle primary" onClick={parseStep}>Next: Map columns →</button>
            </div>
          </div>
        )}

        {/* STEP 2: map */}
        {step === 'map' && (
          <div className="csv-step">
            <p className="csv-hint">
              Map each field to a CSV column. Unmapped fields are skipped.
              {dataRows.length} data row{dataRows.length !== 1 ? 's' : ''} detected.
            </p>
            <div className="csv-map-table">
              {Object.keys(mapping).map((field) => (
                <div className="csv-map-row" key={field}>
                  <span className="csv-map-field">{field}</span>
                  <span className="csv-map-arrow">←</span>
                  <select
                    className="csv-map-select"
                    value={mapping[field]}
                    onChange={(e) => setMapping((m) => ({ ...m, [field]: e.target.value }))}
                  >
                    <option value="">(skip)</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {err && <div className="csv-error">{err}</div>}
            <div className="modal-actions">
              <button className="toggle" onClick={() => setStep('paste')}>← Back</button>
              <button
                className="toggle primary"
                onClick={() => {
                  if (activeFields.length === 0) { setErr('Map at least one column.'); return }
                  setErr(null); setStep('preview')
                }}
              >
                Preview →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: preview */}
        {step === 'preview' && (
          <div className="csv-step">
            <p className="csv-hint">
              Preview of first {Math.min(PREVIEW_N, mappedRows.length)} of {mappedRows.length} row{mappedRows.length !== 1 ? 's' : ''}.
            </p>
            <div className="csv-preview-wrap">
              <table className="csv-preview-table">
                <thead>
                  <tr>
                    {activeFields.map(([f]) => <th key={f}>{f}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, PREVIEW_N).map((row, ri) => (
                    <tr key={ri}>
                      {activeFields.map(([f]) => <td key={f}>{row[f] ?? ''}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {err && <div className="csv-error">{err}</div>}
            <div className="modal-actions">
              <button className="toggle" onClick={() => setStep('map')} disabled={busy}>← Back</button>
              <button className="toggle primary" onClick={runImport} disabled={busy}>
                {busy ? 'Importing…' : `Import ${mappedRows.length} row${mappedRows.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: done */}
        {step === 'done' && result && (
          <div className="csv-step">
            <div className="csv-done">
              {result.ok > 0 && <div className="csv-done-ok">✓ {result.ok} row{result.ok !== 1 ? 's' : ''} imported successfully.</div>}
              {result.fail > 0 && <div className="csv-done-fail">✗ {result.fail} row{result.fail !== 1 ? 's' : ''} failed.</div>}
            </div>
            <div className="modal-actions">
              <button className="toggle primary" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
