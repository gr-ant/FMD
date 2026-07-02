// Shared value-coercion helpers used by the [Calc], [Rule], and [Action]
// engines: date formatting, `today`/`now` tokens, and date/truthiness detection.
const DAY_MS = 86400000

export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// `today`/`now` with optional ` + N` / ` - N` day arithmetic. Returns null when
// the token isn't a date keyword.
export function dateToken(tok: unknown): string | null {
  const m = String(tok).trim().match(/^(today|now)(?:\s*([+-])\s*(\d+))?$/i)
  if (!m) return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (m[2]) d.setDate(d.getDate() + Number(m[3]) * (m[2] === '-' ? -1 : 1))
  return ymd(d)
}

export const isDateish = (v: unknown): boolean => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())
// A date reduced to whole days since the epoch (day-level compare + equality).
export const dayNum = (v: unknown): number => Math.floor(new Date(String(v).trim().slice(0, 10)).getTime() / DAY_MS)

// Truthiness that understands common "yes" strings (Confirmed, Done, Paid…).
export function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return /^(true|yes|y|confirmed|done|complete|completed|paid|active|ok|1)$/i.test(String(v ?? '').trim())
}
