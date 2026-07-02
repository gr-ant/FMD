// Minimal, dev-safe service worker for the FMD PWA.
//  - API calls are never intercepted (always live data).
//  - Navigations are network-first, falling back to a cached shell offline.
//  - Built assets (/assets/, /icon-*) are cached for offline launch.
//  - Everything else (incl. Vite dev modules, HMR) passes straight through, so
//    it doesn't interfere with development.
const CACHE = 'fmd-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // third-party (fonts, API hosts)
  if (url.pathname.startsWith('/api/')) return     // live data only — never cache

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return r })
        .catch(() => caches.match('/')),
    )
    return
  }

  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icon-') || url.pathname === '/manifest.webmanifest') {
    e.respondWith(
      caches.match(req).then((cached) =>
        cached || fetch(req).then((r) => {
          if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
          return r
        }),
      ),
    )
  }
})
