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

const CACHE_NAME = 'uae-sign-language-v8';
const APP_SHELL = [
  './',
  './index.html',
  './audience.html',
  './styles.css',
  './app.js',
  './modes.js',
  './vision.js',
  './conversation.js',
  './room.js',
  './webrtc.js',
  './speech.js',
  './feedback.js',
  './camera.js',
  './welcome.js',
  './quiz.js',
  './audience.js',
  './firebase-config.js',
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

  // NETWORK FIRST, cache as the fallback.
  //
  // This used to be the other way round (serve the saved copy instantly,
  // fetch a fresh one in the background for NEXT time). That's faster, but
  // it means every update needs two reloads before you see it -- and in
  // practice that repeatedly looked like "the upload didn't work" when the
  // upload was fine and the phone was just showing yesterday's copy. Before
  // a live demo, that's a genuinely bad way to lose twenty minutes.
  //
  // Now the phone always asks the network first, so what you see is what was
  // last uploaded. The saved copy is still kept and used whenever the
  // network fails, so the app still opens with no internet -- it just isn't
  // allowed to serve a stale page when a fresh one is available.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
