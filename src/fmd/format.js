// ---- value formatting (driven by the field's declared type) ----
const currencyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })

export function formatValue(value, type) {
  if (value === undefined || value === null || value === '') return '—'
  if (type === 'boolean') return (value === true || value === 'true' || value === 't' || value === 1 || value === '1') ? 'Yes' : 'No'
  if (type === 'currency') {
    const n = Number(String(value).replace(/[^0-9.-]/g, ''))
    return Number.isFinite(n) ? currencyFmt.format(n) : String(value)
  }
  if (type === 'date') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? String(value) : dateFmt.format(d)
  }
  return String(value)
}
export const fmt = (v) => formatValue(v)

// The full declared definition / type of a field (by name), from the model.
export const fieldDef = (fields, key) =>
  (fields || []).find((f) => f.name.toLowerCase() === String(key).toLowerCase())
export const fieldType = (fields, key) => fieldDef(fields, key)?.type

// A date value (ISO or YYYY-MM-DD) reduced to the YYYY-MM-DD an <input type=date> wants.
export const toDateInput = (v) => (String(v ?? '').match(/^\d{4}-\d{2}-\d{2}/) || [''])[0]

// Normalize a currency entry to two decimals ("12" -> "12.00", "12.5" -> "12.50").
export const toMoney = (v) => {
  if (v == null || String(v).trim() === '') return ''
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n.toFixed(2) : v
}
