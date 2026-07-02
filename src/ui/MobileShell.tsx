import React, { useEffect, useRef } from 'react'
import Renderer from './Renderer'
import { FormModal, CasePage } from '../Widget'
import type { BlockNode, Node } from '../fmd/types'
import type { OpenCaseValue } from '../state/contexts'
import type { StyleSpec } from '../parser'

type Props = {
  style: StyleSpec
  appName: string
  pages: BlockNode[]
  displayNodes: Node[]
  extras: Node[]
  menuItems: string[]
  activeName: string
  activePage: BlockNode | null
  onSelectPage: (name: string) => void
  openCase: OpenCaseValue | null
  onBackCase: () => void
  activeForm: React.ComponentProps<typeof FormModal>['form'] | null
  onCloseForm: () => void
}

const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase()

// A purpose-built mobile layout for the running app: a compact app bar, a
// horizontally-scrollable tab strip for pages, and a comfortably-spaced content
// column. Reuses the same Renderer/forms/cases as the desktop view — only the
// chrome and spacing differ. Forms become bottom sheets (styled via .mobile-app).
export default function MobileShell({
  style, appName, pages, displayNodes, extras, menuItems,
  activeName, activePage, onSelectPage, openCase, onBackCase,
  activeForm, onCloseForm,
}: Props): React.ReactNode {
  const tabsRef = useRef<HTMLDivElement>(null)

  // Keep the selected tab visible as the user pages through.
  useEffect(() => {
    const el = tabsRef.current?.querySelector('.m-tab.active') as HTMLElement | null
    el?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [activeName])

  const showTabs = !openCase && menuItems.length > 1
  // The active page's body, minus any inline [Menu] (the tab strip is the nav).
  const pageBody = activePage ? activePage.children.filter((c) => c.type !== 'Menu') : []

  return (
    <div className="mobile-app" style={style.vars as React.CSSProperties}>
      <header className="m-appbar">
        {openCase ? (
          <button className="m-back" onClick={onBackCase} aria-label="Back">‹ Back</button>
        ) : (
          <span className="m-app-name">{appName || 'App'}</span>
        )}
      </header>

      {showTabs && (
        <nav className="m-tabs" ref={tabsRef}>
          {menuItems.map((item) => (
            <button
              key={item}
              className={`m-tab${norm(item) === norm(activeName) ? ' active' : ''}`}
              onClick={() => onSelectPage(item)}
            >
              {item}
            </button>
          ))}
        </nav>
      )}

      <main className="m-content">
        {openCase ? (
          <CasePage caseView={openCase} onBack={onBackCase} />
        ) : pages.length > 0 ? (
          <>
            {activePage
              ? pageBody.map((c, i) => <Renderer key={i} node={c} />)
              : <div className="page-empty">No <code>[Display] {activeName}</code> page yet.</div>}
            {extras.map((n, i) => <Renderer key={`x${i}`} node={n} />)}
          </>
        ) : (
          displayNodes.map((n, i) => <Renderer key={i} node={n} />)
        )}
      </main>

      {activeForm && <FormModal form={activeForm} onClose={onCloseForm} />}
    </div>
  )
}
