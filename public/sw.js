// Bump this string whenever you want to force-evict old caches on next deploy.
// The activate handler deletes every cache whose name is not CACHE.
const CACHE = 'thelight-v3'

// Precache the offline fallback page so it's available without a network hit.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.add('/offline.html'))
  )
  self.skipWaiting()
})

// On activate: delete stale caches from previous SW versions, then claim clients.
self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  )
)

// External domains that must always go straight to the network.
const PASS_THROUGH = [
  'firebaseio.com',
  'googleapis.com',
  'google.com',
  'gstatic.com',
  'cloudfunctions.net',
  'firebaseapp.com',
]

self.addEventListener('fetch', e => {
  const { request } = e
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // External APIs — never intercept.
  if (PASS_THROUGH.some(h => url.hostname.endsWith(h))) return

  // ── Navigation requests (HTML) — network-first ────────────────────────────
  // Always fetch a fresh HTML shell from the network so users load the latest
  // JS fingerprints after every deployment. Fall back to cached shell only
  // when the device is genuinely offline.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone()
            caches.open(CACHE).then(c => c.put(request, clone))
          }
          return response
        })
        .catch(() => caches.match('/offline.html'))
    )
    return
  }

  // ── Same-origin assets — cache-first ─────────────────────────────────────
  // Vite fingerprints every asset filename, so a cached file is always correct
  // for its URL. New deployments get new URLs; old entries are harmless.
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached

      return fetch(request).then(response => {
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone()
          caches.open(CACHE).then(c => c.put(request, clone))
        }
        return response
      }).catch(() => undefined)
    })
  )
})
