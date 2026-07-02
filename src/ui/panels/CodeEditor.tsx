import React, { useCallback, useEffect, useRef, useState } from 'react'
import { commentIndex } from '../../parser'
import type { Warning } from '../../parser'

// A bad field-reference range flagged in the source (produced by the linter).
type Issue = {
  line: number
  start: number
  end: number
  message: string
}

type Props = {
  source: string
  setSource: (value: string) => void
  issues: Issue[]
  warnings: Warning[]
  onFix: (append: string) => void
  onAiFix?: () => void
  aiFixing?: boolean
}

// Auto-pair these: typing the opener inserts the closer with the caret between.
const PAIRS: Record<string, string> = { '(': ')', '[': ']', '"': '"' }

// Known FMD tags, suggested as you type the tag word inside `[ ]`.
const TAGS = [
  'App Name', 'Display', 'Title', 'Style', 'Size', 'Font', 'Colors', 'Primary', 'Secondary', 'Background', 'Surface', 'Card', 'Heading', 'ButtonText', 'Muted', 'Border', 'Top Menu Bar', 'Main', 'Data',
  'List', 'Store', 'Table', 'cTable', 'cudTable', 'Counter', 'Checklist', 'Slider', 'Board', 'Calendar', 'Detail', 'Cases', 'View',
  'Count', 'Counts', 'Slide', 'Slides', 'Calc', 'Rollup', 'Lookup', 'Rule',
  'Form', 'Field', 'Fields', 'Button', 'Action', 'Trigger', 'Create', 'Update', 'Delete', 'Sort', 'Group', 'Foot',
  'Permissions', 'Permission', 'Role', 'Roles', 'User Management',
]

type Ac = { items: string[]; index: number; from: number; to: number; left: number; top: number }

// Pixel position of a caret offset inside a textarea, via a hidden mirror div
// that replicates its text metrics. Used to anchor the autocomplete dropdown.
function caretCoords(ta: HTMLTextAreaElement, pos: number): { left: number; top: number } {
  const s = getComputedStyle(ta)
  const div = document.createElement('div')
  const copy = ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize']
  for (const p of copy) (div.style as unknown as Record<string, string>)[p] = (s as unknown as Record<string, string>)[p]
  div.style.position = 'absolute'
  div.style.top = '0'
  div.style.left = '-9999px'
  div.style.height = 'auto'
  div.style.whiteSpace = 'pre-wrap'
  div.style.overflowWrap = 'break-word'
  div.style.visibility = 'hidden'
  div.textContent = ta.value.slice(0, pos)
  const span = document.createElement('span')
  span.textContent = ta.value.slice(pos) || '.'
  div.appendChild(span)
  document.body.appendChild(div)
  const left = span.offsetLeft
  const top = span.offsetTop
  document.body.removeChild(div)
  return { left, top }
}

