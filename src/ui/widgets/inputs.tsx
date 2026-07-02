import React, { useState, useEffect } from 'react'
import { useSource, useRules, useApiBase } from '../../data'
import { passes } from '../../fmd/rules'
import { formatValue, toMoney, toDateInput, fieldDef } from '../../fmd/format'
import { Field, FieldOptions, FmdRecord } from '../../fmd/types'
import { apiFetch, dataBase } from '../../state/auth'

// A controlled input that matches the field's declared type (used by forms and
// the table's new-row): dropdown, relationship picker, date picker, $ number, text.
type TypedInputProps = {
  def?: Field
  value: unknown
  onChange: (v: unknown) => void
  placeholder?: string
  onEnter?: () => void
}
export function TypedInput({ def, value, onChange, placeholder, onEnter }: TypedInputProps) {
  const type = def?.type
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter' && onEnter) onEnter() }
  if (type === 'drop') return <PlainSelect value={value} options={def.options?.values || []} onChange={onChange} />
  if (type === 'msel') return <MultiSelect value={value} options={def.options?.values || []} onChange={onChange} />
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
          value={value as string} placeholder={placeholder || '0.00'}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => onChange(toMoney(e.target.value))} onKeyDown={key} />
      </span>
    )
  }
  if (type === 'number') {
    return (
      <span className="num-input">
        <input type="number" className="cell-input"
          value={value as string} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={key} />
      </span>
    )
  }
  if (type === 'memo') {
    // Large/multi-line text: a textarea. Enter inserts a newline (no submit).
    return <textarea className="cell-input memo-input" rows={4} value={value as string} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  }
  return <input className="cell-input" value={value as string} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={key} />
}

// A multi-select (msel) field: pick several values from a fixed list. Value is a
// comma-separated string (also accepts an array); outputs comma-separated.
export function toList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}
type MultiSelectProps = { value: unknown; options: string[]; onChange: (v: unknown) => void }
export function MultiSelect({ value, options, onChange }: MultiSelectProps) {
  const sel = toList(value)
  const has = (o: string) => sel.some((s) => s.toLowerCase() === o.toLowerCase())
  const toggle = (o: string) => {
    const next = has(o) ? sel.filter((s) => s.toLowerCase() !== o.toLowerCase()) : [...sel, o]
    onChange(next.join(','))
  }
  return (
    <div className="msel-input">
      {options.length === 0 && <span className="muted-cell">no options</span>}
      {options.map((o) => (
        <label key={o} className={`msel-chip${has(o) ? ' on' : ''}`}>
          <input type="checkbox" checked={has(o)} onChange={() => toggle(o)} />{o}
        </label>
      ))}
    </div>
  )
}

