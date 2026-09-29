// Paper Scrubber service worker — makes the app shell work offline.
// (Model files are cached separately by transformers.js in the browser's Cache API.)
const CACHE = 'paper-scrubber-v75';
// Model weights live in their own cache that version cleanup never touches —
// otherwise every deploy threw away the De-Identifier's 386 MB deep model and
// the 64 MB scrubber, and every laptop re-downloaded them. Bump THIS name only
// if a model file is ever replaced at the same path (new models get new paths).
const MODEL_CACHE = 'kvec-models-v1';
const isModelPath = (pathname) => pathname.includes('/models/');
// The deep check's own ONNX Runtime (vendor/gliner-ort/, 11 MB) is kept with
// the models for the same reason: in the versioned cache, every deploy wiped
// it and an offline laptop could not deep-check until it had been online
// again. It is never re-fetched, so a newer runtime goes in a new folder
// (deep-check-worker.mjs's wasmPaths), never over this one.
const isDurablePath = (pathname) => isModelPath(pathname) || pathname.includes('/vendor/gliner-ort/');
// Model folders the app no longer loads. Their files are deleted from the
// model caches when a new version takes over, so a laptop gets the space back
// instead of carrying a dead model for good. The trailing slash matters: it
// keeps the old deep model's folder from matching the "-latin/" one.
const RETIRED_MODELS = [
  '/models/onnx-community/gliner_multi_pii-v1/',   // 553 MB, replaced in v74
];
const isRetired = (pathname) => RETIRED_MODELS.some((p) => pathname.includes(p));
// The files that carry behaviour are small — the page, the styles, the code.
// Those are fetched fresh when the network can answer quickly, so a deploy
// reaches a teacher on her next load. Everything heavy (AI runtimes, models,
// icons) stays cache-first and is never re-downloaded. vendor/ is excluded on
// purpose: those are megabytes of runtime that never change without a rename.
const isShell = (pathname) => !pathname.includes('/vendor/') && !isModelPath(pathname)
  && (/\.(?:html|js|mjs|css)$/.test(pathname) || pathname.endsWith('/'));
const ASSETS = [
  './',
  './index.html',
  './privacy.html',
  './styles.css',
  './app.js',
  './labels.js',
  './sample.js',
  './manifest.webmanifest',
  './icons/favicon.svg',
  './icons/kvec-logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './vendor/transformers.min.js',
  './vendor/jszip.min.js',
  './vendor/ort-wasm-simd-threaded.asyncify.mjs',
  './vendor/ort-wasm-simd-threaded.asyncify.wasm',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './vendor/tesseract.esm.min.js',
  './vendor/tesseract-worker.min.js',
  './vendor/tesseract-core-simd-lstm.wasm.js',
  './vendor/eng.traineddata.gz',
  // deep-check shell (small). The 553 MB of model parts are NOT precached —
  // they land in MODEL_CACHE at first deep-check use, via the fetch handler.
  './deep-check-worker.mjs',
  './vendor/gliner-bundle.mjs',
  // the De-Identifier's front door (shares every other asset with the scrubber)
  './deid/',
  './deid/index.html',
  './deid/handout.html',
  './manifest-deid.webmanifest',
  './icons/deid-favicon.svg',
  './icons/deid-192.png',
  './icons/deid-512.png',
];

// the scrubber model still precaches (one visit on Wi-Fi = road-ready), but
// into the durable cache, and only the files it doesn't already hold
const MODEL_ASSETS = [
  './models/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX/config.json',
  './models/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX/tokenizer.json',
  './models/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX/tokenizer_config.json',
  './models/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX/special_tokens_map.json',
  './models/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX/onnx/model_quantized.onnx',
  // The deep check's threaded runtime glue (24 KB). Only a multi-threaded
  // session imports it (isolated page, 3+ cores), so a laptop whose deep checks
  // all ran single-threaded never had it: the trust chip never turned green,
  // and the first isolated session offline would fail. The 11 MB .wasm beside
  // it is NOT precached (Paper Scrubber shares this list); it lands in
  // MODEL_CACHE at the first deep check.
  './vendor/gliner-ort/ort-wasm-simd-threaded.mjs',
];

