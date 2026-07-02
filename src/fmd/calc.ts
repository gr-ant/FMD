// Richer [Calc] expression engine. A superset of the arithmetic in expr.js:
// string concatenation, date math, comparisons, &&/||, and an if(c, a, b)
// conditional — so a [Calc] can build a label, age a date, or branch.
//
//   [Calc] Vehicle = Year + " " + Make + " " + Model     -> "2021 Honda Civic"
//   [Calc] DaysOld = today - Date                         -> 37  (days)
//   [Calc] Flag    = if(Total > 1000, "VIP", "Standard")
//
// Field references are single tokens (case-insensitive), as in expr.js. Values
// are JS strings/numbers/booleans; `today`/`now` resolve to a YYYY-MM-DD date.

import type { FmdRecord } from './types'
import { ymd, isDateish, dayNum, truthy } from './coerce'

const NUM_RE = /^-?\d+(\.\d+)?$/
const isNumberish = (v: unknown): boolean => typeof v === 'number' || (typeof v === 'string' && NUM_RE.test(v.trim()))
const isStringy = (v: unknown): boolean => typeof v === 'string' && !NUM_RE.test(v.trim())
const toStr = (v: unknown): string => (v == null ? '' : String(v))
function toNum(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function addDays(dateStr: unknown, n: number): string {
  const d = new Date(String(dateStr).trim().slice(0, 10))
  d.setDate(d.getDate() + n)
  return ymd(d)
}

// ---- binary operators ------------------------------------------------------
function add(a: unknown, b: unknown): string | number {
  if (isDateish(a) && isNumberish(b)) return addDays(a, toNum(b))
  if (isDateish(b) && isNumberish(a)) return addDays(b, toNum(a))
  if (isStringy(a) || isStringy(b)) return toStr(a) + toStr(b)
  return toNum(a) + toNum(b)
}
function sub(a: unknown, b: unknown): string | number {
  if (isDateish(a) && isDateish(b)) return dayNum(a) - dayNum(b) // whole days
  if (isDateish(a) && isNumberish(b)) return addDays(a, -toNum(b))
  return toNum(a) - toNum(b)
}
function looseEq(a: unknown, b: unknown): boolean {
  if (isDateish(a) && isDateish(b)) return dayNum(a) === dayNum(b)
  if (typeof a === 'number' || typeof b === 'number' || (isNumberish(a) && isNumberish(b)))
    return toNum(a) === toNum(b)
  return String(a).toLowerCase() === String(b).toLowerCase()
}
function order(op: string, a: unknown, b: unknown): boolean {
  const dc = isDateish(a) || isDateish(b)
  const A = dc ? dayNum(a) : toNum(a)
  const B = dc ? dayNum(b) : toNum(b)
  return op === '<' ? A < B : op === '>' ? A > B : op === '<=' ? A <= B : A >= B
}

// ---- tokenizer -------------------------------------------------------------
type Token =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'ident'; v: string }
  | { t: 'op'; v: string }

type Ast =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ref'; name: string }
  | { k: 'neg'; e: Ast }
  | { k: 'if'; cond: Ast; a: Ast; b: Ast }
  | { k: 'call'; name: string; args: Ast[] }
  | { k: 'bin'; op: string; left: Ast; right: Ast }

const TOKEN_RE =
  /\s*(?:("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|&&|\|\||[-+*/()<>?:,]))/g
function tokenize(expr: string): Token[] {
  const out: Token[] = []
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(expr))) {
    if (m[1] != null) out.push({ t: 'str', v: m[1].slice(1, -1) })
    else if (m[2] != null) out.push({ t: 'num', v: Number(m[2]) })
    else if (m[3] != null) out.push({ t: 'ident', v: m[3] })
    else out.push({ t: 'op', v: m[4] })
  }
  return out
}

