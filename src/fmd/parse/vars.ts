// Config variables: `[_Name] = value` defines a reusable constant; every later
// `_Name` token is replaced with its value before parsing. Lets you define a
// color, label, condition, source, etc. once and reuse it everywhere.
//
// Runs as a pre-pass over the raw document. Definition lines are blanked (not
// removed) so line numbers stay aligned with the editor; substitution happens
// within lines, so the line count never changes. Values may reference earlier
// variables. A token is `_Name` not flanked by word characters, so `_Brand`
// matches in `[Primary] _Brand` but not inside `My_Brand` or `_BrandColor`.
import { stripComment } from './nodes'

const DEF_RE = /^\s*\[(_[A-Za-z0-9_]+)\]\s*=\s*(.*)$/

export function expandVariables(src: string): string {
  const lines = (src || '').split(/\r?\n/)
  const defs: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DEF_RE)
    if (m) { defs[m[1]] = stripComment(m[2]).trim(); lines[i] = '' }
  }
  const names = Object.keys(defs).sort((a, b) => b.length - a.length) // longest first
  if (!names.length) return src

  const sub = (text: string): string => {
    let out = text
    for (const n of names) out = out.replace(new RegExp('(?<![\\w])' + n + '(?![\\w])', 'g'), () => defs[n])
    return out
  }
  // Resolve variables that reference other variables (bounded passes).
  for (let pass = 0; pass < 5; pass++) for (const n of names) defs[n] = sub(defs[n])

  return lines.map((l) => (l ? sub(l) : l)).join('\n')
}
