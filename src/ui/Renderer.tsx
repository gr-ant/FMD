import React, { useState } from 'react'
import type {
  Node,
  BlockNode as BlockNodeType,
  ListNode as ListNodeType,
  StoreNode as StoreNodeType,
} from '../fmd/types'
import { WidgetCard, Viz, VizDetail, VizCases, VizView, FormButton } from '../Widget'
import { isDataBlock, visibleForRoles } from '../parser'
import { useSource, keysOf, useVisibilityRoles, useUserMgmt, useRecord } from '../data'
import { interpolate } from '../fmd/format'
import { widgetViz } from '../fmd/parse/nodes'

// Renders the UI tree. [Data] blocks are skipped -- they define what exists
// behind the scenes, not what is shown.
export default function Renderer({ node }: { node: Node | null }) {
  const roles = useVisibilityRoles()
  const record = useRecord() // the current [Cases]/[Detail] case, for [[field]] text
  if (!node) return null
  // Honor a `{Role, !Role}` visibility block (hides the element + its subtree).
  if (node.roles && !visibleForRoles(node.roles, roles)) return null
  switch (node.type) {
    case 'Root':
      return <>{node.children.map((c, i) => <Renderer key={i} node={c} />)}</>

    case 'Block':
      if (isDataBlock(node)) return null
      return <BlockNode node={node} />

    case 'Title':
      return <h1 className="fmd-title">{inlineMd(interpolate(node.value, record))}</h1>

    case 'Menu':
      return <Menu items={node.items} />

    case 'WidgetRow':
      // Legacy `(Name -> source)` widget row: render each widget whose name maps
      // to a [Viz] keyword. (Non-viz bare widgets are no longer auto-rendered.)
      return (
        <div className="widget-row">
          {node.widgets.map((w, i) => {
            const v = w.source ? widgetViz(`${w.name} -> ${w.source}`) : null
            return v ? <Viz key={i} node={v} /> : null
          })}
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

    case 'Detail':
      return <VizDetail node={node} />

    case 'Cases':
      return <VizCases node={node} />

    case 'View':
      return <VizView node={node} />

    case 'Button':
      return <FormButton node={node} />

    case 'UserManagement':
      return <UserMgmtButton label={node.label} />

    case 'Item':
      return null // consumed by its parent [Viz]

    case 'AppName':
      return null // rendered once at the top of the preview by App

    case 'Rule':
    case 'Role':
    case 'Permission':
    case 'Grant':
      return null // role/permission definitions, not rendered

    case 'Calc':
    case 'Rollup':
      return null // a computed/rollup field definition (inside [Data]), not rendered

    case 'Form':
    case 'FormField':
      return null // forms are modals opened by a [Button], not rendered inline

    case 'Action':
    case 'Step':
      return null // an action definition + its steps, run by a [Button], not rendered

    case 'Trigger':
      return null // an automation; runs in the background, never rendered

    case 'Style':
      return null // theming; applied as CSS vars on the app root, not rendered

    case 'List':
    case 'Store':
      return <ListNode node={node} />

    case 'Text':
      return <p className="fmd-text">{inlineMd(interpolate(node.value, record))}</p>

    default:
      return null
  }
}

// A [User Management] button — opens the user-management window via context.
function UserMgmtButton({ label }: { label: string }) {
  const { open } = useUserMgmt()
  return <button className="fmd-button um-btn" onClick={open}>👤 {label}</button>
}

function BlockNode({ node }: { node: BlockNodeType }) {
  const record = useRecord()
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
      {node.value && <span className="fmd-element-value">{interpolate(node.value, record)}</span>}
    </div>
  )
}

// Controlled when `active`/`onSelect` are passed (page navigation); otherwise
// falls back to local highlight-only state.
export function Menu({
  items,
  active,
  onSelect,
}: {
  items: string[]
  active?: string
  onSelect?: (item: string) => void
}) {
  const [localActive, setLocalActive] = useState(0)
  const controlled = active !== undefined && typeof onSelect === 'function'
  const isActive = (item: string, i: number) =>
    controlled ? String(active).toLowerCase() === String(item).toLowerCase() : i === localActive
  const handle = (item: string, i: number) => (controlled ? onSelect(item) : setLocalActive(i))
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

function ListNode({ node }: { node: ListNodeType | StoreNodeType }) {
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

const format = (v: unknown): string => (v === undefined || v === null ? '—' : String(v))

// Minimal inline markdown for [Text]/[Title]: **bold** and *italic*.
function inlineMd(text: string): React.ReactNode {
  if (!text || !/[*]/.test(text)) return text
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (/^\*[^*]+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>
    return p
  })
}
