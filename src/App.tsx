import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseFMD, collectSchema, collectForms, collectRules, collectActions, collectTriggers, collectStyle, collectRoles, isDataBlock, lintReferences, collectWarnings } from './parser'
import type { Warning } from './parser'
import Renderer from './Renderer'
import { FormModal, CasePage } from './Widget'
import { DataContext, SchemaContext, FormsContext, FormsListContext, CaseNavContext, RulesContext, ActionsContext, RolesContext, UserMgmtContext } from './data'
import type { FormDef, OpenCaseValue } from './state/contexts'
import UserManagement from './ui/panels/UserManagement'
import { executeAction, pokeTriggers } from './ui/runAction'
import { useTriggerSweep } from './ui/useTriggers'
import { getConfig, setConfig, deleteConfig } from './config'
import defaultFmd from '../app.fmd?raw'
import { type FmdFile, combineFiles, wrapDoc, fileLineOffsets, nextFileName, filesToMarkedDoc, markedDocToFiles } from './state/files'
import FileTray from './ui/panels/FileTray'
import { useGoogleFont } from './ui/fontLoader'
import { setPreviewRoles } from './state/auth'
import CodeEditor from './ui/panels/CodeEditor'
import DataInspector from './ui/panels/DataInspector'
import AuthControl from './ui/panels/AuthControl'
import PageView from './ui/panels/PageView'
import ConfigsMenu from './ui/panels/ConfigsMenu'
import ImportFiles from './ui/panels/ImportFiles'
import HeaderMenu from './ui/panels/HeaderMenu'
import Preview from './ui/Preview'
import { useIsMobile } from './ui/useIsMobile'
import AiChat from './ui/panels/AiChat'
import ManageDeployments from './ui/panels/ManageDeployments'
import ApiSetup, { findApiBlocks, parseApiBlock, spliceApiBlock } from './ui/panels/ApiSetup'
import { fixFmd, DEFAULT_MODEL, type AiSettings } from './ai/gemini'
import { useDialogs } from './ui/dialogs'
import { findMenu, matchForm } from './ui/panels/helpers'
import type { Node, BlockNode, Entity, FmdRecord, FormNode, ButtonNode } from './fmd/types'

interface SaveState { state: 'idle' | 'saving' | 'ok' | 'error'; msg: string }

