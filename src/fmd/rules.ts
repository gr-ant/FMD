// A tiny JS-like rules engine for FMD conditions, e.g. `Status == True`,
// `Count > 10`, `Status == "Confirmed" && Count >= 5`.
//
// Grammar (lowest to highest precedence): || , && , comparison.
// Comparisons: == != < <= > >=  . Operands are field names (looked up on the
// record, case-insensitive) or literals (numbers, "strings", true/false).
// A bare operand (no operator) is evaluated for truthiness.

import type { FmdRecord } from './types'
import { dateToken, isDateish, dayNum, truthy } from './coerce'

export function evalCondition(expr: unknown, record: FmdRecord): boolean {
  if (!expr || !String(expr).trim()) return true
  try {
    return orEval(String(expr), record || {})
  } catch {
    return true // a malformed rule shouldn't hide everything
  }
}

// Resolve a condition that may be a named [Rule] to its expression.
export function ruleExpr(cond: unknown, rules: Record<string, unknown>): unknown {
  const c = String(cond ?? '').trim()
  return rules && rules[c] != null ? rules[c] : cond
}

// Evaluate a condition (named rule or inline expression) against a record.
export function passes(cond: unknown, record: FmdRecord, rules: Record<string, unknown>): boolean {
  return evalCondition(ruleExpr(cond, rules), record)
}

const splitTop = (expr: string, op: string): string[] => expr.split(op) // simple split; conditions are flat

function orEval(expr: string, rec: FmdRecord): boolean {
  return splitTop(expr, '||').some((part) => andEval(part, rec))
}
function andEval(expr: string, rec: FmdRecord): boolean {
  return splitTop(expr, '&&').every((part) => compEval(part, rec))
}

function compEval(part: string, rec: FmdRecord): boolean {
  const m = part.match(/^(.+?)(==|!=|<=|>=|<|>)(.+)$/)
  if (!m) return truthy(operand(part.trim(), rec))
  const a = operand(m[1].trim(), rec)
  const b = operand(m[3].trim(), rec)
  // Compare dates by day when either side is a date; otherwise numerically.
  const dateCmp = isDateish(a) || isDateish(b)
  const A = dateCmp ? dayNum(a) : num(a)
  const B = dateCmp ? dayNum(b) : num(b)
  switch (m[2]) {
    case '==': return looseEq(a, b)
    case '!=': return !looseEq(a, b)
    case '<': return A < B
    case '>': return A > B
    case '<=': return A <= B
    case '>=': return A >= B
    default: return false
  }
}

// Resolve a token to a literal value, or a field value on the record. A bare
// word that doesn't match a field is treated as a string literal, so
// `ItemType == Discount` works without quoting "Discount". `today`/`now` (with
// optional ` + N` / ` - N` day math) resolve to dates.
function operand(tok: string, rec: FmdRecord): unknown {
  if (/^".*"$/.test(tok) || /^'.*'$/.test(tok)) return tok.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok)
  if (/^(true|false)$/i.test(tok)) return /^true$/i.test(tok)
  const dt = dateToken(tok)
  if (dt !== null) return dt
  const key = Object.keys(rec).find((k) => k.toLowerCase() === tok.toLowerCase())
  return key ? rec[key] : tok
}

const num = (v: unknown): number => Number(String(v ?? '').replace(/[^0-9.-]/g, ''))

function looseEq(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const bool = typeof a === 'boolean' ? a : b
    const other = typeof a === 'boolean' ? b : a
    return truthy(other) === bool
  }
  if (isDateish(a) && isDateish(b)) return dayNum(a) === dayNum(b)
  if (typeof a === 'number' || typeof b === 'number') return num(a) === num(b)
  return String(a).toLowerCase() === String(b).toLowerCase()
}
