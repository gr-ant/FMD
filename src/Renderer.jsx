import React, { useState } from 'react'
import Widget, { WidgetCard, Viz, FormButton } from './Widget.jsx'
import { isDataBlock } from './parser.js'
import { useSource, keysOf } from './data.js'

// Renders the UI tree. [Data] blocks are skipped -- they define what exists
// behind the scenes, not what is shown.
export default function Renderer({ node }) {
  if (!node) return null
  switch (node.type) {
    case 'Root':
      return <>{node.children.map((c, i) => <Renderer key={i} node={c} />)}</>

    case 'Block':
      if (isDataBlock(node)) return null
      return <BlockNode node={node} />

    case 'Title':
      return <h1 className="fmd-title">{node.value}</h1>

    case 'Menu':
      return <Menu items={node.items} />

    case 'WidgetRow':
      return (
        <div className="widget-row">
          {node.widgets.map((w, i) => <Widget key={i} name={w.name} source={w.source} />)}
        </div>
      )

    case 'Row':
      return (
        <div className="widget-row">
          {node.children.map((c, i) => <Renderer key={i} node={c} />)}
        </div>
      )

    case 'Widget':
      return <WidgetCard node={node} />

    case 'Viz':
      return <Viz node={node} />

    case 'Button':
      return <FormButton node={node} />

    case 'Item':
      return null // consumed by its parent [Viz]

    case 'AppName':
      return null // rendered once at the top of the preview by App

    case 'Rule':
      return null // a named rule definition, not rendered

    case 'Calc':
    case 'Rollup':
      return null // a computed/rollup field definition (inside [Data]), not rendered

    case 'Form':
    case 'FormField':
      return null // forms are modals opened by a [Button], not rendered inline

    case 'List':
    case 'Store':
      return <ListNode node={node} />

    case 'Text':
      return <p className="fmd-text">{node.value}</p>

    default:
      return null
  }
}

function BlockNode({ node }) {
  const tag = node.tag.toLowerCase()
  const cls = `fmd-block fmd-${tag.replace(/\s+/g, '-')}`
  const children = node.children.map((c, i) => <Renderer key={i} node={c} />)

  if (tag === 'display') return <div className={cls}>{children}</div>
  if (tag === 'main') return <main className={cls}>{children}</main>

  // Container if it has children; otherwise a labeled leaf element.
  if (node.children.length) {
    return (
      <section className={cls}>
        <div className="section-label">{node.tag}</div>
        {children}
      </section>
    )
  }
  return (
    <div className="fmd-element">
      <span className="fmd-element-tag">{node.tag}</span>
      {node.value && <span className="fmd-element-value">{node.value}</span>}
    </div>
  )
}

// Controlled when `active`/`onSelect` are passed (page navigation); otherwise
// falls back to local highlight-only state.
export function Menu({ items, active, onSelect }) {
  const [localActive, setLocalActive] = useState(0)
  const controlled = active !== undefined && typeof onSelect === 'function'
  const isActive = (item, i) =>
    controlled ? String(active).toLowerCase() === String(item).toLowerCase() : i === localActive
  const handle = (item, i) => (controlled ? onSelect(item) : setLocalActive(i))
  return (
    <nav className="fmd-menu">
      {items.map((item, i) => (
        <button key={i} className={isActive(item, i) ? 'active' : ''} onClick={() => handle(item, i)}>
          {item}
        </button>
      ))}
    </nav>
  )
}

function ListNode({ node }) {
  const rows = useSource(node.source)
  const columns = node.columns.length ? node.columns.map((c) => c.name) : keysOf(rows)
  return (
    <div className="fmd-list">
      <div className="fmd-list-head">
        <h3>{node.name}</h3>
        {node.source && <span className="bind-badge">{node.source}{rows ? ` · ${rows.length}` : ''}</span>}
        <button className="add-btn">+ Add</button>
      </div>
      <table>
        <thead>
          <tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {(rows || []).map((row, ri) => (
            <tr key={ri}>
              {columns.map((c, ci) => <td key={ci}>{format(row[c])}</td>)}
            </tr>
          ))}
          {!rows && (
            <tr><td colSpan={columns.length || 1} className="muted-cell">waiting for “{node.source}” …</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const format = (v) => (v === undefined || v === null ? '—' : String(v))
