// SchoolOS Service Worker
// Served as a real same-origin file (required — browsers reject blob: URLs
// for navigator.serviceWorker.register()). Deploy this alongside index.html
// at the site root so it is reachable at /sw.js.

// CACHE_NAME MUST be bumped on every deploy that changes index.html.
// 'cacheFirst' below serves whatever is already in this cache WITHOUT ever
// checking the network if a match exists — so if this string stays the same
// across deploys, returning users keep getting the OLD index.html forever,
// no matter how many times the server-side file is updated. Only a changed
// CACHE_NAME causes 'activate' to delete the old cache (see below) and the
// next fetch to fall through to the network and store the new file.
//
// v2 bump: evicted the cached index.html from before window.router was
// added to the module→window bridge — that pre-fix HTML was cache-first
// served indefinitely regardless of new deploys, which is why the router
// ReferenceError persisted after the source fix was already live on Netlify.
//
// v2.1: evicts the cached index.html from before the `store is not
// defined` fix in the PWA install/offline-banner script (that script is a
// classic <script>, not a module, so it ran synchronously before
// `window.store` existed — same root cause as the v2 router bug, different
// line). Without this bump, returning users keep the pre-fix HTML serving
// from cache-first navigation and the crash will appear to "come back" even
// though the source on Netlify is already correct.
//
// v2.2: evicts the cached index.html from before the mobile nav fix —
// buildBottomNav() previously hard-sliced to the first 5 role items with no
// way to reach the rest (e.g. Exam Schedule / Announcements for teacher &
// student roles) short of switching to desktop view. Added a hamburger +
// bottom-nav "More" entry that open the sidebar drawer, which always lists
// the full, unsliced item set. Navigations already go network-first (see
// below), so this bump isn't required for the new HTML to load, but it
// forces the offline-fallback cache to refresh too and triggers the
// "update available" banner for anyone with the PWA open.
//
// v2.4 (this bump): adds FIREBASE_SDK_URLS below to the same cache-first
// treatment as same-origin static assets (see rule 2b in the fetch handler).
// Previously every cross-origin request — including the Firebase SDK's own
// ES modules — was explicitly passed straight through to the network with
// no caching at all (see the old rule 4 comment). That's fine for a fast,
// reliable connection, but on Ethiopian mobile data a request to
// www.gstatic.com can hang indefinitely with no error, and index.html has
// no way to recover from that (see index.html's loadFirebaseSdk() for the
// timeout/retry that handles the FIRST load). This bump makes every load
// AFTER the first successful one immune to that entirely: once cached, the
// SDK is served instantly from this cache and gstatic.com is never touched
// again, online or offline. Bumping CACHE_NAME also means existing installs
// pick up this new caching rule instead of running forever on the old SW
// that never intercepted these requests.
//
// v2.5 (this bump): networkFirst() used to await fetch() with no timeout.
// Fully offline, that's fine — fetch() rejects almost instantly and we
// fall back to cache. But on a slow/degraded connection (e.g. Ethiopian
// mobile data without a VPN), the browser will happily wait tens of
// seconds — or longer — for a response that may never come, and both
// navigations (rule 3a) and Firebase API calls (rule 2a) go through
// networkFirst(). That hang IS the whole app: blank screen, no error,
// nothing the user can do but wait or force-quit. That's exactly the
// "works offline, hangs when online-but-slow" symptom. Fix: race the
// fetch against NETWORK_TIMEOUT_MS and fall back to cache if the network
// hasn't answered in time. The real fetch keeps running in the
// background and still updates the cache if/when it completes, so this
// only changes behavior when the connection is too slow to be usable
// anyway.
const CACHE_NAME = 'schoolos-v2.5';

// How long networkFirst() waits for the network before falling back to
// cache. Generous enough for a normal round-trip, short enough that a
// stalled connection doesn't read as a hang. The fallback cache read
// itself is effectively instant, so tune this down if 5s still feels
// slow in the field.
const NETWORK_TIMEOUT_MS = 5000;

// Firebase JS SDK — version-pinned CDN URLs (the version number is in the
// path), so whatever loaded successfully once is valid forever for that
// version. Precached on install so even a very early visit (before the user
// has actually signed in and triggered a Firestore call) picks these up;
// also cache-first at runtime (see rule 2b) so the very first successful
// load — from any client, any time — locks these in for every load after.
const FIREBASE_SDK_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js',
];

// The single HTML file we want available offline, plus the Firebase SDK
// (see FIREBASE_SDK_URLS above).
const PRECACHE_URLS = ['/', ...FIREBASE_SDK_URLS];

// Firebase API hostnames that always need a live network response (actual
// Firestore/Auth data calls — distinct from the SDK *code* above, which is
// static and safe to cache).
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

  // 2a. Firebase API calls (actual data) — network-first, cache fallback.
  if (FIREBASE_HOSTS.some((host) => url.hostname.includes(host))) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 2b. Firebase SDK CDN files (the code itself, not data) — cache-first.
  //     Version-pinned URL, so once cached it's valid forever; this is what
  //     stops a hung/blocked route to gstatic.com from freezing the whole
  //     app on every load after the first (see index.html's loadFirebaseSdk
  //     for how the first load itself is made resilient with a timeout).
  if (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 3a. HTML navigations — the single index.html IS the entire app, so a
  //     stale cached copy means a stale app (this is exactly what caused the
  //     router ReferenceError to persist across deploys: cache-first served
  //     the pre-fix HTML indefinitely, never re-checking the network).
  //     Network-first here means returning users always get the latest
  //     deploy when online, and still get something usable when offline.
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirst(request));
    return;
  }

  // 3b. Other same-origin requests (icons, manifest, fonts) — cache-first is
  //     fine here: these are fingerprint-cacheable static assets, not the
  //     app shell itself.
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

// ── Strategy: network-first, with a timeout fallback to cache ─────────
// Try the network so a working connection always gets the freshest
// deploy. If it hasn't answered within NETWORK_TIMEOUT_MS, stop waiting
// and serve whatever's cached instead — the network request is left
// running in the background and still populates the cache if/when it
// eventually finishes, so THIS load doesn't wait for it but the NEXT one
// benefits.
async function networkFirst(request) {
  const networkPromise = fetch(request).then((networkResponse) => {
    if (networkResponse && networkResponse.status === 200) {
      caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse.clone()));
    }
    return networkResponse;
  });
  // Defensively mark this handled now so a rejection that surfaces after
  // we've stopped waiting on it (timeout case, below) never shows up as
  // an unhandled promise rejection in the console.
  networkPromise.catch(() => {});

  const TIMED_OUT = Symbol('timeout');
  const result = await Promise.race([
    networkPromise.catch(() => TIMED_OUT), // a real network error also falls back to cache
    new Promise((resolve) => setTimeout(() => resolve(TIMED_OUT), NETWORK_TIMEOUT_MS)),
  ]);

  if (result !== TIMED_OUT) return result; // network answered in time

  const cached = await caches.match(request);
  if (cached) return cached;

  // Nothing cached (e.g. the very first visit, on a bad connection) —
  // this is the one case left where we have to wait the network out.
  try {
    return await networkPromise;
  } catch (_) {
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
