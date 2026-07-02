// ---- reference linter (for editor underlines) ----------------------------
// Find field references in [Display] view tags that don't match a declared
// field of their bound source. Returns [{ line, start, end, message }] with
// character offsets within each line, so the editor can underline them.

import type { Schema } from '../types'
import { fieldName } from './fields'
import { stripComment, splitBinding, VIZ_RE } from './nodes'
import { expandVariables } from './vars'

interface SpecRef {
  value: string
  start: number
}

interface LintIssue {
  line: number
  start: number
  end: number
  message: string
}

// Split a spec on a delimiter, returning each piece's trimmed value and the
// offset of that value within `str`.
function splitOffsets(str: string, delimRe: RegExp): SpecRef[] {
  const re = new RegExp(delimRe, 'g')
  const out: SpecRef[] = []
  const push = (chunk: string, base: number): void => {
    const lead = chunk.length - chunk.trimStart().length
    const value = chunk.trim()
    if (value) out.push({ value, start: base + lead })
  }
  let last = 0, m
  while ((m = re.exec(str))) { push(str.slice(last, m.index), last); last = m.index + m[0].length }
  push(str.slice(last), last)
  return out
}

// The field references inside a viz spec, per viz type (with offsets).
function specRefs(viz: string, spec: string): SpecRef[] {
  if (viz === 'table') return splitOffsets(spec, /,/)
  if (viz === 'checklist') return splitOffsets(spec, /\//)
  if (viz === 'counter' || viz === 'board' || viz === 'calendar') {
    const value = spec.trim()
    return value ? [{ value, start: spec.indexOf(value) }] : []
  }
  if (viz === 'slider') {
    // "label spent / cap"
    const slash = spec.indexOf('/')
    const left = slash === -1 ? spec : spec.slice(0, slash)
    const right = slash === -1 ? '' : spec.slice(slash + 1)
    const out = splitOffsets(left, /\s+/).slice(0, 2)
    const cap = right.trim()
    if (cap) out.push({ value: cap, start: slash + 1 + right.indexOf(cap) })
    return out
  }
  return []
}

export function lintReferences(src: string, schema: Schema): LintIssue[] {
  const issues: LintIssue[] = []
  // Expand [_Var] constants first (line-count preserving) so a `_Var` reference
  // in a viz spec isn't flagged as an unknown field.
  const lines = expandVariables(src).split(/\r?\n/)
  lines.forEach((rawLine, li) => {
    const line = stripComment(rawLine) // don't lint inside comments
    const open = line.indexOf('[')
    const close = line.indexOf(']')
    if (open === -1 || close === -1 || close < open) return

    const innerBind = splitBinding(line.slice(open + 1, close))
    const vizMatch = innerBind.text.trim().split(/\s+/)[0].toLowerCase().match(VIZ_RE)
    if (!vizMatch) return
    const viz = vizMatch[2]

    let source = innerBind.source ? innerBind.source.toLowerCase() : null
    if (source && source.includes('?')) source = source.slice(0, source.indexOf('?')).trim() // drop "? filter"
    const fields = source && schema[source] ? schema[source].fields : null
    if (!fields) return
    const declared = new Set(fields.map((f) => f.name.toLowerCase()))

    let specStart = close + 1
    while (specStart < line.length && /\s/.test(line[specStart])) specStart++
    const spec = line.slice(specStart)

    for (const ref of specRefs(viz, spec)) {
      const name = fieldName(ref.value)
      if (!name) continue
      // A numeric or quoted literal (e.g. a [Slider] cap "/ 5") isn't a field.
      if (/^-?\d+(\.\d+)?$/.test(ref.value) || /^["']/.test(ref.value)) continue
      if (!declared.has(name.toLowerCase())) {
        issues.push({
          line: li,
          start: specStart + ref.start,
          end: specStart + ref.start + ref.value.length,
          message: `unknown field “${ref.value}” — not declared on ${schema[source].name}`,
        })
      }
    }
  })
  return issues
}