// ---- recursive-descent parser -> AST --------------------------------------
function parse(tokens: Token[]): Ast {
  let i = 0
  const peek = (): Token | undefined => tokens[i]
  const eat = (v?: string): Token => {
    const tk = tokens[i]
    if (!tk || (v != null && !(tk.t === 'op' && tk.v === v))) throw new Error(`expected ${v}`)
    i++
    return tk
  }
  const isOp = (v: string): boolean => peek() && peek().t === 'op' && peek().v === v

  const ternary = (): Ast => {
    const cond = or()
    if (isOp('?')) { eat('?'); const a = expr(); eat(':'); const b = ternary(); return { k: 'if', cond, a, b } }
    return cond
  }
  const expr = (): Ast => ternary()
  const binL = (next: () => Ast, ...ops: string[]) => (): Ast => {
    let left = next()
    while (peek() && peek().t === 'op' && ops.includes(peek().v as string)) { const op = eat().v as string; left = { k: 'bin', op, left, right: next() } }
    return left
  }
  const or = binL(() => and(), '||')
  const and = binL(() => equality(), '&&')
  const equality = binL(() => comparison(), '==', '!=')
  const comparison = binL(() => additive(), '<', '<=', '>', '>=')
  const additive = binL(() => multiplicative(), '+', '-')
  const multiplicative = binL(() => unary(), '*', '/')
  function unary(): Ast {
    if (isOp('-')) { eat('-'); return { k: 'neg', e: unary() } }
    return primary()
  }
  function primary(): Ast {
    const tk = peek()
    if (!tk) throw new Error('unexpected end')
    if (tk.t === 'num') { i++; return { k: 'num', v: tk.v } }
    if (tk.t === 'str') { i++; return { k: 'str', v: tk.v } }
    if (tk.t === 'op' && tk.v === '(') { eat('('); const e = expr(); eat(')'); return e }
    if (tk.t === 'ident') {
      i++
      if (isOp('(')) { // function call: if(...), etc.
        eat('(')
        const args: Ast[] = []
        if (!isOp(')')) { args.push(expr()); while (isOp(',')) { eat(','); args.push(expr()) } }
        eat(')')
        return { k: 'call', name: tk.v.toLowerCase(), args }
      }
      return { k: 'ref', name: tk.v }
    }
    throw new Error(`unexpected ${tk.v}`)
  }
  const ast = expr()
  if (i !== tokens.length) throw new Error('trailing tokens')
  return ast
}

// ---- evaluator -------------------------------------------------------------
function refValue(name: string, rec: FmdRecord): unknown {
  const lc = name.toLowerCase()
  if (lc === 'today' || lc === 'now') { const d = new Date(); d.setHours(0, 0, 0, 0); return ymd(d) }
  if (lc === 'true') return true
  if (lc === 'false') return false
  const key = Object.keys(rec || {}).find((k) => k.toLowerCase() === lc)
  return key ? rec[key] : ''
}
function evalNode(n: Ast, rec: FmdRecord): unknown {
  switch (n.k) {
    case 'num': return n.v
    case 'str': return n.v
    case 'ref': return refValue(n.name, rec)
    case 'neg': return -toNum(evalNode(n.e, rec))
    case 'if': return truthy(evalNode(n.cond, rec)) ? evalNode(n.a, rec) : evalNode(n.b, rec)
    case 'call': {
      const a = n.args.map((x) => evalNode(x, rec))
      if (n.name === 'if') return truthy(a[0]) ? a[1] : a[2]
      if (n.name === 'round') return Math.round(toNum(a[0]))
      if (n.name === 'upper') return toStr(a[0]).toUpperCase()
      if (n.name === 'lower') return toStr(a[0]).toLowerCase()
      return ''
    }
    case 'bin': {
      const op = n.op
      if (op === '&&') return truthy(evalNode(n.left, rec)) && truthy(evalNode(n.right, rec))
      if (op === '||') return truthy(evalNode(n.left, rec)) || truthy(evalNode(n.right, rec))
      const a = evalNode(n.left, rec), b = evalNode(n.right, rec)
      switch (op) {
        case '+': return add(a, b)
        case '-': return sub(a, b)
        case '*': return toNum(a) * toNum(b)
        case '/': return toNum(b) ? toNum(a) / toNum(b) : 0
        case '==': return looseEq(a, b)
        case '!=': return !looseEq(a, b)
        case '<': case '>': case '<=': case '>=': return order(op, a, b)
        default: return ''
      }
    }
    default: return ''
  }
}

// Evaluate a [Calc] expression against a record. Returns a string/number/
// boolean. Falls back to '' on a parse error (a bad formula shouldn't throw).
export function evalExpr(expr: unknown, record: FmdRecord): unknown {
  const s = String(expr ?? '').trim()
  if (!s) return ''
  try {
    return evalNode(parse(tokenize(s)), record || {})
  } catch {
    return ''
  }
}
