import React, { useEffect, useMemo, useRef, useState } from 'react'
import { parseFMD, collectSchema, collectForms, collectRules, isDataBlock, lintReferences } from './parser.js'
import Renderer from './Renderer.jsx'
import { FormModal } from './Widget.jsx'
import { DataContext, SchemaContext, FormsContext, RulesContext } from './data.js'
import { getConfig, setConfig, deleteConfig } from './config.js'
import defaultFmd from '../app.fmd?raw'
import CodeEditor from './app/CodeEditor.jsx'
import DataInspector from './app/DataInspector.jsx'
import PageView from './app/PageView.jsx'
import { findMenu, matchForm } from './app/helpers.js'

export default function App() {
  const [source, setSource] = useState(defaultFmd)
  const [showSource, setShowSource] = useState(true)
  const [showData, setShowData] = useState(false)
  const [store, setStore] = useState(null)
  const [version, setVersion] = useState(0)
  const [save, setSave] = useState({ state: 'idle', msg: '' })
  const [page, setPage] = useState(null) // active page name (menu-driven)
  const [openBtn, setOpenBtn] = useState(null) // button whose form modal is open

  // Records live behind the scenes -- loaded at runtime, not in the document.
  useEffect(() => {
    fetch('/data.json')
      .then((r) => r.json())
      .then(setStore)
      .catch(() => setStore({}))
  }, [])

  // Load the saved FMD document from the config store, if one exists. Falls back
  // to the bundled app.fmd (the initial state).
  useEffect(() => {
    getConfig('document').then((doc) => { if (typeof doc === 'string' && doc.trim()) setSource(doc) })
  }, [])

  // Restore the bundled file and forget the saved document.
  function resetToFile() {
    setSource(defaultFmd)
    deleteConfig('document')
  }

  const tree = useMemo(() => parseFMD(source), [source])
  const schema = useMemo(() => collectSchema(tree), [tree])
  const displayNodes = tree.children.filter((n) => !isDataBlock(n))

  // Lint field references against the [Data] model -> editor underlines.
  const issues = useMemo(() => lintReferences(source, schema), [source, schema])

  // The global [App Name] title (renders on top, above the pages).
  const appName = (tree.children.find((n) => n.type === 'AppName') || {}).value || ''

  // Each top-level [Display] Name is a page; the [Top Menu Bar] navigates them.
  const pages = displayNodes.filter((n) => n.type === 'Block' && n.tag.toLowerCase() === 'display')
  const extras = displayNodes.filter((n) => !(n.type === 'Block' && n.tag.toLowerCase() === 'display') && n.type !== 'Form' && n.type !== 'AppName' && n.type !== 'Rule')

  // Top-level [Form] modals, opened by [Button]s; and named [Rule]s.
  const forms = collectForms(tree)
  const rules = useMemo(() => collectRules(tree), [tree])
  const activeForm = matchForm(forms, openBtn)
  const menuNode = findMenu(pages.length ? pages : displayNodes)
  const menuItems = menuNode && menuNode.items.length ? menuNode.items : pages.map((p) => p.value).filter(Boolean)
  const norm = (s) => String(s ?? '').trim().toLowerCase()
  // Default to the first menu item; also fall back to it if the current
  // selection is no longer a valid tab (e.g. after the document was edited).
  const fallback = menuItems[0] || (pages[0] && pages[0].value) || ''
  const activeName = page && menuItems.some((i) => norm(i) === norm(page)) ? page : fallback
  const activePage = pages.find((p) => norm(p.value) === norm(activeName)) || pages.find((p) => !norm(p.value)) || null

  // Apply the FMD's data model to the live databases, then refetch bindings.
  async function applyModel() {
    if (save.state === 'saving') return
    const entities = Object.entries(schema).map(([src, def]) => ({
      source: src, name: def.name, fields: def.fields, kind: def.kind,
    }))
    setSave({ state: 'saving', msg: 'Applying…' })
    setConfig('document', source) // persist the document alongside the model
    try {
      // If the app was renamed, fully rewrite the DB so no data from the
      // previous config (e.g. a same-named entity) survives.
      const prevName = await getConfig('appName')
      const reset = prevName != null && prevName !== appName
      const r = await fetch('/api/_apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entities, reset }),
      })
      const data = await r.json()
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`)
      await setConfig('appName', appName)
      const n = data.applied.length
      setSave({ state: 'ok', msg: reset ? `App renamed — DB rebuilt (${n})` : `Applied ${n} ${n === 1 ? 'entity' : 'entities'}` })
      setVersion((v) => v + 1) // force every binding to refetch from the DB
    } catch (e) {
      setSave({ state: 'error', msg: `Failed: ${e.message}` })
    }
  }

  // Ctrl/Cmd+S triggers the save (instead of the browser's save dialog).
  const applyRef = useRef(applyModel)
  useEffect(() => { applyRef.current = applyModel })
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        applyRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <DataContext.Provider value={{ store: store || {}, version, refresh: () => setVersion((v) => v + 1) }}>
     <SchemaContext.Provider value={schema}>
      <RulesContext.Provider value={rules}>
      <FormsContext.Provider value={{ open: setOpenBtn }}>
      <div className="app">
        <header className="app-header">
          <div className="brand">
            <span className="logo">ƒ</span>
            <div>
              <strong>Functional Markdown</strong>
              <small>edit app.fmd · UI binds to data loaded at runtime</small>
            </div>
          </div>
          <div className="header-actions">
            {save.state !== 'idle' && (
              <span className={`save-msg ${save.state}`}>{save.msg}</span>
            )}
            <button
              className="toggle primary"
              onClick={applyModel}
              disabled={save.state === 'saving'}
              title="Save → rebuild DB (Ctrl/⌘+S)"
            >
              {save.state === 'saving' ? 'Saving…' : 'Save → rebuild DB'}
            </button>
            <button className="toggle" onClick={resetToFile} title="Discard the saved document and reload app.fmd">
              Reset to file
            </button>
            <button className="toggle" onClick={() => setShowData((s) => !s)}>
              {showData ? 'Hide data model' : 'Data model'}
            </button>
            <button className="toggle" onClick={() => setShowSource((s) => !s)}>
              {showSource ? 'Hide source' : 'Show source'}
            </button>
          </div>
        </header>

        <div className={`workspace ${showSource ? '' : 'full'}`}>
          {showSource && (
            <div className="editor-pane">
              <div className="pane-label">
                app.fmd
                {issues.length > 0 && <span className="issue-count">{issues.length} issue{issues.length > 1 ? 's' : ''}</span>}
              </div>
              <CodeEditor source={source} setSource={setSource} issues={issues} />
            </div>
          )}
          <div className="preview-pane">
            <div className="pane-label">preview — [Display] {activeName && `· ${activeName}`}</div>
            <div className="preview-scroll">
              {appName && <div className="app-name">{appName}</div>}
              {pages.length > 0 ? (
                <>
                  <PageView page={activePage} activeName={activeName} menuItems={menuItems} onSelect={setPage} />
                  {extras.map((n, i) => <Renderer key={`x${i}`} node={n} />)}
                </>
              ) : (
                displayNodes.map((n, i) => <Renderer key={i} node={n} />)
              )}
            </div>
          </div>
        </div>

        {showData && <DataInspector schema={schema} store={store} />}
      </div>
      {activeForm && <FormModal form={activeForm} onClose={() => setOpenBtn(null)} />}
      </FormsContext.Provider>
      </RulesContext.Provider>
     </SchemaContext.Provider>
    </DataContext.Provider>
  )
}