async function precacheModels() {
  const mc = await caches.open(MODEL_CACHE);
  for (const u of MODEL_ASSETS) {
    if (await mc.match(u)) continue;
    const res = await fetch(u);
    if (!res.ok) throw new Error(`model precache failed: ${u} → ${res.status}`);
    await mc.put(u, res);
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))),
    precacheModels(),
  ]).then(() => self.skipWaiting()));
});

// Laptops that downloaded models (or, before v66, the deep check's runtime)
// under the old scheme have them inside a versioned paper-scrubber-* cache.
// Move those entries into MODEL_CACHE before the purge, so this upgrade is the
// last one that could have cost 553 MB or left the deep check offline-broken.
async function rescueModels(oldKey) {
  const oldCache = await caches.open(oldKey);
  const mc = await caches.open(MODEL_CACHE);
  for (const req of await oldCache.keys()) {
    const { pathname } = new URL(req.url);
    if (!isDurablePath(pathname) || isRetired(pathname)) continue;
    if (await mc.match(req)) continue;
    const res = await oldCache.match(req);
    if (res) await mc.put(req, res);
  }
}

async function dropRetiredModels() {
  for (const key of [MODEL_CACHE, 'transformers-cache']) {
    if (!(await caches.has(key))) continue;
    const c = await caches.open(key);
    for (const req of await c.keys()) {
      if (isRetired(new URL(req.url).pathname)) await c.delete(req);
    }
  }
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // only purge our own old versions — transformers.js's 'transformers-cache'
      // and the model store above must survive app updates, apart from the
      // retired model folders listed at the top
      .then((keys) => {
        const old = keys.filter((k) => k.startsWith('paper-scrubber-') && k !== CACHE);
        return Promise.all(old.map((k) => rescueModels(k).catch(() => {})))
          .then(() => Promise.all(old.map((k) => caches.delete(k))));
      })
      .then(() => dropRetiredModels().catch(() => {}))
      .then(() => self.clients.claim()),
  );
});

// Give the network a moment, then stop waiting. Airplane mode fails instantly
// and falls through to the cache; a hung school connection is cut off at three
// seconds so the tool opens anyway.
const raced = (p, ms) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error('slow network')), ms)),
]);

async function freshFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await raced(fetch(req, { cache: 'no-store' }), 3000);
    if (res && res.ok) { cache.put(req, res.clone()); return res; }
  } catch { /* offline, or slower than a teacher should have to wait */ }
  return (await cache.match(req)) || fetch(req);
}

async function cacheFirst(req, durable) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {   // never cache failures — a cached 404 would outlive the fix for it
    const copy = res.clone();
    caches.open(durable ? MODEL_CACHE : CACHE).then((c) => c.put(req, copy));
  }
  return res;
}

// Cross-origin isolation for the De-Identifier. GitHub Pages cannot send
// headers, so this worker adds them to what it serves; with them the deep
// check's AI runtime may use several CPU cores (WebAssembly threads need
// SharedArrayBuffer). Every file the tool loads is its own, so require-corp
// blocks nothing. Scripts and workers carry the headers too, because an
// isolated page refuses a worker whose script lacks them. Paper Scrubber's page
// is left as it was: it has no deep check to speed up.
// This takes effect on the next load after the worker takes over. The page is
// never reloaded for it, so papers that are open are never lost.
const ISOLATED_PAGE = /\/deid\/(?:index\.html)?$/;
function isolate(req, res) {
  if (!res || res.status === 0 || res.type === 'opaque' || res.type === 'opaqueredirect') return res;
  if (req.mode === 'navigate' && !ISOLATED_PAGE.test(new URL(req.url).pathname)) return res;
  const headers = new Headers(res.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // let HF model fetches pass through
  e.respondWith((isShell(url.pathname)
    ? freshFirst(e.request)
    : cacheFirst(e.request, isDurablePath(url.pathname))).then((res) => isolate(e.request, res)));
});
