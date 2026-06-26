// A tiny JS-like rules engine for FMD conditions, e.g. `Status == True`,
// `Count > 10`, `Status == "Confirmed" && Count >= 5`.
//
// Grammar (lowest to highest precedence): || , && , comparison.
// Comparisons: == != < <= > >=  . Operands are field names (looked up on the
// record, case-insensitive) or literals (numbers, "strings", true/false).
// A bare operand (no operator) is evaluated for truthiness.

export function evalCondition(expr, record) {
  if (!expr || !String(expr).trim()) return true
  try {
    return orEval(String(expr), record || {})
  } catch {
    return true // a malformed rule shouldn't hide everything
  }
}

// Resolve a condition that may be a named [Rule] to its expression.
export function ruleExpr(cond, rules) {
  const c = String(cond ?? '').trim()
  return rules && rules[c] != null ? rules[c] : cond
}

// Evaluate a condition (named rule or inline expression) against a record.
export function passes(cond, record, rules) {
  return evalCondition(ruleExpr(cond, rules), record)
}

const splitTop = (expr, op) => expr.split(op) // simple split; conditions are flat

function orEval(expr, rec) {
  return splitTop(expr, '||').some((part) => andEval(part, rec))
}
function andEval(expr, rec) {
  return splitTop(expr, '&&').every((part) => compEval(part, rec))
}

function compEval(part, rec) {
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
function operand(tok, rec) {
  if (/^".*"$/.test(tok) || /^'.*'$/.test(tok)) return tok.slice(1, -1)
  if (/^-?\d+(\.\d+)?$/.test(tok)) return Number(tok)
  if (/^(true|false)$/i.test(tok)) return /^true$/i.test(tok)
  const dt = dateToken(tok)
  if (dt !== null) return dt
  const key = Object.keys(rec).find((k) => k.toLowerCase() === tok.toLowerCase())
  return key ? rec[key] : tok
}

const num = (v) => Number(String(v ?? '').replace(/[^0-9.-]/g, ''))

// ---- date helpers (today / now + day arithmetic, day-level comparison) ----
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function dateToken(tok) {
  const m = String(tok).trim().match(/^(today|now)(?:\s*([+-])\s*(\d+))?$/i)
  if (!m) return null
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  if (m[2]) d.setDate(d.getDate() + Number(m[3]) * (m[2] === '-' ? -1 : 1))
  return ymd(d)
}
const isDateish = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())
const dayNum = (v) => new Date(String(v).trim().slice(0, 10)).getTime()

// Truthiness that understands common "yes" strings (Confirmed, Done, Paid…).
function truthy(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  return /^(true|yes|y|confirmed|done|complete|completed|paid|active|ok|1)$/i.test(String(v ?? '').trim())
}

function looseEq(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    const bool = typeof a === 'boolean' ? a : b
    const other = typeof a === 'boolean' ? b : a
    return truthy(other) === bool
  }
  if (isDateish(a) && isDateish(b)) return dayNum(a) === dayNum(b)
  if (typeof a === 'number' || typeof b === 'number') return num(a) === num(b)
  return String(a).toLowerCase() === String(b).toLowerCase()
}
