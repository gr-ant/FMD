import React from 'react'
import type { Node } from '../../fmd/types'
import Renderer, { Menu } from '../Renderer'

type Props = {
  page: Node | null
  activeName: string
  menuItems: string[]
  onSelect: (item: string) => void
}

// Renders the active page inside the display shell. The menu is shared nav: it
// persists across pages (injected when a page has none) and switches the page.
export default function PageView({ page, activeName, menuItems, onSelect }: Props) {
  const nav = menuItems.length > 0
    ? <Menu items={menuItems} active={activeName} onSelect={onSelect} />
    : null
  const children = page ? page.children : []
  const hasMenu = children.some((c) => c.type === 'Menu')
  return (
    <div className="fmd-display">
      {!hasMenu && nav}
      {page ? (
        children.map((c, i) => (c.type === 'Menu' ? <span key={i}>{nav}</span> : <Renderer key={i} node={c} />))
      ) : (
        <div className="page-empty">
          No <code>[Display] {activeName}</code> page yet — add one to fill this tab.
        </div>
      )}
    </div>
  )
}
