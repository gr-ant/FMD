// [Audit] activity-log widget. Three surfaces, one feed:
//  * standalone in a [Display] -> the whole app's history (AuditView)
//  * a history icon on a [Table] header -> that source's trail (AuditButton)
//  * a button on a [Cases] record page -> that record's trail (AuditButton)
// All read GET /api/_audit; the server scopes + permission-checks.
import React, { useEffect, useState } from 'react'
import type { AuditNode, Field } from '../../fmd/types'
import { useApiBase, useRecord } from '../../data'
import { apiFetch } from '../../state/auth'
import { useFields } from './vizShared'

interface AuditEvent {
  id: number
  ts: string
  source: string | null
  record_id: string | null
  verb: string
  actor: string | null
  summary: string | null
  detail: { changes?: { field: string; from?: unknown; to?: unknown }[]; via?: string; fields?: string[] } | null
}

const VERB_ICON: Record<string, string> = {
  create: '➕', update: '✏️', delete: '🗑️', trigger: '⚡', file: '📎', action: '👆', button: '👆',
}

const humanize = (s: string): string => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())

// Short relative time ("just now", "5m ago", "3h ago", else a date).
function timeAgo(ts: string): string {
  const then = new Date(ts).getTime()
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 45) return 'just now'
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  if (secs < 604800) return `${Math.round(secs / 86400)}d ago`
  return new Date(ts).toLocaleDateString()
}

// One event as a plain-English sentence, using field labels where known.
function eventText(e: AuditEvent, fields: Field[] | null): string {
  const actor = e.actor || 'Someone'
  const label = (f: string): string => fields?.find((x) => x.name.toLowerCase() === f.toLowerCase())?.label || humanize(f)
  const via = e.detail?.via ? ` by pressing “${e.detail.via}”` : ''
  switch (e.verb) {
    case 'create': return `${actor} added a record${via}.`
    case 'delete': return `${actor} deleted a record${via}.`
    case 'update': {
      const ch = e.detail?.changes || []
      if (!ch.length) return `${actor} edited a record${via}.`
      const parts = ch.map((c) => c.from !== undefined
        ? `${label(c.field)} from “${c.from ?? ''}” to “${c.to ?? ''}”`
        : `${label(c.field)} to “${c.to ?? ''}”`)
      return `${actor} changed ${parts.join(', ')}${via}.`
    }
    case 'trigger': return e.summary || 'An automation ran.'
    case 'file': return e.summary || `${actor} uploaded a file.`
    case 'action': case 'button': return e.summary || `${actor} pressed a button.`
    default: return e.summary || `${actor} ${e.verb}.`
  }
}

// The scrollable list of events. `source`/`record` scope it (omit both = global).
export function AuditFeed({ source, record }: { source?: string | null; record?: string | null }) {
  const base = useApiBase()
  const fields = useFields(source ?? null)
  const [events, setEvents] = useState<AuditEvent[] | null>(null)
  const [err, setErr] = useState(false)

  useEffect(() => {
    let live = true
    const qs = new URLSearchParams()
    if (source) qs.set('source', source)
    if (record != null) qs.set('record', String(record))
    qs.set('limit', '200')
    apiFetch(`${base}/_audit?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => { if (live) setEvents(Array.isArray(data) ? data : []) })
      .catch(() => { if (live) setErr(true) })
    return () => { live = false }
  }, [base, source, record])

  if (err) return <div className="audit-empty">Couldn’t load the activity log.</div>
  if (!events) return <div className="audit-empty">Loading…</div>
  if (!events.length) return <div className="audit-empty">No activity recorded yet.</div>

  return (
    <ul className="audit-feed">
      {events.map((e) => (
        <li key={e.id} className={`audit-item audit-${e.verb}`}>
          <span className="audit-icon">{VERB_ICON[e.verb] || '•'}</span>
          <div className="audit-body">
            <div className="audit-text">{eventText(e, fields)}</div>
            <div className="audit-meta">
              {!source && e.source && <span className="audit-src">{e.source}</span>}
              <span className="audit-time">{timeAgo(e.ts)}</span>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

// A modal wrapper for the icon-triggered trails (table header / case page).
function AuditModal({ source, record, title, onClose }: { source?: string | null; record?: string | null; title: string; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal audit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">🕘 {title}</div>
        <div className="audit-modal-body"><AuditFeed source={source} record={record} /></div>
        <div className="modal-actions"><button className="toggle" onClick={onClose}>Close</button></div>
      </div>
    </div>
  )
}

// The history icon/button; click to open the trail scoped to source (+record).
export function AuditButton({ source, record, title, compact }: { source?: string | null; record?: string | null; title: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className={`audit-btn${compact ? ' audit-btn-icon' : ''}`} title="View history" onClick={() => setOpen(true)}>
        🕘{compact ? '' : ' History'}
      </button>
      {open && <AuditModal source={source} record={record} title={title} onClose={() => setOpen(false)} />}
    </>
  )
}

// Standalone [Audit] in a page. Scopes to the current record when inside a case
// (a RecordContext), to its `source` when given, else the whole-app feed.
export function AuditView({ node }: { node: AuditNode }) {
  const rec = useRecord()
  const record = rec?._id != null ? String(rec._id) : null
  return (
    <div className="audit-panel">
      <div className="audit-panel-head">{node.label || 'Activity log'}</div>
      <AuditFeed source={node.source} record={record} />
    </div>
  )
}
