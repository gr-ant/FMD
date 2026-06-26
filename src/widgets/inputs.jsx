import React, { useState, useEffect } from 'react'
import { useSource, useRules } from '../data.js'
import { passes } from '../rules.js'
import { formatValue, toMoney, toDateInput, fieldDef } from './format.js'

// A controlled input that matches the field's declared type (used by forms and
// the table's new-row): dropdown, relationship picker, date picker, $ number, text.
export function TypedInput({ def, value, onChange, placeholder, onEnter }) {
  const type = def?.type
  const key = (e) => { if (e.key === 'Enter' && onEnter) onEnter() }
  if (type === 'drop') return <PlainSelect value={value} options={def.options?.values || []} onChange={onChange} />
  if (type === 'link') return <LinkPlain value={value} link={def.options} onChange={onChange} />
  if (type === 'boolean') return <BoolInput value={value} onChange={onChange} />
  if (type === 'date') {
    return <input type="date" className="cell-input" value={toDateInput(value)} onChange={(e) => onChange(e.target.value)} onKeyDown={key} />
  }
  if (type === 'currency') {
    return (
      <span className="num-input">
        <span className="num-prefix">$</span>
        <input type="text" inputMode="decimal" className="cell-input"
          value={value} placeholder={placeholder || '0.00'}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onChange(toMoney(e.target.value))} onKeyDown={key} />
      </span>
    )
  }
  if (type === 'number') {
    return (
      <span className="num-input">
        <input type="number" className="cell-input"
          value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={key} />
      </span>
    )
  }
  return <input className="cell-input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={key} />
}

// A checkbox for boolean fields (forms, new-row, inline edit).
const isOn = (v) => v === true || v === 'true' || v === 't' || v === 1 || v === '1'
export function BoolInput({ value, onChange }) {
  const on = isOn(value)
  return (
    <label className="bool-input">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{on ? 'Yes' : 'No'}</span>
    </label>
  )
}

// Notion-style inline cell: shows the formatted value; click/focus to edit the
// raw value; commits on blur/Enter, cancels on Escape.
export function EditableCell({ value, field, onCommit }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  const type = field?.type
  if (type === 'boolean') return <BoolInput value={value} onChange={onCommit} />
  if (!editing) {
    return (
      <div className="cell-display" tabIndex={0} onClick={() => setEditing(true)} onFocus={() => setEditing(true)}>
        {formatValue(value, type)}
      </div>
    )
  }
  const commit = (val) => {
    const out = type === 'currency' ? toMoney(val) : val
    setEditing(false)
    if (out !== (value ?? '')) onCommit(out)
  }
  if (type === 'drop') return <OptionSelect value={value} options={field.options?.values || []} onCommit={commit} />
  if (type === 'link') return <LinkSelect value={value} link={field.options} onCommit={commit} />
  const inputType = type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'
  return (
    <input
      className="cell-input"
      autoFocus
      type={inputType}
      inputMode={type === 'currency' ? 'decimal' : undefined}
      value={type === 'date' ? toDateInput(v) : v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => commit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { setV(value ?? ''); setEditing(false) }
      }}
    />
  )
}

// A <select> for a dropdown field. Commits on change/blur.
export function OptionSelect({ value, options, onCommit }) {
  return (
    <select className="cell-input" autoFocus defaultValue={value ?? ''}
      onChange={(e) => onCommit(e.target.value)} onBlur={(e) => onCommit(e.target.value)}>
      <option value="">—</option>
      {options.map((o, i) => <option key={i} value={o}>{o}</option>)}
    </select>
  )
}

// A relationship picker: options come from the linked entity (filtered by the
// optional `? condition` rule), showing the configured display field.
function linkOptions(rows, link, rules) {
  return [...new Set((rows || [])
    .filter((r) => passes(link?.where, r, rules))
    .map((r) => r[link?.field])
    .filter((v) => v != null && v !== ''))]
}
export function LinkSelect({ value, link, onCommit }) {
  const rows = useSource(link?.source)
  const rules = useRules()
  return <OptionSelect value={value} options={linkOptions(rows, link, rules)} onCommit={onCommit} />
}

// The faux bottom row for [cTable]: type/pick across the cells, Enter (or +) adds.
export function NewRow({ source, cols, fields, extraCol, onAdded }) {
  const [vals, setVals] = useState({})
  const add = () => {
    const body = {}
    cols.forEach((c) => { if (vals[c.key]) body[c.key] = vals[c.key] })
    if (!Object.keys(body).length) return
    fetch(`/api/${encodeURIComponent(source)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(() => { setVals({}); onAdded() })
  }
  return (
    <tr className="new-row">
      {cols.map((c, ci) => (
        <td key={ci}>
          <NewCell field={fieldDef(fields, c.key)} first={ci === 0}
            value={vals[c.key] || ''}
            onChange={(val) => setVals((s) => ({ ...s, [c.key]: val }))}
            onEnter={add} />
        </td>
      ))}
      {extraCol && <td className="row-action"><button className="add-btn-sm" title="Add row" onClick={add}>+</button></td>}
    </tr>
  )
}

export function NewCell({ field, value, first, onChange, onEnter }) {
  if (field?.calc || field?.rollup) return <span className="muted-cell">auto</span> // computed, not entered
  return <TypedInput def={field} value={value} placeholder={first ? '+ new…' : ''} onChange={onChange} onEnter={onEnter} />
}

// Controlled <select> for the new-row (value lives in the parent's state).
export function PlainSelect({ value, options, onChange }) {
  return (
    <select className="cell-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o, i) => <option key={i} value={o}>{o}</option>)}
    </select>
  )
}
export function LinkPlain({ value, link, onChange }) {
  const rows = useSource(link?.source)
  const rules = useRules()
  return <PlainSelect value={value} options={linkOptions(rows, link, rules)} onChange={onChange} />
}
