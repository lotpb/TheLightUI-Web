import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Apply saved theme before first render (prevents dark→light flash).
// Also flip the `color-scheme` CSS property, not just the `light-mode` class —
// without it, native form chrome (select dropdown popups, date pickers) keeps
// rendering with dark UA styling while our CSS gives them near-black text,
// making things like the customer list filter dropdowns unreadable.
if (localStorage.getItem('thelight.lightMode') === 'true') {
  document.documentElement.classList.add('light-mode')
  document.documentElement.style.colorScheme = 'light'
}

// Register service worker for PWA / offline support. Production only — its
// cache-first strategy assumes Vite's fingerprinted asset filenames, which
// isn't true for the dev server's stable /src/... module URLs, so it would
// otherwise serve stale JS indefinitely to anyone running `npm run dev`.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* non-critical */ })
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
