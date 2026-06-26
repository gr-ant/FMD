import React, { useState, useEffect } from 'react'
import { useSource, keysOf, pickField, isNum } from '../../data.js'

// A (Widget) bound to a data source. It classifies itself by name and
// visualizes the records pulled from its bound entity.
export default function Widget({ name, source }) {
  const rows = useSource(source)
  const kind = classify(name)

  return (
    <div className="widget" data-kind={kind}>
      <div className="widget-head">
        <h3>{name}</h3>
        {source && (
          <span className="bind-badge" title={`bound to ${source}`}>
            {source}
            {rows ? ` · ${rows.length}` : ''}
          </span>
        )}
      </div>
      <div className="widget-body">
        {source && !rows ? <Empty source={source} /> : renderBody(kind, rows)}
      </div>
    </div>
  )
}

export function classify(name) {
  const n = name.toLowerCase()
  if (/(timeline|schedule|agenda|calendar)/.test(n)) return 'timeline'
  if (/(count|inventory|stat|metric)/.test(n)) return 'stats'
  if (/(checklist|todo|task|vendor)/.test(n)) return 'checklist'
  if (/(summary|budget|total|finance|cost)/.test(n)) return 'summary'
  return 'generic'
}

function renderBody(kind, rows) {
  switch (kind) {
    case 'timeline':
      return <Timeline rows={rows} />
    case 'stats':
      return <Stats rows={rows} />
    case 'checklist':
      return <Checklist rows={rows} />
    case 'summary':
      return <Summary rows={rows} />
    default:
      return <Generic rows={rows} />
  }
}

export function Empty({ source }) {
  return <div className="widget-empty">waiting for “{source}” …</div>
}

function Timeline({ rows }) {
  if (!rows) return <Generic />
  const timeKey = pickField(rows, [/time|when|date|hour/i], () => false)
  const labelKey = pickField(rows, [/activity|event|label|name|title|task/i], (k) => k !== timeKey)
  return (
    <ul className="timeline">
      {rows.map((r, i) => (
        <li key={i}>
          <span className="time">{r[timeKey]}</span>
          <span className="dot" />
          <span className="label">{r[labelKey]}</span>
        </li>
      ))}
    </ul>
  )
}

function Stats({ rows }) {
  if (!rows) return <Generic />
  const labelKey = pickField(rows, [/title|name|label|category/i], (k, r) => !isNum(r[0][k]))
  const valueKey = pickField(rows, [/count|qty|quantity|value|total/i], (k, r) => isNum(r[0][k]))
  return (
    <div className="stat-grid">
      {rows.slice(0, 6).map((r, i) => (
        <div className="stat" key={i}>
          <div className="stat-val">{r[valueKey]}</div>
          <div className="stat-label">{r[labelKey]}</div>
        </div>
      ))}
    </div>
  )
}

export function Checklist({ rows, labelKey: labelKeyProp, statusKey: statusKeyProp }) {
  const labelKey = labelKeyProp || (rows && pickField(rows, [/name|title|label|task|activity/i], () => true))
  const doneKey = statusKeyProp || (rows && pickField(rows, [/status|done|complete|state/i], () => false))
  const seed = (rows || []).map((r) => ({
    label: r[labelKey],
    done: isDone(r[doneKey]),
  }))
  const [items, setItems] = useState(seed)
  useEffect(() => setItems(seed), [rows])

  if (!rows) return <Generic />
  const toggle = (i) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)))
  return (
    <ul className="checklist">
      {items.map((it, i) => (
        <li key={i} className={it.done ? 'done' : ''} onClick={() => toggle(i)}>
          <span className="box">{it.done ? '☑' : '☐'}</span>
          {it.label}
        </li>
      ))}
    </ul>
  )
}

function isDone(v) {
  if (typeof v === 'boolean') return v
  return /confirm|done|complete|paid|yes|true|ok/i.test(String(v ?? ''))
}

function Summary({ rows }) {
  if (!rows) return <Generic />
  const labelKey = pickField(rows, [/category|name|label|title/i], (k, r) => !isNum(r[0][k]))
  const nums = keysOf(rows).filter((k) => isNum(rows[0][k]))
  const spentKey = pickField(rows, [/spent|actual|used/i], (k) => nums.includes(k)) || nums[0]
  const capKey = pickField(rows, [/cap|budget|limit|max|total/i], (k) => nums.includes(k) && k !== spentKey) || nums[1] || spentKey

  const total = rows.reduce((s, r) => s + Number(r[spentKey] || 0), 0)
  const budget = rows.reduce((s, r) => s + Number(r[capKey] || 0), 0)
  return (
    <div className="summary">
      {rows.map((r, i) => {
        const spent = Number(r[spentKey] || 0)
        const cap = Number(r[capKey] || 0) || spent || 1
        return (
          <div className="bar-row" key={i}>
            <span className="bar-label">{r[labelKey]}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.min(100, (spent / cap) * 100)}%` }} />
            </span>
            <span className="bar-val">${spent.toLocaleString()}</span>
          </div>
        )
      })}
      <div className="summary-total">
        <span>Total</span>
        <span>
          ${total.toLocaleString()} / ${budget.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

function Generic({ rows }) {
  if (rows && rows.length) {
    const keys = keysOf(rows).slice(0, 3)
    return (
      <ul className="generic-list">
        {rows.slice(0, 5).map((r, i) => (
          <li key={i}>{keys.map((k) => r[k]).join(' · ')}</li>
        ))}
      </ul>
    )
  }
  return (
    <div className="generic">
      <div className="skeleton" style={{ width: '90%' }} />
      <div className="skeleton" style={{ width: '70%' }} />
      <div className="skeleton" style={{ width: '80%' }} />
    </div>
  )
}
