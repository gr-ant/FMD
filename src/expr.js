// Expression engine for FMD: per-record arithmetic ([Calc]) and aggregates
// (count/sum/avg/min/max over an entity). Field references should be single
// tokens (multi-word names aren't supported inside formulas).

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

// ---- arithmetic: + - * / and ( ), numbers, single-token field references ----
function tokenize(expr) {
  const out = []
  const re = /\s*([0-9.]+|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/])/g
  let m
  while ((m = re.exec(expr))) out.push(m[1])
  return out
}
const PREC = { '+': 1, '-': 1, '*': 2, '/': 2 }

function toRPN(tokens) {
  const out = [], ops = []
  for (const t of tokens) {
    if (/^[0-9.]+$/.test(t) || /^[A-Za-z_]/.test(t)) out.push(t)
    else if (t === '(') ops.push(t)
    else if (t === ')') { while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop()); ops.pop() }
    else { while (ops.length && PREC[ops[ops.length - 1]] >= PREC[t]) out.push(ops.pop()); ops.push(t) }
  }
  while (ops.length) out.push(ops.pop())
  return out
}

export function evalArith(expr, record) {
  try {
    const rpn = toRPN(tokenize(String(expr || '')))
    const st = []
    for (const t of rpn) {
      if (t === '+' || t === '-' || t === '*' || t === '/') {
        const b = st.pop(), a = st.pop()
        st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : (b ? a / b : 0))
      } else if (/^[0-9.]+$/.test(t)) {
        st.push(parseFloat(t))
      } else {
        // field reference (case-insensitive)
        const key = Object.keys(record || {}).find((k) => k.toLowerCase() === t.toLowerCase())
        st.push(num(key ? record[key] : 0))
      }
    }
    return st.length ? st[st.length - 1] : 0
  } catch {
    return 0
  }
}

// ---- aggregates: fn(Entity [Field] ? filter) ----
const AGG_RE = /^(sum|count|avg|min|max)\s*\(([\s\S]*)\)$/i

// Parse an aggregate expression into { fn, ref, filter, via } or null. `ref` is
// the "Entity Field" part (entity may be multi-word); `filter` is after `?`;
// `via` names the child link field (for [Rollup] disambiguation).
export function parseAggregate(expr) {
  const m = String(expr || '').trim().match(AGG_RE)
  if (!m) return null
  const fn = m[1].toLowerCase()
  let body = m[2].trim()
  let via = null
  const vm = body.match(/\s+via\s+([A-Za-z0-9_]+)\s*/i)
  if (vm) { via = vm[1]; body = body.replace(vm[0], ' ').trim() }
  let filter = null
  const qi = body.indexOf('?')
  if (qi !== -1) { filter = body.slice(qi + 1).trim() || null; body = body.slice(0, qi).trim() }
  return { fn, ref: body.trim(), filter, via }
}

// Split "Entity Field" into a known source + field (longest-matching source).
export function splitEntityField(ref, sources) {
  const parts = String(ref || '').split(/\s+/).filter(Boolean)
  for (let n = parts.length; n >= 1; n--) {
    const src = parts.slice(0, n).join(' ').toLowerCase()
    if (sources && sources.has(src)) return { source: src, field: parts.slice(n).join(' ') || null }
  }
  return { source: (parts[0] || '').toLowerCase(), field: parts.slice(1).join(' ') || null }
}

// Compute an aggregate over already-filtered rows.
export function aggregate(fn, rows, field) {
  rows = rows || []
  if (fn === 'count') return rows.length
  const nums = rows.map((r) => num(field ? r[field] : 0))
  if (!nums.length) return 0
  if (fn === 'sum') return nums.reduce((a, b) => a + b, 0)
  if (fn === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length
  if (fn === 'min') return Math.min(...nums)
  if (fn === 'max') return Math.max(...nums)
  return 0
}
