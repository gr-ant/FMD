import React, { useRef } from 'react'
import { commentIndex } from '../parser.js'

// An editor with an underline overlay: a backdrop renders the source with bad
// field references underlined, beneath a transparent textarea (scroll-synced).
export default function CodeEditor({ source, setSource, issues }) {
  const taRef = useRef(null)
  const hlRef = useRef(null)
  const syncScroll = () => {
    if (!hlRef.current || !taRef.current) return
    hlRef.current.scrollTop = taRef.current.scrollTop
    hlRef.current.scrollLeft = taRef.current.scrollLeft
  }
  return (
    <div className="code-editor">
      <div className="code-highlights" ref={hlRef} aria-hidden="true">
        {renderHighlighted(source, issues)}
      </div>
      <textarea
        ref={taRef}
        className="code-input"
        spellCheck={false}
        value={source}
        onChange={(e) => setSource(e.target.value)}
        onScroll={syncScroll}
      />
    </div>
  )
}

// Build the backdrop: text with issue ranges wrapped in underlined spans.
function renderHighlighted(source, issues) {
  const byLine = {}
  for (const is of issues) (byLine[is.line] ||= []).push(is)
  const lines = source.split('\n')
  const out = []
  lines.forEach((line, li) => {
    const ci = commentIndex(line)
    const codeEnd = ci === -1 ? line.length : ci // issues only live in the code part
    const lineIssues = (byLine[li] || []).sort((a, b) => a.start - b.start)
    let cursor = 0
    lineIssues.forEach((is, k) => {
      if (is.start > cursor) out.push(line.slice(cursor, is.start))
      out.push(
        <span key={`${li}-${k}`} className="issue" title={is.message}>
          {line.slice(is.start, is.end)}
        </span>,
      )
      cursor = is.end
    })
    out.push(line.slice(cursor, codeEnd))
    if (ci !== -1) out.push(<span key={`${li}-c`} className="comment">{line.slice(ci)}</span>)
    if (li < lines.length - 1) out.push('\n')
  })
  return out
}
