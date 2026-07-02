import React, { useEffect, useState } from 'react'
import { listSavedConfigs, saveConfigAs, deleteSavedConfig, type SavedConfig } from '../../state/configStore'
import type { FmdFile } from '../../state/files'
import { parseFMD, collectSchema, collectWarnings, collectTriggers, collectRules, collectAutoNumbers } from '../../parser'
import { useDialogs } from '../dialogs'

// Build the /api/_deploy entities payload from a config's document — same shape
// the editor sends to /api/_apply. The reserved `users` source is Authentik-
// backed, never a Postgres table, so it's excluded.
function entitiesFromDoc(doc: string): Array<{ source: string; name: string; fields: unknown; kind: string }> {
  const schema = collectSchema(parseFMD(doc))
  return Object.entries(schema).filter(([source]) => source !== 'users').map(([source, def]) => ({ source, name: def.name, fields: def.fields, kind: def.kind }))
}

// The permission model ({ source: { roleLower: verbs[] } }) from a config's
// [Permission] blocks — sent with the deploy so the app's /api/_app/* routes
// enforce it (mirrors what App.tsx sends to /api/_apply).
function permissionsFromDoc(doc: string): Record<string, Record<string, string[]>> {
  const schema = collectSchema(parseFMD(doc))
  const out: Record<string, Record<string, string[]>> = {}
  for (const [src, def] of Object.entries(schema)) {
    if (def.permissions) {
      out[src] = {}
      for (const [roleLc, p] of Object.entries(def.permissions)) out[src][roleLc] = p.verbs
    }
  }
  return out
}

// A config's first blocking error (if any), so deploy can refuse it.
function blockingError(doc: string): string | null {
  const tree = parseFMD(doc)
  const w = collectWarnings(tree, collectSchema(tree)).find((x) => x.block)
  return w ? w.message : null
}

// Header popover for the saved-configs library: save the current document under
// a name, then load or delete any past one. Loading hands the document back to
// the editor via onLoad.
export default function ConfigsMenu({
  source, files, appName, onLoad,
}: {
  source: string
  files: FmdFile[]
  appName: string
  onLoad: (doc: string, name: string, files?: FmdFile[]) => void
}): React.ReactNode {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SavedConfig[]>([])
  const [busy, setBusy] = useState(false)
  const dialogs = useDialogs()

  const refresh = () => listSavedConfigs().then(setItems)
  useEffect(() => { if (open) refresh() }, [open])

  const saveAs = async () => {
    const raw = await dialogs.prompt({ title: 'Save app', message: 'Name this app:', defaultValue: appName || 'My App', confirmLabel: 'Save' })
    const name = raw?.trim()
    if (!name) return
    if (items.some((it) => it.name === name) &&
        !(await dialogs.confirm({ message: `Overwrite saved app “${name}”?`, confirmLabel: 'Overwrite' }))) return
    setBusy(true)
    await saveConfigAs(name, source, appName, files)
    await refresh()
    setBusy(false)
    dialogs.toast(`Saved “${name}”`, { kind: 'success' })
  }

  const del = async (it: SavedConfig) => {
    if (!(await dialogs.confirm({ message: `Delete saved app “${it.name}”?`, confirmLabel: 'Delete', danger: true }))) return
    await deleteSavedConfig(it.name)
    refresh()
  }

  // Deploy a saved config: provision its isolated schema + serve it at /app/<slug>.
  const deploy = async (it: SavedConfig) => {
    const block = blockingError(it.doc)
    if (block) { dialogs.toast(`Can't deploy “${it.name}”: ${block}`, { kind: 'error' }); return }
    setBusy(true)
    try {
      const deployTree = parseFMD(it.doc)
      const r = await fetch('/api/_deploy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: it.name, name: it.appName || it.name, doc: it.doc,
          entities: entitiesFromDoc(it.doc),
          permissions: permissionsFromDoc(it.doc),
          triggers: collectTriggers(deployTree), rules: collectRules(deployTree),
          autonumbers: collectAutoNumbers(collectSchema(deployTree)),
        }),
      })
      const data = await r.json()
      if (data?.ok && data.url) {
        dialogs.toast(`Deployed “${it.name}”`, { kind: 'success', link: { label: 'Open ↗', href: data.url } })
      } else {
        dialogs.toast(`Deploy failed: ${data?.error || 'unknown error'}`, { kind: 'error' })
      }
    } catch (e) {
      dialogs.toast(`Deploy failed: ${String(e)}`, { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="configs-menu">
      <button className="toggle" onClick={() => setOpen((o) => !o)} title="Saved apps">
        Configs ▾
      </button>
      {open && (
        <>
          <div className="configs-backdrop" onClick={() => setOpen(false)} />
          <div className="configs-pop">
            <button className="configs-save" onClick={saveAs} disabled={busy}>
              ＋ Save current as…
            </button>
            <div className="configs-list">
              {items.length === 0 && <div className="configs-empty">No saved apps yet</div>}
              {items.map((it) => (
                <div className="configs-item" key={it.name}>
                  <button
                    className="configs-load"
                    onClick={() => { onLoad(it.doc, it.name, it.files); setOpen(false) }}
                    title={`Load — saved ${new Date(it.savedAt).toLocaleString()}`}
                  >
                    <span className="configs-name">{it.name}</span>
                    <span className="configs-date">{new Date(it.savedAt).toLocaleDateString()}</span>
                  </button>
                  <button className="configs-deploy" title="Deploy to its own URL + database area" disabled={busy} onClick={() => deploy(it)}>🚀</button>
                  <button className="configs-del" title="Delete" onClick={() => del(it)}>×</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
