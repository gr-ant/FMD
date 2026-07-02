import React, { useState } from 'react'
import type { Node } from '../../fmd/types'
import Renderer, { Menu } from '../Renderer'

type Props = {
  page: Node | null
  activeName: string
  menuItems: string[]
  onSelect: (item: string) => void
  side?: boolean // the menu is a [SideMenu] -> render a left rail + content column
  collapsible?: boolean // [SideMenu hamburger] -> the rail is hidden behind a ☰ toggle
}

// Renders the active page inside the display shell. The menu is shared nav: it
// persists across pages (injected when a page has none) and switches the page.
export default function PageView({ page, activeName, menuItems, onSelect, side, collapsible }: Props) {
  const [open, setOpen] = useState(false)
  const children = page ? page.children : []
  const empty = (
    <div className="page-empty">
      No <code>[Display] {activeName}</code> page yet — add one to fill this tab.
    </div>
  )

  // A [SideMenu] lays the page out as a left rail + content column; the nav
  // always lives in the rail regardless of where the [SideMenu] tag was written.
  if (side) {
    const body = page
      ? children.filter((c) => c.type !== 'Menu').map((c, i) => <Renderer key={i} node={c} />)
      : empty
    // In collapsible mode, picking a page also closes the popped-out rail.
    const select = collapsible ? (item: string) => { onSelect(item); setOpen(false) } : onSelect
    const nav = menuItems.length > 0
      ? <Menu items={menuItems} active={activeName} onSelect={select} side />
      : null
    if (collapsible) {
      return (
        <div className="fmd-display has-side-menu is-collapsible">
          <div className="side-topbar">
            <button className="side-hamburger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>☰</button>
          </div>
          {open && <div className="side-backdrop" onClick={() => setOpen(false)} />}
          {nav && <aside className={`fmd-side-rail side-rail-pop${open ? ' open' : ''}`}>{nav}</aside>}
          <div className="fmd-page-content">{body}</div>
        </div>
      )
    }
    return (
      <div className="fmd-display has-side-menu">
        {nav && <aside className="fmd-side-rail">{nav}</aside>}
        <div className="fmd-page-content">{body}</div>
      </div>
    )
  }

  const nav = menuItems.length > 0
    ? <Menu items={menuItems} active={activeName} onSelect={onSelect} side={side} />
    : null

  const hasMenu = children.some((c) => c.type === 'Menu')
  return (
    <div className="fmd-display">
      {!hasMenu && nav}
      {page ? (
        children.map((c, i) => (c.type === 'Menu' ? <span key={i}>{nav}</span> : <Renderer key={i} node={c} />))
      ) : (
        empty
      )}
    </div>
  )
}
