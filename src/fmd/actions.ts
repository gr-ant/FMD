// Action value semantics (pure). An action step's right-hand side is evaluated
// per target row: string/number/boolean literals and `today`/`now` date tokens
// resolve directly; a bare field name copies that field's value; anything else
// falls through to the arithmetic engine so `Count = Count + 1` works.

import { evalArith } from './expr'
import { dateToken } from './coerce'
import type { FmdRecord } from './types'

// Evaluate one assignment RHS against a (possibly empty) row.
export function evalValue(expr: unknown, row: FmdRecord): unknown {
  const t = String(expr ?? '').trim()
  if (/^".*"$/.test(t) || /^'.*'$/.test(t)) return t.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t)
  if (/^(true|false)$/i.test(t)) return /^true$/i.test(t)
  const dt = dateToken(t)
  if (dt !== null) return dt
  // A lone field reference copies the value verbatim (keeps non-numeric strings
  // intact, unlike the arithmetic path which would coerce them to 0).
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && row) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === t.toLowerCase())
    if (key) return row[key]
  }
  return evalArith(t, row || {})
}

// Build a field->value body for a Create/Update step from its assignments.
export function buildBody(
  assigns: { field: string; expr: string }[],
  row: FmdRecord,
): FmdRecord {
  const body: FmdRecord = {}
  for (const a of assigns) body[a.field] = evalValue(a.expr, row || {})
  return body
}