export default function App() {
  const dialogs = useDialogs()
  // A config is an ordered list of named files; the single document everything
  // else parses is their concatenation (combineFiles). The editor edits one file
  // at a time (activeFile).
  const [files, setFiles] = useState<FmdFile[]>(() => wrapDoc(defaultFmd))
  const [activeFile, setActiveFile] = useState(0)
  const [trayOpen, setTrayOpen] = useState<boolean>(() => localStorage.getItem('fmd_tray_open') !== '0')
  const toggleTray = (): void => setTrayOpen((o) => { localStorage.setItem('fmd_tray_open', o ? '0' : '1'); return !o })
  const active = files.length ? Math.min(activeFile, files.length - 1) : 0
  const source = useMemo(() => combineFiles(files), [files])
  const activeContent = files[active]?.content ?? ''
  const setActiveContent = (next: string) =>
    setFiles((fs) => fs.map((f, i) => (i === active ? { ...f, content: next } : f)))
  // Editor / preview panes: each collapses to a thin rail, and a draggable
  // divider sets their width split (all persisted).
  // On phones the editor split is unusable, so by default we show the running
  // app full-screen (the mobile shell) and offer a FAB to drop into editing.
  const isMobile = useIsMobile()
  const [mobileEdit, setMobileEdit] = useState(false)
  // Mobile editor: which primary surface is showing, plus the raw-config sheet
  // and the overflow (⋮) menu sheet.
  const [mobileTab, setMobileTab] = useState<'app' | 'ai'>('app')
  const [codeOpen, setCodeOpen] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [editorOpen, setEditorOpen] = useState<boolean>(() => localStorage.getItem('fmd_editor_open') !== '0')
  const [previewOpen, setPreviewOpen] = useState<boolean>(() => localStorage.getItem('fmd_preview_open') !== '0')
  const [split, setSplit] = useState<number>(() => Number(localStorage.getItem('fmd_split')) || 0.42)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const toggleEditor = (): void => setEditorOpen((o) => { localStorage.setItem('fmd_editor_open', o ? '0' : '1'); return !o })
  const togglePreview = (): void => setPreviewOpen((o) => { localStorage.setItem('fmd_preview_open', o ? '0' : '1'); return !o })
  const startSplitDrag = (e: React.MouseEvent): void => {
    e.preventDefault()
    let frac = split
    const move = (ev: MouseEvent): void => {
      const r = workspaceRef.current?.getBoundingClientRect()
      if (!r || !r.width) return
      frac = Math.min(0.85, Math.max(0.15, (ev.clientX - r.left) / r.width))
      setSplit(frac)
    }
    const up = (): void => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.body.style.cursor = ''
      localStorage.setItem('fmd_split', String(frac))
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.body.style.cursor = 'col-resize'
  }
  const [showData, setShowData] = useState(false)
  const [store, setStore] = useState<Record<string, FmdRecord[]> | null>(null)
  const [version, setVersion] = useState(0)
  const [save, setSave] = useState<SaveState>({ state: 'idle', msg: '' })
  const [page, setPage] = useState<string | null>(null) // active page name (menu-driven)
  const [openBtn, setOpenBtn] = useState<Node | null>(null) // button whose form modal is open
  const [openCase, setOpenCase] = useState<OpenCaseValue | null>(null) // a [Cases] case taking over the page
  const [showAi, setShowAi] = useState(false)
  const [aiFixing, setAiFixing] = useState(false)
  const [showDb, setShowDb] = useState(false)
  const [showUsers, setShowUsers] = useState(false)
  const [apiSetup, setApiSetup] = useState<{ name: string } | null>(null) // open [API] wizard for this block
  // Effective roles for `{Role, !Role}` visibility in the EDITOR preview. The
  // author isn't a real signed-in user here, so they "preview as" a chosen role:
  //   '*'  -> see everything (author view, the default)
  //   ''   -> signed out (no roles)
  //   else -> a single declared role, lowercased
  // (The deployed /app/<slug> uses the real signed-in user's roles instead.)
  const [previewAs, setPreviewAs] = useState<string>('*')
  const visRoles = useMemo<string[]>(
    () => (previewAs === '*' ? ['*'] : previewAs === '' ? [] : [previewAs]),
    [previewAs],
  )
  // Mirror "Preview as" to the server so editor data calls enforce permissions as
  // that role ('*' = full author access). See apiFetch's X-FMD-Roles header.
  // Set it DURING render (not in an effect): child data-fetch effects fire before
  // a parent effect would, so an effect here would let the first request go out
  // role-less and 403. Setting a module var in render is idempotent + safe.
  setPreviewRoles(visRoles)

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
    getConfig('files').then((f) => {
      if (Array.isArray(f) && f.length) { setFiles(f as FmdFile[]); return }
      getConfig('document').then((doc) => { if (typeof doc === 'string' && doc.trim()) setFiles(wrapDoc(doc)) })
    })
  }, [])

  // Persist the current tray (files + their combined document) to the config KV.
  function persistFiles(fs: FmdFile[]): void {
    setConfig('files', fs)
    setConfig('document', combineFiles(fs))
  }

  // Restore the bundled file and forget the saved document.
  function resetToFile(): void {
    setFiles(wrapDoc(defaultFmd)); setActiveFile(0)
    deleteConfig('document'); deleteConfig('files')
  }

  // Load a saved config into the editor (restoring its file split if any). The
  // data model isn't rebuilt automatically — the user clicks "Save → rebuild
  // DB" if they want the database to match the loaded app.
  function loadConfig(doc: string, name: string, savedFiles?: FmdFile[]): void {
    const fs = savedFiles && savedFiles.length ? savedFiles : wrapDoc(doc)
    setFiles(fs); setActiveFile(0)
    persistFiles(fs)
    setSave({ state: 'ok', msg: `Loaded “${name}” — Save → rebuild DB to match its data` })
  }

  // Replace the editor with one or more uploaded .fmd files merged together.
  async function importFiles(mergedText: string, names: string[]): Promise<void> {
    const plural = names.length > 1 ? 's' : ''
    if (source.trim() && source !== defaultFmd &&
        !(await dialogs.confirm({ message: `Replace the editor with ${names.length} merged file${plural}?`, confirmLabel: 'Replace' }))) return
    const fs = wrapDoc(mergedText)
    setFiles(fs); setActiveFile(0)
    persistFiles(fs)
    setSave({ state: 'ok', msg: `Merged ${names.length} file${plural} — Save → rebuild DB to apply` })
  }

  // ---- file tray actions ---------------------------------------------------
  function addFile(): void {
    setFiles((fs) => { const next = [...fs, { name: nextFileName(fs), content: '' }]; setActiveFile(next.length - 1); return next })
  }
  function renameFile(i: number, name: string): void {
    setFiles((fs) => fs.map((f, j) => (j === i ? { ...f, name } : f)))
  }
  async function deleteFile(i: number): Promise<void> {
    if (files.length <= 1) return
    if (!(await dialogs.confirm({ title: 'Delete file', message: `Delete “${files[i].name}”? Its contents leave the config.`, confirmLabel: 'Delete', danger: true }))) return
    setFiles((fs) => fs.filter((_, j) => j !== i))
    setActiveFile((a) => (a >= i && a > 0 ? a - 1 : a))
  }
  function moveFile(i: number, dir: -1 | 1): void {
    reorderFile(i, i + dir)
  }
  // Arbitrary drag-reorder. Keeps the same file active by object identity (the
  // reordered array reuses the same file objects, so indexOf finds its new slot).
  function reorderFile(from: number, to: number): void {
    if (from === to || to < 0 || to >= files.length) return
    const n = [...files]
    const [moved] = n.splice(from, 1)
    n.splice(to, 0, moved)
    const activeObj = files[active]
    setFiles(n)
    setActiveFile(n.indexOf(activeObj))
  }
  // Files dropped onto the tray become new tray files (appended); focus the first.
  function uploadFiles(dropped: FmdFile[]): void {
    if (!dropped.length) return
    setActiveFile(files.length)
    setFiles((fs) => [...fs, ...dropped])
  }

  // [API] blocks in the ACTIVE file — each gets a ⚙ "Set up" button that opens
  // the wizard, which splices its [URL]/[Auth]/[Path]/[Map] lines back into THIS
  // file's content (the same state the editor edits). The key stays server-side.
  const apiBlocks = useMemo(() => findApiBlocks(activeContent), [activeContent])

  const tree = useMemo(() => parseFMD(source), [source])
  const schema = useMemo(() => collectSchema(tree), [tree])
  const displayNodes = tree.children.filter((n) => !isDataBlock(n))

  // Lint field references against the [Data] model -> editor underlines.
  const issues = useMemo(() => lintReferences(source, schema), [source, schema])

  // Structural warnings (missing/mis-wired pieces) + field-ref issues, shown in
  // the editor's warnings footer. Errors first, then warnings.
  const warnings = useMemo<Warning[]>(() => {
    const structural = collectWarnings(tree, schema)
    const refs: Warning[] = issues.map((i) => ({ level: 'error', message: i.message, line: i.line }))
    return [...structural, ...refs].sort((a, b) => (a.level === b.level ? 0 : a.level === 'error' ? -1 : 1))
  }, [tree, schema, issues])
  // Blocking errors (e.g. [User Management] without a [List Users]) prevent save/deploy.
  const blockers = warnings.filter((w) => w.block)
  const blocked = blockers.length > 0
  const blockMsg = blockers[0]?.message || 'Fix the blocking errors first'

  // Map global (combined-document) issue/warning lines back to the ACTIVE file so
  // the editor's underlines + footer line up with what's on screen. Line-less
  // (structural) warnings stay visible on every file.
  const editorView = useMemo(() => {
    const offsets = fileLineOffsets(files)
    const start = offsets[active] ?? 0
    const len = files[active]?.content.split('\n').length ?? 0
    const inFile = (line?: number | null): boolean => line != null && line >= start && line < start + len
    return {
      localIssues: issues.filter((i) => inFile(i.line)).map((i) => ({ ...i, line: i.line - start })),
      localWarnings: warnings.filter((w) => w.line == null || inFile(w.line)).map((w) => (w.line == null ? w : { ...w, line: w.line - start })),
      elsewhere: warnings.filter((w) => w.line != null && !inFile(w.line)).length,
    }
  }, [files, active, issues, warnings])

  // Replace the editor with an AI-generated document.
  function applyAi(doc: string): void {
    const fs = markedDocToFiles(doc) // preserve the AI's file markers as separate files
    setFiles(fs); setActiveFile(0)
    persistFiles(fs)
    setSave({ state: 'ok', msg: 'Applied AI result — review, then Save → rebuild DB to apply the data model' })
  }

  // Send the current document + the editor's error messages to Gemini and apply
  // the corrected version. Opens the AI panel (to add a key) if none is saved.
  async function aiFix(): Promise<void> {
    const s = (await getConfig('ai')) as Partial<AiSettings> | null
    if (!s?.apiKey) { setShowAi(true); dialogs.toast('Add your Gemini key first', { kind: 'error' }); return }
    const errs = warnings.filter((w) => w.level === 'error').map((w) => w.message)
    if (!errs.length || aiFixing) return
    setAiFixing(true)
    try {
      // Give the AI the file-marked document so it sees + preserves the split.
      const marked = filesToMarkedDoc(files)
      const result = await fixFmd({ apiKey: s.apiKey, model: s.model || DEFAULT_MODEL }, marked, errs)
      if (!result) throw new Error('Empty response from Gemini')
      const ok = await dialogs.review({
        title: `AI fix · ${errs.length} issue${errs.length > 1 ? 's' : ''}`,
        message: 'Review the changes Gemini made, then apply.',
        before: marked,
        after: result,
      })
      if (ok) applyAi(result)
    } catch (e) {
      dialogs.toast(`AI fix failed: ${e instanceof Error ? e.message : String(e)}`, { kind: 'error' })
    } finally {
      setAiFixing(false)
    }
  }

  // Auto-populate a missing section by appending its scaffold to the active file.
  function applyFix(append: string): void {
    setActiveContent(`${activeContent.replace(/\s*$/, '')}\n${append}`)
  }

  // The global [App Name] title (renders on top, above the pages).
  const appNameNode = tree.children.find((n) => n.type === 'AppName')
  const appName = (appNameNode && 'value' in appNameNode ? appNameNode.value : '') || ''

  // Each top-level [Display] Name is a page; the [Top Menu Bar] navigates them.
  const pages = displayNodes.filter(
    (n): n is BlockNode => n.type === 'Block' && n.tag.toLowerCase() === 'display',
  )
  const extras = displayNodes.filter((n) => !(n.type === 'Block' && n.tag.toLowerCase() === 'display') && n.type !== 'Form' && n.type !== 'AppName' && n.type !== 'Rule' && n.type !== 'Action' && n.type !== 'Trigger' && n.type !== 'Style' && n.type !== 'Role' && n.type !== 'Permission' && n.type !== 'Grant')
  const style = useMemo(() => collectStyle(tree), [tree])
  useGoogleFont(style.font)

  // Top-level [Form] modals, opened by [Button]s; and named [Rule]s.
  const forms = collectForms(tree)
  const rules = useMemo(() => collectRules(tree), [tree])
  const appRoles = useMemo(() => collectRoles(tree), [tree])

  // Named [Action]s and their runner: execute the steps, then refetch bindings
  // so the (declarative) UI re-reads the data the action just wrote.
  const actions = useMemo(() => collectActions(tree), [tree])
  const triggers = useMemo(() => collectTriggers(tree), [tree])
  const bumpVersion = useCallback(() => setVersion((v) => v + 1), [])
  // After an action runs, poke the server to evaluate triggers (the action may
  // have made a row match), then refetch. A 60s server sweep runs regardless.
  const runAction = (action: Parameters<typeof executeAction>[0], caseCtx?: { record: FmdRecord; source: string | null } | null): Promise<void> =>
    executeAction(action, { rules, record: caseCtx?.record, source: caseCtx?.source })
      .then(() => pokeTriggers('/api'))
      .then(() => setVersion((v) => v + 1))
  useTriggerSweep(triggers.length > 0, '/api', bumpVersion)
  // TODO(ts): the [Form] pipeline uses three different nominal types for the
  // same runtime object -- CollectedForm (collectForms), FormNode (matchForm),
  // and FormDef (FormModal) -- all structurally { title, source, fields }.
  // Cast across the boundary; reconciling those types is for the Verify pass.
  const activeForm = matchForm(forms as unknown as FormNode[], openBtn as ButtonNode | null) as unknown as
    React.ComponentProps<typeof FormModal>['form'] | null
  const menuNode = findMenu(pages.length ? pages : displayNodes)
  const menuItems = menuNode && menuNode.items.length ? menuNode.items : pages.map((p) => p.value).filter(Boolean)
  const norm = (s: unknown): string => String(s ?? '').trim().toLowerCase()
  // Default to the first menu item; also fall back to it if the current
  // selection is no longer a valid tab (e.g. after the document was edited).
  const fallback = menuItems[0] || (pages[0] && pages[0].value) || ''
  const activeName = page && menuItems.some((i) => norm(i) === norm(page)) ? page : fallback
  const activePage = pages.find((p) => norm(p.value) === norm(activeName)) || pages.find((p) => !norm(p.value)) || null

  // Apply the FMD's data model to the live databases, then refetch bindings.
  async function applyModel(): Promise<void> {
    if (save.state === 'saving') return
    if (blocked) { setSave({ state: 'error', msg: blockMsg }); return }
    // The reserved `users` source is Authentik-backed — never a Postgres table.
    const entities = Object.entries(schema)
      .filter(([src]) => src !== 'users')
      .map(([src, def]: [string, Entity]) => ({
        // `api` (url/auth/path/field-maps) rides along for [API] sources so the
        // server can persist the proxy config; the secret key is set separately.
        source: src, name: def.name, fields: def.fields, kind: def.kind, ...(def.api ? { api: def.api } : {}),
      }))
    // Permission model for server-side enforcement: { source: { roleLower: verbs[] } }.
    const permissions: Record<string, Record<string, string[]>> = {}
    for (const [src, def] of Object.entries(schema)) {
      if (def.permissions) {
        permissions[src] = {}
        for (const [roleLc, p] of Object.entries(def.permissions)) permissions[src][roleLc] = p.verbs
      }
    }
    // If the app was renamed, fully rewrite the DB so no data from the
    // previous config (e.g. a same-named entity) survives.
    const prevName = await getConfig('appName').catch((): string | null => null)
    const reset = prevName != null && prevName !== appName

    // ---- destructive-change preview -------------------------------------
    // Diff the new model against what's live so the user confirms exactly
    // which tables/columns (and their data) an apply will drop.
    try {
      const schemaRes = await fetch('/api/_schema?detail=1')
      const cur: Record<string, { kind: string; columns: string[] }> = schemaRes.ok ? await schemaRes.json() : {}
      const newBySrc = new Map(entities.map((e) => [e.source, e]))
      const lc = (s: string) => String(s).toLowerCase()
      const drops: string[] = []
      const colDrops: string[] = []
      for (const [src, info] of Object.entries(cur)) {
        const next = newBySrc.get(src)
        if (!next) { drops.push(src); continue }
        if (info.kind !== next.kind && next.kind !== 'api') {
          drops.push(`${src} (${info.kind} → ${next.kind})`)
        } else if (info.kind === 'list' && next.kind === 'list') {
          const declared = new Set(next.fields.map((f) => lc(f.name)))
          const gone = (info.columns || []).filter((c) => !declared.has(lc(c)))
          if (gone.length) colDrops.push(`${src}: ${gone.join(', ')}`)
        }
      }
      const parts: string[] = []
      if (reset) parts.push(`App renamed (“${prevName}” → “${appName}”) — the entire database is rebuilt and ALL existing records are lost.`)
      if (drops.length) parts.push(`Tables dropped — every record in them is lost:\n• ${drops.join('\n• ')}`)
      if (colDrops.length) parts.push(`Columns dropped — their values are lost:\n• ${colDrops.join('\n• ')}`)
      if (parts.length) {
        const ok = await dialogs.confirm({
          danger: true,
          title: 'This apply deletes data',
          message: parts.join('\n\n'),
          confirmLabel: 'Apply anyway',
          cancelLabel: 'Cancel',
        })
        if (!ok) { setSave({ state: 'idle', msg: '' }); return }
      }
    } catch { /* diff is best-effort — never block the apply on it */ }

    setSave({ state: 'saving', msg: 'Applying…' })
    persistFiles(files) // persist the document + its file split alongside the model
    try {
      const r = await fetch('/api/_apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entities, reset, permissions, triggers, rules }),
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
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        applyRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Mobile, app view: the running app full-screen via the self-contained shell,
  // plus a FAB to switch into editing. (setPreviewRoles ran above, so the
  // preview-as role still governs data access.)
  if (isMobile && !mobileEdit) {
    return (
      <div className="mobile-host">
        <Preview source={source} apiBase="/api" roles={visRoles} />
        <button className="mobile-edit-fab" onClick={() => setMobileEdit(true)} title="Edit configuration" aria-label="Edit configuration">✎</button>
      </div>
    )
  }

  // Mobile, edit mode: a purpose-built builder. Two primary surfaces — AI Chat
  // and the running App — plus the raw config behind a </> sheet and all the
  // admin actions tucked into a ⋮ bottom-sheet menu.
  if (isMobile && mobileEdit) {
    const saving = save.state === 'saving'
    return (
      <div className="mobile-editor">
        <div className="me-bar">
          <button className="me-back" onClick={() => setMobileEdit(false)} title="Back to the app">‹ Done</button>
          <span className="me-title">{appName || 'Editor'}</span>
          <div className="me-bar-actions">
            <button className="me-icon" onClick={() => setCodeOpen(true)} title="Edit raw config" aria-label="Edit raw config">&lt;/&gt;</button>
            <button className="me-save" onClick={applyModel} disabled={saving || blocked} title={blocked ? blockMsg : 'Save → rebuild DB'}>{saving ? '…' : 'Save'}</button>
            <button className="me-icon" onClick={() => setMobileMenu(true)} title="More" aria-label="More options">⋮</button>
          </div>
        </div>

        <div className="me-tabs">
          <button className={`me-tab${mobileTab === 'ai' ? ' active' : ''}`} onClick={() => setMobileTab('ai')}>✨ AI Chat</button>
          <button className={`me-tab${mobileTab === 'app' ? ' active' : ''}`} onClick={() => setMobileTab('app')}>👁 App</button>
        </div>

        <div className="me-body">
          {mobileTab === 'ai'
            ? <AiChat open onClose={() => setMobileTab('app')} source={filesToMarkedDoc(files)} onApply={applyAi} />
            : <Preview source={source} apiBase="/api" roles={visRoles} />}
        </div>

        {save.state !== 'idle' && !saving && <div className={`me-toast ${save.state}`}>{save.msg}</div>}

        {codeOpen && (
          <div className="me-sheet">
            <div className="me-sheet-bar">
              <span className="me-sheet-title">Raw config{warnings.length > 0 && <span className="issue-count">{warnings.length}</span>}</span>
              <button className="me-save" onClick={() => setCodeOpen(false)}>Done</button>
            </div>
            <CodeEditor source={activeContent} setSource={setActiveContent} issues={editorView.localIssues} warnings={editorView.localWarnings} onFix={applyFix} onAiFix={aiFix} aiFixing={aiFixing} />
          </div>
        )}

        {mobileMenu && (
          <div className="me-menu-backdrop" onClick={() => setMobileMenu(false)}>
            <div className="me-menu-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="me-menu-grab" />
              <div className="me-menu-tools">
                <AuthControl />
                <ConfigsMenu source={source} files={files} appName={appName} onLoad={loadConfig} />
                <ImportFiles onImport={importFiles} />
              </div>
              {appRoles.length > 0 && (
                <label className="me-menu-row">
                  <span>👁 Preview as</span>
                  <select value={previewAs} onChange={(e) => setPreviewAs(e.target.value)}>
                    <option value="*">All (author)</option>
                    {appRoles.map((r) => <option key={r} value={r.toLowerCase()}>{r}</option>)}
                    <option value="">Signed out</option>
                  </select>
                </label>
              )}
              {apiBlocks.map((b) => (
                <button key={b.line} className="me-menu-item" onClick={() => { setApiSetup({ name: b.name }); setMobileMenu(false) }}>⚙ Connect {b.name} API</button>
              ))}
              <button className="me-menu-item" onClick={() => { setShowData(true); setMobileMenu(false) }}>🗂 Data model</button>
              <button className="me-menu-item" onClick={() => { setShowDb(true); setMobileMenu(false) }}>📦 Manage Deployments</button>
              <button className="me-menu-item" onClick={() => { setShowUsers(true); setMobileMenu(false) }}>👤 Users</button>
              <button className="me-menu-item danger" onClick={() => { resetToFile(); setMobileMenu(false) }}>↺ Reset to file</button>
            </div>
          </div>
        )}

        {showData && <DataInspector schema={schema} store={store || {}} />}
        {showDb && <ManageDeployments onClose={() => setShowDb(false)} />}
        {showUsers && <UserManagement roles={appRoles} onClose={() => setShowUsers(false)} />}
        {apiSetup && (
          <ApiSetup
            source={apiSetup.name.trim().toLowerCase() || 'api'}
            name={apiSetup.name}
            initial={parseApiBlock(activeContent, apiSetup.name)}
            onApply={(lines) => setActiveContent(spliceApiBlock(activeContent, apiSetup.name, lines))}
            onClose={() => setApiSetup(null)}
          />
        )}
      </div>
    )
  }

  return (
    <DataContext.Provider value={{ store: store || {}, version, refresh: () => setVersion((v) => v + 1) }}>
     <SchemaContext.Provider value={schema}>
      <RulesContext.Provider value={rules}>
      <RolesContext.Provider value={visRoles}>
      <UserMgmtContext.Provider value={{ open: () => setShowUsers(true) }}>
      <ActionsContext.Provider value={{ actions, run: runAction }}>
      <FormsContext.Provider value={{ open: setOpenBtn }}>
      <FormsListContext.Provider value={forms as unknown as FormDef[]}>
      <CaseNavContext.Provider value={{ open: setOpenCase }}>
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
            {appRoles.length > 0 && (
              <label className="preview-as" title="Preview the UI as a user holding this role (editor only — the deployed app uses the real signed-in user)">
                <span>👁 as</span>
                <select value={previewAs} onChange={(e) => setPreviewAs(e.target.value)}>
                  <option value="*">All (author)</option>
                  {appRoles.map((r) => <option key={r} value={r.toLowerCase()}>{r}</option>)}
                  <option value="">Signed out</option>
                </select>
              </label>
            )}
            <AuthControl />
            {save.state !== 'idle' && (
              <span className={`save-msg ${save.state}`}>{save.msg}</span>
            )}
            <button
              className="toggle primary"
              onClick={applyModel}
              disabled={save.state === 'saving' || blocked}
              title={blocked ? blockMsg : 'Save → rebuild DB (Ctrl/⌘+S)'}
            >
              {save.state === 'saving' ? 'Saving…' : 'Save → rebuild DB'}
            </button>
            <ConfigsMenu source={source} files={files} appName={appName} onLoad={loadConfig} />
            {/* secondary actions live in one standard dropdown so the toolbar
                stays uncluttered (and doesn't wrap on mobile). */}
            <HeaderMenu label="Menu">
              <button className="toggle" onClick={toggleEditor}>
                {editorOpen ? 'Hide source' : 'Show source'}
              </button>
              <button className="toggle" onClick={() => setShowData((s) => !s)}>
                {showData ? 'Hide data model' : 'Data model'}
              </button>
              <ImportFiles onImport={importFiles} />
              <button className="toggle" onClick={() => setShowDb(true)} title="Manage deployments — rename, download, delete">📦 Manage Deployments</button>
              <button className="toggle" onClick={() => setShowUsers(true)} title="User management (Authentik)">👤 Users</button>
              <button className="toggle" onClick={resetToFile} title="Discard the saved document and reload app.fmd">↺ Reset to file</button>
            </HeaderMenu>
          </div>
        </header>

        <div className="workspace" ref={workspaceRef}>
          {editorOpen ? (
            <div className="editor-pane" style={previewOpen ? { flex: `0 0 ${split * 100}%` } : { flex: 1 }}>
              <div className="pane-label">
                <span>{files[active]?.name || 'app.fmd'}{warnings.length > 0 && <span className="issue-count">{warnings.length} issue{warnings.length > 1 ? 's' : ''}</span>}</span>
                <span className="pane-label-btns">
                  <button className={`pane-ai${showAi ? ' active' : ''}`} onClick={() => setShowAi((s) => !s)} title="AI assistant">✨ AI</button>
                  <button className="pane-collapse" onClick={toggleEditor} title="Collapse source">⟨</button>
                </span>
              </div>
              <div className="editor-body">
                <AiChat open={showAi} onClose={() => setShowAi(false)} source={filesToMarkedDoc(files)} onApply={applyAi} />
                {apiBlocks.length > 0 && (
                  <div className="api-setup-bar">
                    {apiBlocks.map((b) => (
                      <button key={b.line} className="toggle api-setup-btn" title={`Connect the “${b.name}” external API — AI sets up the parsing`} onClick={() => setApiSetup({ name: b.name })}>
                        ⚙ Connect {b.name} API
                      </button>
                    ))}
                  </div>
                )}
                <div className="editor-split">
                  <FileTray
                    files={files} active={active}
                    collapsed={!trayOpen} onToggle={toggleTray}
                    onSelect={setActiveFile} onAdd={addFile}
                    onRename={renameFile} onDelete={deleteFile} onMove={moveFile}
                    onReorder={reorderFile} onUpload={uploadFiles}
                  />
                  <CodeEditor source={activeContent} setSource={setActiveContent} issues={editorView.localIssues} warnings={editorView.localWarnings} onFix={applyFix} onAiFix={aiFix} aiFixing={aiFixing} />
                </div>
              </div>
            </div>
          ) : (
            <button className="pane-rail" onClick={toggleEditor} title="Show source"><span>Source</span></button>
          )}

          {editorOpen && previewOpen && (
            <div className="splitter" onMouseDown={startSplitDrag} title="Drag to resize" />
          )}

          {previewOpen ? (
          <div className="preview-pane" style={{ flex: 1 }}>
            <div className="pane-label">
              <button className="pane-collapse" onClick={togglePreview} title="Collapse preview">⟩</button>
              <span>preview — [Display] {activeName && `· ${activeName}`}</span>
            </div>
            <div className="preview-scroll" style={style.vars as React.CSSProperties}>
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
          </div>
          ) : (
            <button className="pane-rail right" onClick={togglePreview} title="Show preview"><span>Preview</span></button>
          )}
        </div>

        {showData && <DataInspector schema={schema} store={store || {}} />}
      </div>
      {showDb && <ManageDeployments onClose={() => setShowDb(false)} />}
      {showUsers && <UserManagement roles={appRoles} onClose={() => setShowUsers(false)} />}
      {apiSetup && (
        <ApiSetup
          source={apiSetup.name.trim().toLowerCase() || 'api'}
          name={apiSetup.name}
          initial={parseApiBlock(activeContent, apiSetup.name)}
          onApply={(lines) => setActiveContent(spliceApiBlock(activeContent, apiSetup.name, lines))}
          onClose={() => setApiSetup(null)}
        />
      )}
      </CaseNavContext.Provider>
      </FormsListContext.Provider>
      </FormsContext.Provider>
      </ActionsContext.Provider>
      </UserMgmtContext.Provider>
      </RolesContext.Provider>
      </RulesContext.Provider>
     </SchemaContext.Provider>
    </DataContext.Provider>
  )
}
