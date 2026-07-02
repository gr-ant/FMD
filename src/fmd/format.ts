// ---- value formatting (driven by the field's declared type) ----
import type { Field, FieldType } from './types'

const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

export function formatValue(value: unknown, type?: FieldType): string {
  if (value === undefined || value === null || value === '') return '—'
  if (type === 'boolean') return (value === true || value === 'true' || value === 't' || value === 1 || value === '1') ? 'Yes' : 'No'
  if (type === 'file' || type === 'files') {
    // value is a {name} descriptor or an array of them — show the file name(s).
    try {
      const p = typeof value === 'string' ? JSON.parse(value) : value
      const names = (Array.isArray(p) ? p : [p]).map((f) => f?.name).filter(Boolean)
      return names.length ? names.join(', ') : '—'
    } catch { return '—' }
  }
  if (type === 'currency') {
    const n = Number(String(value).replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) ? currencyFmt.format(n) : String(value)
  }
  if (type === 'date') {
    const d = new Date(value as string)
    return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d)
  }
  return String(value)
}

// Interpolate `[[FieldName]]` tokens in a string with the current record's values
// (case-insensitive). Used to inline a field as text inside a [Cases] case, e.g.
// a [Text] line "Owner: [[OwnerName]]". With no record (outside a case) the text
// is returned unchanged. A missing/empty field renders empty. An optional
// `format(field, value)` lets callers render each value by its declared type
// (so a boolean reads "Yes", a date/currency formats) — matching the cells.
export function interpolate(
  text: string,
  record: Record<string, unknown> | null,
  format?: (field: string, value: unknown) => string,
): string {
  if (!record || typeof text !== 'string' || !text.includes('[[')) return text
  return text.replace(/\[\[\s*([^\]]+?)\s*\]\]/g, (_, name: string) => {
    const k = Object.keys(record).find((kk) => kk.toLowerCase() === name.trim().toLowerCase())
    if (k == null || record[k] == null || record[k] === '') return ''
    return format ? format(k, record[k]) : String(record[k])
  })
}

// The full declared definition / type of a field (by name), from the model.
export const fieldDef = (fields: Field[], key: unknown): Field | undefined =>
  (fields || []).find((f) => f.name.toLowerCase() === String(key).toLowerCase())
export const fieldType = (fields: Field[], key: unknown): FieldType | undefined => fieldDef(fields, key)?.type

// A date value (ISO or YYYY-MM-DD) reduced to the YYYY-MM-DD an <input type=date> wants.
export const toDateInput = (v: unknown): string => (String(v ?? '').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0]

// Normalize a currency entry to two decimals ("12" -> "12.00", "12.5" -> "12.50").
export const toMoney = (v: unknown): string => {
  if (v == null || String(v).trim() === '') return ''
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n.toFixed(2) : (v as string)
}
