// Paper Scrubber service worker — makes the app shell work offline.
// (Model files are cached separately by transformers.js in the browser's Cache API.)
const CACHE = 'paper-scrubber-v55';
// Model weights live in their own cache that version cleanup never touches —
// otherwise every deploy threw away the De-Identifier's 553 MB deep model and
// the 64 MB scrubber, and every laptop re-downloaded them. Bump THIS name only
// if a model file is ever replaced at the same path (new models get new paths).
const MODEL_CACHE = 'kvec-models-v1';
const isModelPath = (pathname) => pathname.includes('/models/');
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
    caches.open(CACHE).then((c) => c.addAll(ASSETS)),
    precacheModels(),
  ]).then(() => self.skipWaiting()));
});

// Laptops that downloaded models under the old scheme have them inside a
// versioned paper-scrubber-* cache. Move those entries into MODEL_CACHE before
// the purge, so this upgrade is the last one that could have cost 553 MB.
async function rescueModels(oldKey) {
  const oldCache = await caches.open(oldKey);
  const mc = await caches.open(MODEL_CACHE);
  for (const req of await oldCache.keys()) {
    if (!isModelPath(new URL(req.url).pathname)) continue;
    if (await mc.match(req)) continue;
    const res = await oldCache.match(req);
    if (res) await mc.put(req, res);
  }
}

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      // only purge our own old versions — transformers.js's 'transformers-cache'
      // and the model store above must survive app updates
      .then((keys) => {
        const old = keys.filter((k) => k.startsWith('paper-scrubber-') && k !== CACHE);
        return Promise.all(old.map((k) => rescueModels(k).catch(() => {})))
          .then(() => Promise.all(old.map((k) => caches.delete(k))));
      })
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
        caches.open(isModelPath(url.pathname) ? MODEL_CACHE : CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    })),
  );
});
