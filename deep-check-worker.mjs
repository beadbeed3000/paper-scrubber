// IEP deep check — runs in its own worker so a minutes-long document scan
// never freezes the page. Zero-shot GLiNER (fp16 — the quantized build tested
// at ~15% recall and must never ship) tags contextual identifiers the main
// model has no labels for: diagnoses, family members, churches, employers,
// benefits. Everything is fetched from this site's own address; the model
// arrives as seven <100 MB slices (GitHub's file cap) and is reassembled here.
//
// Wrapper facts learned by experiment, do not relearn: labels must be short
// noun phrases; multi-text batches silently return []; score collapses with
// input length — so this worker is fed one sentence at a time. Packing short
// sentences into one call was measured in September 2026 (400- and 150-char
// packs of consecutive pieces): 1.6-3.3x faster, but names, clinics and family
// members dropped out of the answer-keyed test records ("Journey", "Mountain
// Laurel ENT", "his uncle"). Do not pack.

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
  // "the 8th grader who's really into bodybuilding and cars" identifies a kid
  // in a small school — interests are quasi-identifiers. Probed on a real
  // (fictional) IEP: hunting 0.67, body building 0.82, automobile service 0.85.
  'hobby or personal interest', 'sport', 'career interest',
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
      // When the page is cross-origin isolated, ONNX Runtime runs this on
      // several threads. vendor/gliner-bundle.mjs is patched for that (search
      // it for "ort-wasm-simd-threaded.mjs"): its loader ignored wasmPaths and
      // started its thread workers from the bundle itself, which cannot start
      // as one; they now start from vendor/gliner-ort/. Re-apply the patch if
      // the bundle is ever rebuilt.
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

// pieces with fewer than three letters ("3.", "a)", a stray bullet) cannot
// name anyone, and a piece seen before (form labels, repeated headings, the
// same boilerplate across a batch) gets the answer it got last time — the
// model is deterministic, so asking again only costs time
const MIN_LETTERS = 3;
const MEMO_MAX = 5000;
const memo = new Map();   // piece text -> spans relative to the piece

async function inferPiece(g, text) {
  let spans = memo.get(text);
  if (!spans) {
    const res = await g.inference({ texts: [text], entities: LABELS, threshold: THRESHOLD, flatNer: true });
    spans = res[0].map((s) => ({ label: s.label, text: s.spanText, start: s.start, end: s.end, score: s.score }));
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
    memo.set(text, spans);
  }
  return spans;
}

self.onmessage = async (e) => {
  const { id, text } = e.data;
  try {
    const g = await getGliner();
    const pieces = splitSentences(text).filter((p) => (p.text.match(/\p{L}/gu)?.length ?? 0) >= MIN_LETTERS);
    const spans = [];
    for (let i = 0; i < pieces.length; i++) {
      if (i % 5 === 0) postMessage({ kind: 'progress', label: `Deep check — part ${i + 1} of ${pieces.length}`, pct: (i / pieces.length) * 100 });
      for (const s of await inferPiece(g, pieces[i].text)) {
        spans.push({ ...s, start: pieces[i].start + s.start, end: pieces[i].start + s.end });
      }
    }
    postMessage({ kind: 'result', id, spans });
  } catch (err) {
    postMessage({ kind: 'error', id, message: err.message });
  }
};
