// Read/write arbitrary app config stored in Postgres (the `configs` table),
// via /api/_config. Values are any JSON (the FMD document, UI prefs, etc.).

export async function getConfig(key) {
  try {
    const r = await fetch(`/api/_config/${encodeURIComponent(key)}`)
    if (!r.ok) return null
    return (await r.json())?.value ?? null
  } catch {
    return null
  }
}

export async function setConfig(key, value) {
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

export async function deleteConfig(key) {
  try {
    await fetch(`/api/_config/${encodeURIComponent(key)}`, { method: 'DELETE' })
  } catch {
    /* ignore */
  }
}
