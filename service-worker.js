/**
 * service-worker.js
 * -----------------------------------------------------------------------
 * Minimal offline cache for the APP SHELL only (the HTML/CSS/JS/icons/
 * model files hosted alongside this app). It deliberately does NOT try
 * to cache the MediaPipe WASM runtime or the hand-landmark model from
 * Google's/jsDelivr's CDN -- those are cross-origin, versioned by
 * "@latest", and best left to the browser's normal HTTP cache. That
 * means: the very first load of this app on a phone needs internet
 * access, but the app shell itself (and any trained models you've
 * converted) will keep working offline after that first visit.
 */

const CACHE_NAME = 'uae-sign-language-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './modes.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {
      /* fine if a file is missing at install time (e.g. models not converted yet) */
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin GET requests -- let everything else (CDN,
  // camera stream, etc.) go straight to the network untouched.
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
