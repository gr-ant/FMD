// Field detection helpers (so widgets work with any entity shape).
import type { FmdRecord } from './types'

const isNum = (v: unknown): boolean =>
  typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v))

export function keysOf(rows: FmdRecord[]): string[] {
  return rows && rows.length ? Object.keys(rows[0]) : []
}

export function pickField(
  rows: FmdRecord[],
  prefer: RegExp[],
  fallbackPredicate: (key: string, rows: FmdRecord[]) => boolean,
): string | null {
  const keys = keysOf(rows)
  for (const re of prefer) {
    const k = keys.find((key) => re.test(key))
    if (k) return k
  }
  return keys.find((k) => fallbackPredicate(k, rows)) || keys[0] || null
}

export { isNum }