// A checkbox for boolean fields (forms, new-row, inline edit).
const isOn = (v: unknown): boolean => v === true || v === 'true' || v === 't' || v === 1 || v === '1'
type BoolInputProps = { value: unknown; onChange: (v: unknown) => void }
export function BoolInput({ value, onChange }: BoolInputProps) {
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
type EditableCellProps = { value: unknown; field?: Field; onCommit: (v: unknown) => void }
export function EditableCell({ value, field, onCommit }: EditableCellProps) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState<unknown>(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  const type = field?.type
  if (type === 'boolean') return <BoolInput value={value} onChange={onCommit} />
  if (type === 'msel') return <MultiSelect value={value} options={field?.options?.values || []} onChange={onCommit} />
  if (!editing) {
    return (
      <div className="cell-display" tabIndex={0} onClick={() => setEditing(true)} onFocus={() => setEditing(true)}>
        {formatValue(value, type)}
      </div>
    )
  }
  const commit = (val: unknown) => {
    const out = type === 'currency' ? toMoney(val) : val
    setEditing(false)
    if (out !== (value ?? '')) onCommit(out)
  }
  if (type === 'drop') return <OptionSelect value={value} options={field.options?.values || []} onCommit={commit} />
  if (type === 'link') return <LinkSelect value={value} link={field.options} onCommit={commit} />
  if (type === 'memo') {
    // Multi-line edit: Enter = newline, blur commits, Escape cancels.
    return (
      <textarea
        className="cell-input memo-input" autoFocus rows={4}
        value={v as string}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => commit(v)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setV(value ?? ''); setEditing(false) } }}
      />
    )
  }
  const inputType = type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'
  return (
    <input
      className="cell-input"
      autoFocus
      type={inputType}
      inputMode={type === 'currency' ? 'decimal' : undefined}
      value={type === 'date' ? toDateInput(v) : (v as string)}
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
type OptionSelectProps = { value: unknown; options: string[]; onCommit: (v: unknown) => void }
export function OptionSelect({ value, options, onCommit }: OptionSelectProps) {
  return (
    <select className="cell-input" autoFocus defaultValue={(value ?? '') as string}
      onChange={(e) => onCommit(e.target.value)} onBlur={(e) => onCommit(e.target.value)}>
      <option value="">—</option>
      {options.map((o, i) => <option key={i} value={o}>{o}</option>)}
    </select>
  )
}

// A relationship picker: options come from the linked entity (filtered by the
// optional `? condition` rule), showing the configured display field.
function linkOptions(rows: FmdRecord[], link: FieldOptions, rules: Record<string, unknown>): string[] {
  return [...new Set((rows || [])
    .filter((r) => passes(link?.where, r, rules))
    .map((r) => r[link?.field as string])
    .filter((v) => v != null && v !== ''))] as string[]
}
type LinkSelectProps = { value: unknown; link?: FieldOptions; onCommit: (v: unknown) => void }
export function LinkSelect({ value, link, onCommit }: LinkSelectProps) {
  const rows = useSource(link?.source)
  const rules = useRules()
  return <OptionSelect value={value} options={linkOptions(rows, link, rules)} onCommit={onCommit} />
}

// The faux bottom row for [cTable]: type/pick across the cells, Enter (or +) adds.
type NewRowProps = {
  source: string
  cols: { key: string; name?: string }[]
  fields: Field[]
  extraCol?: boolean
  // A trailing empty cell to align under a [RowButton] actions column, so the
  // create ("+") row keeps the same column count as the data rows.
  extraActionCol?: boolean
  onAdded: () => void
}
export function NewRow({ source, cols, fields, extraCol, extraActionCol, onAdded }: NewRowProps) {
  const [vals, setVals] = useState<FmdRecord>({})
  const base = useApiBase()
  const add = () => {
    const body: FmdRecord = {}
    cols.forEach((c) => { if (vals[c.key]) body[c.key] = vals[c.key] })
    if (!Object.keys(body).length) return
    apiFetch(dataBase(base, source), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(() => { setVals({}); onAdded() })
  }
  return (
    <tr className="new-row">
      {cols.map((c, ci) => (
        <td key={ci} data-label={c.name}>
          <NewCell field={fieldDef(fields, c.key)} first={ci === 0}
            value={vals[c.key] || ''}
            onChange={(val) => setVals((s) => ({ ...s, [c.key]: val }))}
            onEnter={add} />
        </td>
      ))}
      {extraCol && <td className="row-action"><button className="add-btn-sm" title="Add row" onClick={add}>+</button></td>}
      {extraActionCol && <td className="row-actions" />}
    </tr>
  )
}

type NewCellProps = {
  field?: Field
  value: unknown
  first: boolean
  onChange: (v: unknown) => void
  onEnter: () => void
}
export function NewCell({ field, value, first, onChange, onEnter }: NewCellProps) {
  if (field?.calc || field?.rollup || field?.lookup) return <span className="muted-cell">auto</span> // computed, not entered
  return <TypedInput def={field} value={value} placeholder={first ? '+ new…' : ''} onChange={onChange} onEnter={onEnter} />
}

// Controlled <select> for the new-row (value lives in the parent's state).
type PlainSelectProps = { value: unknown; options: string[]; onChange: (v: unknown) => void }
export function PlainSelect({ value, options, onChange }: PlainSelectProps) {
  return (
    <select className="cell-input" value={value as string} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o, i) => <option key={i} value={o}>{o}</option>)}
    </select>
  )
}
type LinkPlainProps = { value: unknown; link?: FieldOptions; onChange: (v: unknown) => void }
export function LinkPlain({ value, link, onChange }: LinkPlainProps) {
  const rows = useSource(link?.source)
  const rules = useRules()
  return <PlainSelect value={value} options={linkOptions(rows, link, rules)} onChange={onChange} />
}
