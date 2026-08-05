// Paper Scrubber service worker — makes the app shell work offline.
// (Model files are cached separately by transformers.js in the browser's Cache API.)
const CACHE = 'paper-scrubber-v14';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './labels.js',
  './sample.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/transformers.min.js',
  './vendor/jszip.min.js',
  './vendor/ort-wasm-simd-threaded.asyncify.mjs',
  './vendor/ort-wasm-simd-threaded.asyncify.wasm',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // let HF model fetches pass through
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) {   // never cache failures — a cached 404 would outlive the fix for it
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    })),
  );
});
