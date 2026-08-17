// IEP deep check — runs in its own worker so a minutes-long document scan
// never freezes the page. Zero-shot GLiNER (fp16 — the quantized build tested
// at ~15% recall and must never ship) tags contextual identifiers the main
// model has no labels for: diagnoses, family members, churches, employers,
// benefits. Everything is fetched from this site's own address; the model
// arrives as seven <100 MB slices (GitHub's file cap) and is reassembled here.
//
// Wrapper facts learned by experiment, do not relearn: labels must be short
// noun phrases; multi-text batches silently return []; score collapses with
// input length — so this worker is fed one sentence at a time.

import { Gliner, xenv } from './vendor/gliner-bundle.mjs';

const MODEL_DIR = new URL('models/onnx-community/gliner_multi_pii-v1/', self.location.href).href;
const PARTS = 7;

// tokenizer fetches go to our models/ folder, never to huggingface.co
xenv.allowLocalModels = false;
xenv.remoteHost = new URL('models/', self.location.href).href;
xenv.remotePathTemplate = '{model}/';

const LABELS = [
  'person', 'health condition', 'disability', 'medication', 'assistive device',
  'family relationship', 'religious group', 'company', 'sports team or club',
  'school', 'government benefit',
];
const THRESHOLD = 0.3;

let glinerPromise = null;

async function fetchModelBytes() {
  const buffers = [];
  let total = 0;
  for (let i = 0; i < PARTS; i++) {
    postMessage({ kind: 'progress', label: `Downloading the deep-check AI — part ${i + 1} of ${PARTS} (one time)`, pct: (i / PARTS) * 100 });
    const r = await fetch(`${MODEL_DIR}onnx/model_fp16.onnx.part${String(i).padStart(2, '0')}`);
    if (!r.ok) throw new Error(`deep-check model part ${i + 1} failed to download (${r.status})`);
    const buf = await r.arrayBuffer();
    buffers.push(buf);
    total += buf.byteLength;
  }
  const bytes = new Uint8Array(total);
  let off = 0;
  for (const b of buffers) { bytes.set(new Uint8Array(b), off); off += b.byteLength; }
  return bytes;
}

function getGliner() {
  glinerPromise ??= (async () => {
    const bytes = await fetchModelBytes();
    postMessage({ kind: 'progress', label: 'Loading the deep-check AI into memory…', pct: 100 });
    const g = new Gliner({
      tokenizerPath: 'onnx-community/gliner_multi_pii-v1',
      onnxSettings: {
        modelPath: bytes.buffer,
        executionProvider: 'wasm',
        wasmPaths: new URL('vendor/gliner-ort/', self.location.href).href,
      },
      transformersSettings: { allowLocalModels: false, useBrowserCache: true },
      maxWidth: 12,
    });
    await g.initialize();
    return g;
  })();
  glinerPromise.catch(() => { glinerPromise = null; });   // failed download/init can be retried
  return glinerPromise;
}

// sentences with their offsets in the full text, sized for the score-collapse
// quirk: one sentence per call, hard-split anything enormous
function splitSentences(text) {
  const out = [];
  const re = /[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let s = m[0], start = m.index;
    while (s.length > 400) {         // run-on lists in eval reports
      const cut = s.lastIndexOf(' ', 300) > 50 ? s.lastIndexOf(' ', 300) : 300;
      out.push({ text: s.slice(0, cut), start });
      start += cut;
      s = s.slice(cut);
    }
    if (s.trim().length > 1) out.push({ text: s, start });
  }
  return out;
}

self.onmessage = async (e) => {
  const { id, text } = e.data;
  try {
    const g = await getGliner();
    const sentences = splitSentences(text);
    const spans = [];
    for (let i = 0; i < sentences.length; i++) {
      if (i % 5 === 0) postMessage({ kind: 'progress', label: `Deep check — part ${i + 1} of ${sentences.length}`, pct: (i / sentences.length) * 100 });
      const res = await g.inference({ texts: [sentences[i].text], entities: LABELS, threshold: THRESHOLD, flatNer: true });
      for (const s of res[0]) {
        spans.push({ label: s.label, text: s.spanText, start: sentences[i].start + s.start, end: sentences[i].start + s.end, score: s.score });
      }
    }
    postMessage({ kind: 'result', id, spans });
  } catch (err) {
    postMessage({ kind: 'error', id, message: err.message });
  }
};
