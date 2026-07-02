import React, { useCallback, useMemo, useState } from 'react'
import { parseFMD, collectSchema, collectForms, collectRules, collectActions, collectTriggers, collectStyle, isDataBlock } from '../parser'
import Renderer from './Renderer'
import { FormModal, CasePage } from '../Widget'
import {
  DataContext, SchemaContext, FormsContext, FormsListContext, CaseNavContext, RulesContext, ActionsContext, ApiContext, RolesContext,
} from '../data'
import type { FormDef, OpenCaseValue } from '../state/contexts'
import { executeAction, pokeTriggers } from './runAction'
import { useTriggerSweep } from './useTriggers'
import { useGoogleFont } from './fontLoader'
import PageView from './panels/PageView'
import MobileShell from './MobileShell'
import { useIsMobile } from './useIsMobile'
import { findMenu, matchForm } from './panels/helpers'
import type { BlockNode, ButtonNode, FormNode, Node, FmdRecord } from '../fmd/types'

// The running FMD app: parses a document and renders its pages with all the
// runtime providers wired up. `apiBase` decides where data reads/writes go —
// '/api' for the editor preview, '/api/_app/<slug>' for a deployed app. This is
// the editor-free view used by published deployments.
export default function Preview({ source, apiBase = '/api', roles = ['*'] }: { source: string; apiBase?: string; roles?: string[] }): React.ReactNode {
  const [version, setVersion] = useState(0)
  const [openBtn, setOpenBtn] = useState<Node | null>(null)
  const [openCase, setOpenCase] = useState<OpenCaseValue | null>(null)
  const [page, setPage] = useState<string | null>(null)
  const mobile = useIsMobile()

  const tree = useMemo(() => parseFMD(source), [source])
  const schema = useMemo(() => collectSchema(tree), [tree])
  const rules = useMemo(() => collectRules(tree), [tree])
  const actions = useMemo(() => collectActions(tree), [tree])
  const triggers = useMemo(() => collectTriggers(tree), [tree])
  const style = useMemo(() => collectStyle(tree), [tree])
  useGoogleFont(style.font)
  const forms = collectForms(tree)

  const displayNodes = tree.children.filter((n) => !isDataBlock(n))
  const appNameNode = tree.children.find((n) => n.type === 'AppName')
  const appName = (appNameNode && 'value' in appNameNode ? appNameNode.value : '') || ''
  const pages = displayNodes.filter((n): n is BlockNode => n.type === 'Block' && n.tag.toLowerCase() === 'display')
  const extras = displayNodes.filter(
    (n) => !(n.type === 'Block' && n.tag.toLowerCase() === 'display') &&
      n.type !== 'Form' && n.type !== 'AppName' && n.type !== 'Rule' && n.type !== 'Action' &&
      n.type !== 'Trigger' && n.type !== 'Style' && n.type !== 'Role' && n.type !== 'Permission' && n.type !== 'Grant',
  )

  const bump = useCallback(() => setVersion((v) => v + 1), [])
  // After an action runs, poke the server to evaluate triggers, then refetch.
  // A 60s server sweep runs regardless (so triggers fire with the app closed).
  const runAction = (action: Parameters<typeof executeAction>[0], caseCtx?: { record: FmdRecord; source: string | null } | null): Promise<void> =>
    executeAction(action, { rules, base: apiBase, record: caseCtx?.record, source: caseCtx?.source })
      .then(() => pokeTriggers(apiBase))
      .then(() => setVersion((v) => v + 1))
  useTriggerSweep(triggers.length > 0, apiBase, bump)
  const activeForm = matchForm(forms as unknown as FormNode[], openBtn as ButtonNode | null) as unknown as
    React.ComponentProps<typeof FormModal>['form'] | null

  const menuNode = findMenu(pages.length ? pages : displayNodes)
  const menuItems = menuNode && menuNode.items.length ? menuNode.items : pages.map((p) => p.value).filter(Boolean)
  const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase()
  const fallback = menuItems[0] || (pages[0] && pages[0].value) || ''
  const activeName = page && menuItems.some((i) => norm(i) === norm(page)) ? page : fallback
  const activePage = pages.find((p) => norm(p.value) === norm(activeName)) || pages.find((p) => !norm(p.value)) || null

  return (
    <DataContext.Provider value={{ store: {}, version, refresh: () => setVersion((v) => v + 1) }}>
      <ApiContext.Provider value={apiBase}>
       <RolesContext.Provider value={roles}>
        <SchemaContext.Provider value={schema}>
          <RulesContext.Provider value={rules}>
            <ActionsContext.Provider value={{ actions, run: runAction }}>
              <FormsContext.Provider value={{ open: setOpenBtn }}>
               <FormsListContext.Provider value={forms as unknown as FormDef[]}>
                <CaseNavContext.Provider value={{ open: setOpenCase }}>
                {mobile ? (
                  <MobileShell
                    style={style} appName={appName}
                    pages={pages} displayNodes={displayNodes} extras={extras}
                    menuItems={menuItems} activeName={activeName} activePage={activePage}
                    onSelectPage={setPage}
                    openCase={openCase} onBackCase={() => setOpenCase(null)}
                    activeForm={activeForm} onCloseForm={() => setOpenBtn(null)}
                  />
                ) : (
                <div className="published preview-scroll" style={style.vars as React.CSSProperties}>
                  {!openCase && appName && <div className="app-name">{appName}</div>}
                  {openCase ? (
                    <CasePage caseView={openCase} onBack={() => setOpenCase(null)} />
                  ) : pages.length > 0 ? (
                    <>
                      <PageView page={activePage} activeName={activeName} menuItems={menuItems} onSelect={setPage} />
                      {extras.map((n, i) => <Renderer key={`x${i}`} node={n} />)}
                    </>
                  ) : (
                    displayNodes.map((n, i) => <Renderer key={i} node={n} />)
                  )}
                  {activeForm && <FormModal form={activeForm} onClose={() => setOpenBtn(null)} />}
                </div>
                )}
                </CaseNavContext.Provider>
               </FormsListContext.Provider>
              </FormsContext.Provider>
            </ActionsContext.Provider>
          </RulesContext.Provider>
        </SchemaContext.Provider>
       </RolesContext.Provider>
      </ApiContext.Provider>
    </DataContext.Provider>
  )
}
