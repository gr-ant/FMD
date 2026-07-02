import React, { useState, useEffect } from 'react'
import { pickField } from '../../data'
import type { FmdRecord } from '../../fmd/types'

// Shared widget primitives used by the [Viz] renderers in viz.tsx.

// Placeholder shown while a bound source hasn't loaded yet.
export function Empty({ source }: { source: string | null }): React.ReactNode {
  return <div className="widget-empty">waiting for “{source}” …</div>
}

// Classify a card/widget by a keyword in its name -> a `data-kind` used for styling.
export function classify(name: string): string {
  const n = name.toLowerCase()
  if (/(timeline|schedule|agenda|calendar)/.test(n)) return 'timeline'
  if (/(count|inventory|stat|metric)/.test(n)) return 'stats'
  if (/(checklist|todo|task|vendor)/.test(n)) return 'checklist'
  if (/(summary|budget|total|finance|cost)/.test(n)) return 'summary'
  return 'generic'
}

function isDone(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  return /confirm|done|complete|paid|yes|true|ok/i.test(String(v ?? ''))
}

// Interactive checklist bound to a source's label + status fields. Callers
// (VizChecklist) guard for missing rows before rendering.
type ChecklistProps = { rows: FmdRecord[] | null; labelKey?: string | null; statusKey?: string | null }
export function Checklist({ rows, labelKey: labelKeyProp, statusKey: statusKeyProp }: ChecklistProps): React.ReactNode {
  const labelKey = labelKeyProp || (rows && pickField(rows, [/name|title|label|task|activity/i], () => true))
  const doneKey = statusKeyProp || (rows && pickField(rows, [/status|done|complete|state/i], () => false))
  const seed = (rows || []).map((r) => ({ label: r[labelKey], done: isDone(r[doneKey]) }))
  const [items, setItems] = useState(seed)
  useEffect(() => setItems(seed), [rows])
  if (!rows) return null
  const toggle = (i: number): void =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)))
  return (
    <ul className="checklist">
      {items.map((it, i) => (
        <li key={i} className={it.done ? 'done' : ''} onClick={() => toggle(i)}>
          <span className="box">{it.done ? '☑' : '☐'}</span>
          {it.label as React.ReactNode}
        </li>
      ))}
    </ul>
  )
}
