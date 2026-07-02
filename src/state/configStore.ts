// Read/write arbitrary app config stored in Postgres (the `configs` table),
// via /api/_config. Values are any JSON (the FMD document, UI prefs, etc.).

export async function getConfig(key: string): Promise<unknown> {
  try {
    const r = await fetch(`/api/_config/${encodeURIComponent(key)}`)
    if (!r.ok) return null
    const body = (await r.json()) as { value?: unknown }
    return body?.value ?? null
  } catch {
    return null
  }
}

export async function setConfig(key: string, value: unknown): Promise<void> {
  try {
    await fetch(`/api/_config/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    })
  } catch {
    /* offline / no API — ignore */
  }
}

export async function deleteConfig(key: string): Promise<void> {
  try {
    await fetch(`/api/_config/${encodeURIComponent(key)}`, { method: 'DELETE' })
  } catch {
    /* ignore */
  }
}

// ---- saved configs (a named library of past FMD documents) ----------------
// Stored in the same KV table under `saved:<name>` keys, so listing is just a
// prefix filter over /api/_config — no server changes needed.

import type { FmdFile } from './files'

export interface SavedConfig {
  name: string
  doc: string
  appName: string
  savedAt: string // ISO timestamp
  files?: FmdFile[] // the tray split (optional; absent = single-file legacy config)
}

const SAVED_PREFIX = 'saved:'

// All saved configs, newest first.
export async function listSavedConfigs(): Promise<SavedConfig[]> {
  try {
    const r = await fetch('/api/_config')
    if (!r.ok) return []
    const all = (await r.json()) as Record<string, unknown>
    return Object.entries(all)
      .filter(([k]) => k.startsWith(SAVED_PREFIX))
      .map(([, v]) => v as SavedConfig)
      .filter((v) => v && typeof v.name === 'string' && typeof v.doc === 'string')
      .sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  } catch {
    return []
  }
}

// Save (or overwrite) the current document under a name, preserving the tray
// split (files) so it round-trips on load.
export async function saveConfigAs(name: string, doc: string, appName: string, files?: FmdFile[]): Promise<void> {
  const entry: SavedConfig = { name, doc, appName, savedAt: new Date().toISOString(), ...(files ? { files } : {}) }
  await setConfig(SAVED_PREFIX + name, entry)
}

export async function deleteSavedConfig(name: string): Promise<void> {
  await deleteConfig(SAVED_PREFIX + name)
}
