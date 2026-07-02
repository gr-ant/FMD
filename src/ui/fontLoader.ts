import { useEffect } from 'react'

// Lazily inject a Google Fonts <link> for a [Font] choice (e.g. "Inter:wght@400;700").
// Idempotent — one <link> per family, reused across the editor preview and the
// deployed app. System fonts pass `null` and load nothing. A miss/offline simply
// falls back to the font stack's sans-serif, so it's always safe.
export function useGoogleFont(google: string | null): void {
  useEffect(() => {
    if (!google) return
    const id = 'fmd-font-' + google.replace(/[^a-z0-9]/gi, '')
    if (document.getElementById(id)) return
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${google}&display=swap`
    document.head.appendChild(link)
  }, [google])
}
