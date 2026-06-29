// SchoolOS Service Worker
// Served as a real same-origin file (required — browsers reject blob: URLs
// for navigator.serviceWorker.register()). Deploy this alongside index.html
// at the site root so it is reachable at /sw.js.

const CACHE_NAME = 'schoolos-v1';

// The single HTML file we want available offline.
const PRECACHE_URLS = ['/'];

// Firebase API hostnames that always need a live network response.
const FIREBASE_HOSTS = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'firebase.googleapis.com',
  'www.googleapis.com',
];

// ── Install: pre-cache the app shell ─────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // cache.add() fetches and stores; ignore failures so a bad
      // network at install time doesn't block the SW from activating.
      return cache.addAll(PRECACHE_URLS).catch(() => {});
    })
  );
  // Take control of all clients immediately (skip waiting).
  self.skipWaiting();
});

// ── Activate: clean up stale caches from old SW versions ─────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => {
      // Claim all open clients so they use this SW without a page reload.
      return self.clients.claim();
    }).then(() => {
      // Notify all controlled pages that a new version is ready.
      // The main thread listens for {type:'UPDATE_AVAILABLE'} and shows
      // the "New version available — Refresh to update" banner.
      return self.clients.matchAll({ type: 'window' }).then((clientList) => {
        clientList.forEach((client) => {
          client.postMessage({ type: 'UPDATE_AVAILABLE' });
        });
      });
    })
  );
});

// ── Fetch: routing logic ──────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Non-GET requests — always pass through to the network.
  if (request.method !== 'GET') return;

  // 2. Firebase API calls — network-first, cache fallback.
  if (FIREBASE_HOSTS.some((host) => url.hostname.includes(host))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 3. Same-origin requests (the app HTML + relative assets) — cache-first.
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 4. All other cross-origin requests (CDN scripts, etc.) — network-only.
  // Do NOT intercept; let the browser handle them normally.
});

// ── Strategy: cache-first ─────────────────────────────────────────────
// Serve from cache immediately; if not cached, fetch from network and
// cache the response for next time.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_) {
    // Network failed and nothing in cache — return a minimal offline page.
    return new Response(
      '<html><body style="font-family:sans-serif;padding:2rem;text-align:center;">' +
      '<h2>SchoolOS</h2><p>You are offline. Please reconnect to continue.</p>' +
      '</body></html>',
      { headers: { 'Content-Type': 'text/html' } }
    );
  }
}

// ── Strategy: network-first ───────────────────────────────────────────
// Always try the network first. Fall back to cache if offline.
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    // Cache successful responses for offline fallback.
    if (networkResponse && networkResponse.status === 200) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Nothing available — let the error surface naturally.
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
