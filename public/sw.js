const CACHE = 'thelight-v1'

// On install: skip waiting so the new SW activates immediately
self.addEventListener('install', () => self.skipWaiting())

// On activate: claim all clients
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

// Fetch strategy: cache-first for same-origin assets, network-only for Firebase/Google
self.addEventListener('fetch', e => {
  const { request } = e
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Let Firebase, Google APIs, and maps pass through network only
  const passThrough = [
    'firebaseio.com',
    'googleapis.com',
    'google.com',
    'firestore.googleapis.com',
    'identitytoolkit.googleapis.com',
    'securetoken.googleapis.com',
    'storage.googleapis.com',
    'maps.gstatic.com',
  ]
  if (passThrough.some(h => url.hostname.includes(h))) return

  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached

      return fetch(request).then(response => {
        // Cache successful same-origin GET responses
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone()
          caches.open(CACHE).then(c => c.put(request, clone))
        }
        return response
      }).catch(() => {
        // Offline fallback: return cached index.html for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/index.html')
        }
      })
    })
  )
})