// An editor with an underline overlay (bad field references) plus Tab/auto-indent
// key handling and a warnings footer for missing/mis-wired structure.
export default function CodeEditor({ source, setSource, issues, warnings, onFix, onAiFix, aiFixing }: Props) {
  const errorCount = warnings.filter((w) => w.level === 'error').length
  const taRef = useRef<HTMLTextAreaElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const colorRef = useRef<HTMLInputElement>(null)
  const colorRangeRef = useRef<{ start: number; end: number } | null>(null) // the #hex token being edited
  const [ac, setAc] = useState<Ac | null>(null)
  const gutterRef = useRef<HTMLDivElement>(null)
  const diagRef = useRef<HTMLDivElement>(null)
  const [lineTops, setLineTops] = useState<number[]>([])
  const [lineH, setLineH] = useState(24)
  const [diags, setDiags] = useState<{ top: number; left: number; msg: string }[]>([])

  // Measure the pixel top of each logical line via a hidden mirror that
  // replicates the textarea's exact metrics + wrapping. Because lines wrap, one
  // logical line can span several visual rows — measuring keeps the gutter number
  // pinned to the line's FIRST row regardless.
  const measureLines = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    const s = getComputedStyle(ta)
    const mirror = document.createElement('div')
    const copy = ['boxSizing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
      'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize']
    for (const p of copy) (mirror.style as unknown as Record<string, string>)[p] = (s as unknown as Record<string, string>)[p]
    mirror.style.position = 'absolute'; mirror.style.top = '0'; mirror.style.left = '-9999px'
    mirror.style.width = ta.clientWidth + 'px'; mirror.style.height = 'auto'; mirror.style.visibility = 'hidden'
    mirror.style.whiteSpace = 'pre-wrap'; mirror.style.overflowWrap = 'break-word'; mirror.style.wordBreak = 'break-word'
    const arr = ta.value.split('\n')
    const markers: HTMLSpanElement[] = []
    arr.forEach((ln, i) => {
      const m = document.createElement('span'); mirror.appendChild(m); markers.push(m)
      mirror.appendChild(document.createTextNode(ln + (i < arr.length - 1 ? '\n' : '')))
    })
    document.body.appendChild(mirror)
    const tops = markers.map((m) => m.offsetTop)
    document.body.removeChild(mirror)
    setLineTops(tops)
    setLineH(parseFloat(s.lineHeight) || 24)
  }, [])

  useEffect(() => {
    let raf = 0
    const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measureLines) }
    run()
    const ta = taRef.current
    const ro = new ResizeObserver(run)
    if (ta) ro.observe(ta)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [source, measureLines])

  // Position each inline diagnostic just past the end of its line's code (like
  // error-lens) so the message never overlaps the source text. Measured after
  // lineTops so wrapping is already settled.
  useEffect(() => {
    const ta = taRef.current
    if (!ta || !issues.length) { setDiags([]); return }
    const byLine = issuesByLine(issues)
    const lines = ta.value.split('\n')
    const starts: number[] = []
    let acc = 0
    for (const l of lines) { starts.push(acc); acc += l.length + 1 }
    const out = Object.entries(byLine).map(([ln, msg]) => {
      const i = +ln
      const line = lines[i] ?? ''
      const ci = commentIndex(line)
      const end = starts[i] + (ci === -1 ? line.length : ci)
      const c = caretCoords(ta, end)
      return { top: c.top, left: c.left, msg }
    })
    setDiags(out)
  }, [issues, source, lineTops])

  // Clicking inside a `#hex` color token opens a native color picker pre-filled
  // with that color; picking REPLACES the token. (#color input wants #rrggbb.)
  const to6 = (hex: string): string => {
    let h = hex.replace('#', '')
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    h = (h + '000000').slice(0, 6)
    return '#' + h
  }
  const maybeOpenColorPicker = (ta: HTMLTextAreaElement): void => {
    if (ta.selectionStart !== ta.selectionEnd) return
    const caret = ta.selectionStart
    const re = /#[0-9a-fA-F]{3,8}\b/g
    let m: RegExpExecArray | null
    while ((m = re.exec(ta.value))) {
      const start = m.index, end = start + m[0].length
      if (caret > start && caret <= end) { // caret sits within the hex digits
        colorRangeRef.current = { start, end }
        const c = caretCoords(ta, start)
        const el = colorRef.current
        if (el) {
          el.value = to6(m[0])
          el.style.left = `${c.left - ta.scrollLeft}px`
          el.style.top = `${c.top - ta.scrollTop}px`
          // Open synchronously so each click keeps the user-activation the picker
          // requires (a setTimeout would drop it -> only the first open works).
          try { el.showPicker() } catch { el.click() }
        }
        return
      }
    }
  }
  const onColorPick = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const ta = taRef.current, r = colorRangeRef.current
    colorRangeRef.current = null
    if (!ta || !r) return
    ta.focus()
    ta.setSelectionRange(r.start, r.end)
    document.execCommand('insertText', false, e.target.value) // replace the token with the new #rrggbb
  }
  const syncScroll = useCallback(() => {
    if (!taRef.current) return
    if (hlRef.current) {
      hlRef.current.scrollTop = taRef.current.scrollTop
      hlRef.current.scrollLeft = taRef.current.scrollLeft
    }
    const ty = `translateY(${-taRef.current.scrollTop}px)`
    if (gutterRef.current) gutterRef.current.style.transform = ty
    if (diagRef.current) diagRef.current.style.transform = ty
  }, [])

  // The gutter/diagnostic layers mount or change AFTER a scroll fires, so their
  // transform can lag the textarea. Re-sync whenever those layers re-render.
  useEffect(() => { syncScroll() }, [diags, lineTops, syncScroll])

  // Recompute tag suggestions: when the caret sits in the tag word of an open
  // `[ ...`, show the tags that start with what's typed so far.
  const refreshAc = (ta: HTMLTextAreaElement) => {
    const value = ta.value, caret = ta.selectionStart
    if (caret !== ta.selectionEnd) { setAc(null); return }
    const ls = value.lastIndexOf('\n', caret - 1) + 1
    const m = value.slice(ls, caret).match(/\[([A-Za-z][A-Za-z ]*)$/)
    if (!m) { setAc(null); return }
    const partial = m[1]
    const items = TAGS.filter((t) => t.toLowerCase().startsWith(partial.toLowerCase()) && t.toLowerCase() !== partial.toLowerCase()).slice(0, 8)
    if (!items.length) { setAc(null); return }
    const c = caretCoords(ta, caret)
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24
    setAc({ items, index: 0, from: caret - partial.length, to: caret, left: c.left - ta.scrollLeft, top: c.top - ta.scrollTop + lh })
  }

  // Replace the partial tag word with the chosen tag.
  const accept = (item: string) => {
    const ta = taRef.current
    if (!ta || !ac) return
    ta.focus()
    ta.setSelectionRange(ac.from, ac.to)
    document.execCommand('insertText', false, item)
    setAc(null)
  }

  // Tab inserts/removes indentation; Enter copies the current line's indent (and
  // adds a level after a container header). execCommand keeps native undo.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    const { selectionStart: s, selectionEnd: en, value } = ta

    // ---- autocomplete navigation (takes priority while the menu is open) ----
    if (ac) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAc({ ...ac, index: (ac.index + 1) % ac.items.length }); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAc({ ...ac, index: (ac.index - 1 + ac.items.length) % ac.items.length }); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); accept(ac.items[ac.index]); return }
      if (e.key === 'Escape') { e.preventDefault(); setAc(null); return }
    }

    // ---- bracket / quote auto-pairing ----
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const close = PAIRS[e.key]
      if (close) {
        // Typing a quote right before the same quote just steps over it.
        if (e.key === '"' && s === en && value[s] === '"') {
          e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return
        }
        e.preventDefault()
        if (s !== en) {
          const inner = value.slice(s, en)
          document.execCommand('insertText', false, e.key + inner + close)
          ta.setSelectionRange(s + 1, s + 1 + inner.length) // keep the wrapped text selected
        } else {
          document.execCommand('insertText', false, e.key + close)
          ta.setSelectionRange(s + 1, s + 1) // caret between the pair
        }
        return
      }
      // Type-over: typing the closer when it's already next just moves past it.
      if ((e.key === ')' || e.key === ']') && s === en && value[s] === e.key) {
        e.preventDefault(); ta.setSelectionRange(s + 1, s + 1); return
      }
      if (e.key === 'Backspace' && s === en) {
        // Inside an empty pair: remove both halves.
        if (s > 0 && PAIRS[value[s - 1]] === value[s]) {
          e.preventDefault(); ta.setSelectionRange(s - 1, s + 1); document.execCommand('delete'); return
        }
        // In leading whitespace: delete a whole indent level (to the previous tab stop).
        const ls = value.lastIndexOf('\n', s - 1) + 1
        const lead = value.slice(ls, s)
        if (lead.length && /^ +$/.test(lead)) {
          const remove = (lead.length % 2) || 2
          e.preventDefault(); ta.setSelectionRange(s - remove, s); document.execCommand('delete'); return
        }
      }
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      if (e.shiftKey) {
        const ls = value.lastIndexOf('\n', s - 1) + 1
        const lead = (value.slice(ls).match(/^ {1,2}/) || [''])[0]
        if (lead) { ta.setSelectionRange(ls, ls + lead.length); document.execCommand('delete') }
      } else {
        document.execCommand('insertText', false, '  ')
      }
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const ls = value.lastIndexOf('\n', s - 1) + 1
      const indent = (value.slice(ls, s).match(/^[ \t]*/) || [''])[0]
      const lineEnd = value.indexOf('\n', s)
      const fullLine = value.slice(ls, lineEnd === -1 ? value.length : lineEnd).trim()
      // A bare [Tag], [Main]/[Display]/[Data], or an opening (( starts a block.
      const opensBlock = /^\[(main|display|data)\b/i.test(fullLine) || /^\(\(/.test(fullLine) || /^\[[^\]]+\]$/.test(fullLine)
      document.execCommand('insertText', false, '\n' + indent + (opensBlock ? '  ' : ''))
    }
  }

  // Move the caret to the start of `line` and scroll it into view.
  const jumpTo = (line?: number) => {
    const ta = taRef.current
    if (!ta || line == null) return
    const lines = source.split('\n')
    const pos = lines.slice(0, line).reduce((a, l) => a + l.length + 1, 0)
    ta.focus()
    ta.setSelectionRange(pos, pos)
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 24
    ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2)
    syncScroll()
  }

  return (
    <div className="code-editor-wrap">
      <div className="code-editor">
        <div className="code-gutter" aria-hidden="true">
          <div className="code-gutter-inner" ref={gutterRef} style={{ lineHeight: `${lineH}px` }}>
            {lineTops.map((t, i) => (
              <div key={i} className="code-ln" style={{ top: t, height: lineH }}>{i + 1}</div>
            ))}
          </div>
        </div>
        <div className="code-highlights" ref={hlRef} aria-hidden="true">
          {renderHighlighted(source, issues)}
        </div>
        {diags.length > 0 && (
          <div className="code-diag-layer" aria-hidden="true">
            <div className="code-diag-inner" ref={diagRef}>
              {diags.map((d, i) => (
                <div key={i} className="code-diag" style={{ top: d.top, left: d.left + 12, height: lineH }}>
                  <span>⛔ {d.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <textarea
          ref={taRef}
          className="code-input"
          spellCheck={false}
          value={source}
          onChange={(e) => { setSource(e.target.value); refreshAc(e.currentTarget) }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refreshAc(e.currentTarget) }}
          onClick={(e) => { refreshAc(e.currentTarget); maybeOpenColorPicker(e.currentTarget) }}
          onBlur={() => setTimeout(() => setAc(null), 120)}
          onScroll={() => { syncScroll(); setAc(null) }}
        />
        <input ref={colorRef} type="color" className="color-poke" aria-hidden="true" tabIndex={-1} defaultValue="#7c5cff" onChange={onColorPick} />
        {ac && (
          <ul className="ac-menu" style={{ left: ac.left, top: ac.top }}>
            {ac.items.map((it, i) => (
              <li
                key={it}
                className={i === ac.index ? 'active' : ''}
                onMouseDown={(e) => { e.preventDefault(); accept(it) }}
              >
                {it}
              </li>
            ))}
          </ul>
        )}
      </div>
      {warnings.length > 0 && (
        <div className="editor-warnings">
          {onAiFix && errorCount > 0 && (
            <div className="warn-bar">
              <span>{errorCount} error{errorCount > 1 ? 's' : ''}</span>
              <button className="warn-aifix" onClick={onAiFix} disabled={aiFixing}>
                {aiFixing ? 'Fixing…' : '⚡ AI fix'}
              </button>
            </div>
          )}
          {warnings.map((w, i) => (
            <div key={i} className={`warn-row warn-${w.level}`} onClick={() => jumpTo(w.line)} title={w.line != null ? 'Jump to line' : undefined}>
              <span className="warn-icon">{w.level === 'error' ? '⛔' : '⚠️'}</span>
              <span className="warn-msg">{w.message}</span>
              {w.line != null && <span className="warn-line">L{w.line + 1}</span>}
              {w.fix && (
                <button className="warn-fix" onClick={(e) => { e.stopPropagation(); onFix(w.fix!.append) }}>
                  {w.fix.label}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Combine issues per line into one message (error-lens style inline diagnostic).
function issuesByLine(issues: Issue[]): Record<number, string> {
  const byLine: Record<number, string[]> = {}
  for (const is of issues) (byLine[is.line] ||= []).push(is.message)
  const out: Record<number, string> = {}
  for (const [ln, msgs] of Object.entries(byLine)) out[+ln] = [...new Set(msgs)].join(' · ')
  return out
}

// ---------------------------------------------------------------------------
// Syntax highlighting. The textarea's text is transparent; this backdrop paints
// the SAME characters with colors. CRITICAL: token spans may only change color/
// background — never font weight/style/size — or the caret drifts off the text.
// ---------------------------------------------------------------------------

// [[Field]] · [Tag …] · {Roles} · "string" · #hex — matched in one pass.
const TOKEN_RE = /(\[\[[^\]\n]*\]\])|(\[[^\]\n]*\])|(\{[^}\n]*\})|("[^"\n]*")|(#[0-9a-fA-F]{3,8}\b)/g

// Inside a [Tag …]: color the tag word, then `-> binding` and `? filter` parts.
function tagSpans(inner: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const arrow = inner.indexOf('->')
  const head = arrow === -1 ? inner : inner.slice(0, arrow)
  out.push(<span key={`${key}t`} className="tk-tag">{head}</span>)
  if (arrow !== -1) {
    const rest = inner.slice(arrow + 2)
    const q = rest.indexOf('?')
    out.push(<span key={`${key}o`} className="tk-op">{'->'}</span>)
    if (q === -1) {
      out.push(<span key={`${key}s`} className="tk-src">{rest}</span>)
    } else {
      out.push(<span key={`${key}s`} className="tk-src">{rest.slice(0, q)}</span>)
      out.push(<span key={`${key}q`} className="tk-op">?</span>)
      out.push(<span key={`${key}f`} className="tk-filter">{rest.slice(q + 1)}</span>)
    }
  }
  return out
}

// Tokenize a plain-text segment (no issues in it) into colored spans.
function tokenize(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let last = 0
  let k = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const kk = `${key}-${k++}`
    if (m[1]) out.push(<span key={kk} className="tk-interp">{tok}</span>)                       // [[Field]]
    else if (m[2]) {
      out.push(<span key={`${kk}a`} className="tk-br">[</span>)
      out.push(...tagSpans(tok.slice(1, -1), kk))
      out.push(<span key={`${kk}b`} className="tk-br">]</span>)
    } else if (m[3]) out.push(<span key={kk} className="tk-role">{tok}</span>)                  // {Roles}
    else if (m[4]) out.push(<span key={kk} className="tk-str">{tok}</span>)                     // "string"
    else out.push(<span key={kk} style={{ color: tok, borderBottom: `2px solid ${tok}` }}>{tok}</span>) // #hex
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// A widget header line `(Name -> src)` / `((Name)` — color the parens + name.
const WIDGET_LINE = /^(\s*)(\(\(?)([^)\n]*)(\)*)(\s*)$/

// Build the backdrop: per line, split out issue ranges (underlined), syntax-
// tokenize the rest, and dim the comment tail.
function renderHighlighted(source: string, issues: Issue[]): React.ReactNode[] {
  const byLine: Record<number, Issue[]> = {}
  for (const is of issues) (byLine[is.line] ||= []).push(is)
  const lines = source.split('\n')
  const out: React.ReactNode[] = []
  lines.forEach((line, li) => {
    const ci = commentIndex(line)
    const codeEnd = ci === -1 ? line.length : ci // issues only live in the code part
    const code = line.slice(0, codeEnd)
    const lineIssues = (byLine[li] || []).sort((a, b) => a.start - b.start)

    const wm = !lineIssues.length && WIDGET_LINE.exec(code)
    if (wm) {
      // (Widget) card headers get their own tint
      out.push(wm[1])
      out.push(<span key={`${li}-wb`} className="tk-br">{wm[2]}</span>)
      out.push(<span key={`${li}-wn`} className="tk-widget">{wm[3]}</span>)
      out.push(<span key={`${li}-we`} className="tk-br">{wm[4]}</span>)
      out.push(wm[5])
    } else {
      let cursor = 0
      lineIssues.forEach((is, k) => {
        if (is.start > cursor) out.push(...tokenize(code.slice(cursor, is.start), `${li}-${k}`))
        out.push(
          <span key={`${li}-i${k}`} className="issue" title={is.message}>
            {line.slice(is.start, is.end)}
          </span>,
        )
        cursor = is.end
      })
      if (cursor < code.length) out.push(...tokenize(code.slice(cursor), `${li}-t`))
    }
    if (ci !== -1) out.push(<span key={`${li}-c`} className="comment">{line.slice(ci)}</span>)
    if (li < lines.length - 1) out.push('\n')
  })
  return out
}
