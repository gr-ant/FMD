import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import PublishedApp from './ui/PublishedApp'
import { DialogsProvider } from './ui/dialogs'
import { handleCallback } from './state/auth'
import './styles.css'

// Register the PWA service worker — only in a secure context (HTTPS, localhost,
// or a deployed app). Over plain http on a LAN IP, SWs are blocked, so we skip
// it silently (iOS "Add to Home Screen" still gives a standalone app via the
// manifest + apple meta tags).
{
  const host = window.location.hostname
  const localhost = host === 'localhost' || host === '127.0.0.1'
  if ('serviceWorker' in navigator && window.isSecureContext && !localhost && window.location.pathname !== '/auth/callback') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ })
    })
  }
}

// The OIDC redirect lands here: complete the token exchange, then go home.
if (window.location.pathname === '/auth/callback') {
  createRoot(document.getElementById('root')!).render(
    <div className="published-status">Signing in…</div>,
  )
  handleCallback()
} else {
  // /app/<slug> renders the deployed app (no editor); anything else is the editor.
  const deployed = window.location.pathname.match(/^\/app\/([^/]+)/)
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <DialogsProvider>
        {deployed ? <PublishedApp slug={decodeURIComponent(deployed[1])} /> : <App />}
      </DialogsProvider>
    </React.StrictMode>,
  )
}
