// Paper Scrubber v2 — on-device PII removal for student papers.
// All inference happens in the browser via transformers.js + ONNX Runtime WASM.
// .docx files are edited in place (only the text inside <w:t> nodes changes),
// so the scrubbed Word file keeps all original formatting.

import { pipeline, env } from './vendor/transformers.min.js';
import { TYPES, LABEL_TO_TYPE } from './labels.js';
import { SAMPLE, SAMPLE_DEID } from './sample.js';

// The model ships WITH the app (models/), so nothing is ever fetched from a
// third party — and one visit on Wi-Fi leaves a laptop fully road-ready for
// IEP reviews in buildings with no signal and districts that block huggingface.co.
// Done by pointing the library's ordinary "remote" loader at our own address
// (env.localModelPath in this build loses the tokenizer — the remote path is
// the one that has worked since day one, so reuse it aimed at ourselves).
env.allowLocalModels = false;
env.remoteHost = new URL('models/', document.baseURI).href;
env.remotePathTemplate = '{model}/';
// absolute URL so it resolves the same from the page and from inside the library
env.backends.onnx.wasm.wasmPaths = new URL('vendor/', document.baseURI).href;
// run inference in a worker so the page never freezes mid-scan — matters most
// on the low-end Chromebooks in classrooms
env.backends.onnx.wasm.proxy = true;

const MODEL = {
  id: 'onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX',
  dtype: 'q8', sizeMB: 64, label: 'English',
  // Characters, not tokens — so it must stay well under the model's 512-token
  // window even for dense text (digits and accents tokenize far worse than
  // prose). scanChunk re-splits anything that still comes back truncated.
  chunkChars: 900,
};
const MODEL_MAX_TOKENS = 512;

const SPECIAL_TOKENS = new Set(['[CLS]', '[SEP]', '[PAD]', '[MASK]', '[UNK]', '<s>', '</s>', '<pad>', '<unk>', '<mask>']);
const SCORE_THRESHOLD = 0.4;
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const SAFENAMES_KEY = 'paperScrubber.safeNames';
// Word (and Google Docs' export) stamp the author into the package itself.
// Scrubbing the visible text and leaving these behind hands the teacher a file
// she has been told is clean while the student's name rides along inside it.
const META_PARTS = /^(docProps\/|word\/people\.xml$)/;
const META_AUTHOR_ATTRS = /\s(?:w:author|w:initials|w:lastModifiedBy)="[^"]*"/g;

// Findings in these categories start KEPT (dotted underline, one click to
// scrub) rather than replaced. They're the "neighbor test" categories: a
// diagnosis or a grade level is often the whole point of the document — an AI
// can't help with an IEP it can't see — but in a small school those same
// details can identify a student on their own. The tool points; the teacher
// decides. Everything else still scrubs by default.
const DEFAULT_KEPT = new Set(['HEALTH', 'GRADE', 'FAMILY', 'CHURCH', 'WORK', 'ACTIVITY', 'BENEFIT']);

// One engine, two front doors: index.html is Paper Scrubber (the light teacher
// tool), deid/index.html is the De-Identifier (the staff tool for IEPs and
// eval reports, where the deep-check AI always runs). The deid page carries
// <base href="../"> so every relative path here resolves identically on both.
const TOOL = document.body.dataset.tool === 'deid' ? 'deid' : 'scrubber';
// Third door: the Mac program. Same page served from inside the app bundle,
// with a preload bridge (window.deidDesktop) for the scans-folder watcher.
const DESKTOP = TOOL === 'deid' && !!window.deidDesktop;

// deep-check label → app category. "person" maps to NAME and is *scrubbed*
// (a name the main model missed is a leak, not a judgement call) but only
// after looksLikeRealName filters GLiNER's pronoun/role noise.
const DEEP_LABEL_TO_TYPE = {
  'person': 'NAME',
  'health condition': 'HEALTH', 'disability': 'HEALTH', 'medication': 'HEALTH', 'assistive device': 'HEALTH',
  'family relationship': 'FAMILY',
  'religious group': 'CHURCH',
  'company': 'WORK',
  'sports team or club': 'ACTIVITY',
  'hobby or personal interest': 'ACTIVITY',
  'sport': 'ACTIVITY',
  'career interest': 'ACTIVITY',
  'school': 'ORG',
  'government benefit': 'BENEFIT',
};
// class-standing words GLiNER tags as "family relationship"; junk as flags —
// plus IEP-world jargon that reads like organizations or interests but
// identifies nobody (EXPLORE and ILP are assessments, ARC is the committee)
const DEEP_FLAG_STOP = new Set(['junior', 'senior', 'freshman', 'sophomore', 'sibling', 'siblings', 'family', 'parent', 'parents', 'explore', 'arc', 'ilp', 'reading materials', 'reading']);
const DEEP_NAME_STOP = new Set(['he', 'she', 'i', 'we', 'they', 'you', 'it', 'him', 'her', 'them', 'his', 'hers', 'my', 'me', 'our', 'us', 'your', 'their', 'who', 'mr', 'mrs', 'ms', 'miss', 'dr', 'student', 'students', 'teacher', 'nurse', 'mom', 'dad', 'mother', 'father', 'parents', 'sister', 'brother', 'grandma', 'grandmother', 'grandpa', 'grandfather', 'aunt', 'uncle', 'cousin', 'caseworker', 'counselor', 'guardian']);
function looksLikeRealName(s) {
  const words = s.trim().split(/\s+/);
  if (!words.length) return false;
  let hasSubstance = false;
  for (const w of words) {
    const clean = w.replace(/[.,;:'’]+$/g, '');
    if (DEEP_NAME_STOP.has(clean.toLowerCase())) return false;
    if (!/^\p{Lu}/u.test(clean)) return false;   // every word capitalized, or it's prose
    if (clean.length >= 3) hasSubstance = true;
  }
  return hasSubstance;
}

// Diagnoses, medications, and assistive devices that show up in K-12
// paperwork. Deliberately NOT service words (speech therapy, IEP, 504) —
// those appear in every special-ed document and flagging them is pure noise.
// Bare "anxiety"/"depression" are left out too: they're everyday essay words
// (and the Great Depression is a unit in every KY history class).
const HEALTH_TERMS = 'autism|autistic|Asperger(?:[\'’]s)?|ADHD|dyslexi[ac]|dysgraphia|dyscalculia|apraxia|aphasia|anxiety disorder|panic disorder|clinical depression|major depression|bipolar|epilep(?:sy|tic)|seizures?|diabet(?:es|ic)|asthma(?:tic)?|cerebral palsy|Down syndrome|muscular dystrophy|cystic fibrosis|sickle cell|traumatic brain injury|wheelchair|hearing aids?|cochlear implants?|insulin|EpiPen|inhaler|Adderall|Ritalin|Concerta|Vyvanse|Strattera|Focalin|Zoloft|Prozac|Lexapro|Abilify';

const REGEX_RULES = [
  { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'PHONE', re: /(?:\+?1[\s.\-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.\-])\d{3}[\s.\-]\d{4}(?!\d)/g },
  { type: 'SSN',   re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // bare digit runs — student IDs, lunch numbers, unformatted phones. The
  // models are inconsistent on these (one slipped through in testing), and
  // essays rarely contain legitimate 7+ digit runs (big numbers get commas).
  // Teachers can toggle the whole ID category off if a paper is math-heavy.
  { type: 'ID',    re: /\b\d{7,16}\b/g },
  // three leaks found by running a real (fictional) IEP through the tool —
  // each sat beside correctly scrubbed fields, so make them deterministic:
  // "Student Number: 101010" — labeled IDs of ANY length (the bare-run rule
  // above starts at 7 digits; real student numbers are often 5–6)
  { type: 'ID',    re: /(?<=\b(?:student|case|record|file|ssid)\s*(?:number|no\.?|num|id)?\s*[:#]?\s+)\d{3,}\b/gi },
  // "Riverview, KY 40000" — a zip riding behind the state abbreviation
  { type: 'ZIP',   re: /(?<=\b[A-Z]{2}\s{1,2})\d{5}(?:-\d{4})?\b/g },
  // "4-1-27", "10/1/26" — the model catches numeric dates by mood; three-part
  // dates never mean anything else, so stop gambling ("1/2" and "3 of 4" are
  // two-part and stay put)
  { type: 'DATE',  re: /\b\d{1,2}[-\/.]\d{1,2}[-\/.]\d{2,4}\b/g },
  // school names — the models have no "school" label, so catch the common shapes
  { type: 'ORG',   re: /\b(?:[A-Z][A-Za-z'’\-]+ ){1,4}(?:Elementary|Middle|High|Academy|University|College)(?: School)?\b|\b(?:[A-Z][A-Za-z'’\-]+ ){1,4}School\b/g },
  // …and the same shapes shouted in an all-caps letterhead, which the
  // capitalized pattern above steps right over. Kept as its own all-caps rule
  // rather than an /i flag, so ordinary prose ("back in middle school") stays put.
  { type: 'ORG',   re: /\b(?:[A-ZÀ-Þ][A-ZÀ-Þ'’\-]+ ){1,4}(?:ELEMENTARY|MIDDLE|HIGH|ACADEMY|UNIVERSITY|COLLEGE)(?: SCHOOL)?\b|\b(?:[A-ZÀ-Þ][A-ZÀ-Þ'’\-]+ ){1,4}SCHOOL\b/g },
  // neighbor-test categories (see DEFAULT_KEPT above — GRADE and HEALTH are
  // flagged, not auto-scrubbed; bus/room numbers scrub like any other number)
  { type: 'ROOM',   re: /\b(?:Bus|Room|Rm)\.?\s*#?\s*\d{1,4}\b/gi },
  { type: 'GRADE',  re: /\b(?:[1-9]|1[0-2]|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)(?:st|nd|rd|th)?[- ]grade(?:rs?)?\b|\bkindergart(?:en|ner)\b/gi },
  { type: 'HEALTH', re: new RegExp(`\\b(?:${HEALTH_TERMS})\\b`, 'gi') },
];

// Google Docs and Word sprinkle non-breaking and thin spaces through exported
// text. Treated as plain spaces they merge and extend normally; treated as
// "some other character" they silently end an entity mid-name.
const GAP = ' \\t\\u00A0\\u2007\\u202F\\u2009';

// ---------------------------------------------------------------- state
let pipePromise = null;
let papers = [];      // [{id, name, kind:'text'|'docx', file, docx, text, findings, status, error}]
let current = -1;     // index of the paper open in the review view
let busy = false;

// ---------------------------------------------------------------- dom
const $ = (id) => document.getElementById(id);
const els = {
  inputView: $('inputView'), batchView: $('batchView'), resultsView: $('resultsView'),
  paperText: $('paperText'),
  btnFile: $('btnFile'), btnSample: $('btnSample'), fileInput: $('fileInput'), btnInstall: $('btnInstall'),
  btnCamera: $('btnCamera'), cameraInput: $('cameraInput'),
  btnScrub: $('btnScrub'), statusArea: $('statusArea'), statusText: $('statusText'),
  progressWrap: $('progressWrap'), progressBar: $('progressBar'),
  btnBatchBack: $('btnBatchBack'), batchTitle: $('batchTitle'), batchStatus: $('batchStatus'),
  batchProgressWrap: $('batchProgressWrap'), batchProgressBar: $('batchProgressBar'),
  batchList: $('batchList'), btnZip: $('btnZip'),
  btnBack: $('btnBack'), btnNext: $('btnNext'), crumb: $('crumb'), ocrNote: $('ocrNote'),
  summaryLine: $('summaryLine'), legend: $('legend'), outputText: $('outputText'),
  btnCopy: $('btnCopy'), btnDownloadTxt: $('btnDownloadTxt'), btnDownloadDocx: $('btnDownloadDocx'),
  unscrubIn: $('unscrubIn'), unscrubOut: $('unscrubOut'), btnCopyUnscrub: $('btnCopyUnscrub'),
  unscrubBatchIn: $('unscrubBatchIn'), unscrubBatchOut: $('unscrubBatchOut'), btnCopyUnscrubBatch: $('btnCopyUnscrubBatch'),
  btnHelp: $('btnHelp'), helpDialog: $('helpDialog'), btnHelpClose: $('btnHelpClose'),
  safeNames: $('safeNames'), safeNamesBatch: $('safeNamesBatch'),
  roadReady: $('roadReady'),
};

// ---------------------------------------------------------------- views & status
function showView(name) {
  els.inputView.hidden = name !== 'input';
  els.batchView.hidden = name !== 'batch';
  els.resultsView.hidden = name !== 'review';
  window.scrollTo({ top: 0 });
}

function setStatus(msg, { error = false } = {}) {
  els.statusArea.hidden = false;
  els.statusText.textContent = msg;
  els.statusText.className = error ? 'error' : '';
}
function showProgress(pct) {
  els.progressWrap.hidden = false;
  els.progressBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}
function hideStatus() {
  els.statusArea.hidden = true;
  els.progressWrap.hidden = true;
  els.progressBar.style.width = '0%';
}

// one status "surface" per flow: single-paper messages go to the input card,
// batch messages go to the batch card
function statusSurface() {
  if (!els.batchView.hidden) {
    return {
      say: (msg) => { els.batchStatus.textContent = msg; },
      bar: (pct) => { els.batchProgressWrap.hidden = false; els.batchProgressBar.style.width = `${pct}%`; },
      barOff: () => { els.batchProgressWrap.hidden = true; },
    };
  }
  return {
    say: (msg) => setStatus(msg),
    bar: (pct) => showProgress(pct),
    barOff: () => hideStatus(),
  };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- model loading
async function getPipe(ui) {
  if (pipePromise) return pipePromise;
  let sawDownload = false;
  const progress_callback = (e) => {
    if (e.status === 'progress' && typeof e.progress === 'number' && String(e.file || '').endsWith('.onnx')) {
      sawDownload = true;
      const mb = (n) => Math.round(n / 1048576);
      ui.say(`Downloading the scrubber — ${mb(e.loaded)} of ${mb(e.total)} MB. This happens once; after this it's saved on this device.`);
      ui.bar(e.progress);
    }
  };
  ui.say('Getting the scrubber ready…');
  pipePromise = pipeline('token-classification', MODEL.id, { dtype: MODEL.dtype, progress_callback })
    .then((p) => {
      if (sawDownload) ui.say('Saved! Loading it into memory…');
      return p;
    })
    .catch((err) => { pipePromise = null; throw err; });
  return pipePromise;
}

// ---------------------------------------------------------------- text chunking
function chunkText(text, maxLen) {
  const chunks = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + maxLen, text.length);
    if (end < text.length) {
      const slice = text.slice(pos, end);
      const cut = Math.max(
        slice.lastIndexOf('\n'),
        slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '),
      );
      if (cut > maxLen * 0.35) end = pos + cut + 1;
      else {
        const sp = slice.lastIndexOf(' ');
        if (sp > maxLen * 0.35) end = pos + sp;
      }
    }
    chunks.push({ start: pos, text: text.slice(pos, end) });
    pos = end;
  }
  return chunks;
}

// ---------------------------------------------------------------- token → char spans
// transformers.js does not reliably give char offsets, so we re-locate each
// token in the chunk with a forward-moving cursor.
//
// Folding matters more than it looks: the English model is *uncased*, and its
// tokenizer strips accents — it hands back "jose" for text that reads "José".
// A plain indexOf then finds nothing, the token is dropped, and the name never
// becomes a finding at all. Every accented student name was invisible.
// Folded one UTF-16 unit at a time so positions still line up with the original.
function foldForMatch(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const base = s[i].normalize('NFD')[0] || s[i];
    const low = base.toLowerCase();
    out += low.length === 1 ? low : s[i];   // keep 1:1 with the source string
  }
  return out;
}

function mapTokens(chunkStr, tokens) {
  const hay = foldForMatch(chunkStr);
  let cursor = 0;
  return tokens.map((t) => {
    if (Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start) {
      cursor = Math.max(cursor, t.end);
      return { start: t.start, end: t.end };
    }
    const w = String(t.word ?? '').replace(/^##/, '').replace(/^[▁Ġ]+/, '').trim();
    if (!w || SPECIAL_TOKENS.has(w)) return null;
    const idx = hay.indexOf(foldForMatch(w), cursor);
    if (idx === -1) return null;
    cursor = idx + w.length;
    return { start: idx, end: idx + w.length };
  });
}

// ---------------------------------------------------------------- entity assembly
function collectEntities(tokens, spans, chunkStr) {
  const ents = [];
  let cur = null;
  const flush = () => { if (cur) { ents.push(cur); cur = null; } };

  tokens.forEach((t, i) => {
    const span = spans[i];
    const label = String(t.entity ?? t.entity_group ?? 'O');
    if (label === 'O' || !span) { flush(); return; }
    const isB = label.startsWith('B-');
    const raw = label.replace(/^[BI]-/, '');
    const type = LABEL_TO_TYPE[raw];
    if (!type) { flush(); return; }

    if (cur && cur.type === type) {
      const gap = chunkStr.slice(cur.end, span.start);
      const subword = gap.length === 0;                 // same-word continuation
      const smallGap = /^[ \t]{1,2}$/.test(gap);        // next word of same entity (never across lines)
      if (subword || (smallGap && !isB)) {
        cur.end = span.end;
        cur.scores.push(t.score);
        return;
      }
    }
    flush();
    cur = { type, start: span.start, end: span.end, scores: [t.score] };
  });
  flush();
  return ents;
}

function expandToWord(text, ent) {
  const loose = ent.type === 'EMAIL' || ent.type === 'LINK' || ent.type === 'USERNAME';
  // \p{L}\p{N}, not A-Za-z0-9 — otherwise a repair on "José" stops at the "s"
  // and the accented tail is left sitting in the paper
  const ok = (ch) => (loose ? /[^\s()[\]{}<>,;:"']/ : /[\p{L}\p{N}'’\-]/u).test(ch);
  while (ent.start > 0 && ok(text[ent.start - 1])) ent.start--;
  while (ent.end < text.length && ok(text[ent.end])) ent.end++;
  // sentence punctuation isn't part of an email/link — give the period back
  if (loose) while (ent.end > ent.start && /[.!?,;:]/.test(text[ent.end - 1])) ent.end--;
}

function weightOf(f) {
  return (f.source === 'regex' ? 1e9 : 0) + (f.end - f.start) * 100 + f.score;
}

function resolveOverlaps(list) {
  list.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const f of list) {
    const last = out[out.length - 1];
    if (last && f.start < last.end) {
      if (weightOf(f) > weightOf(last)) out[out.length - 1] = f;
    } else out.push(f);
  }
  return out;
}

function mergeAdjacent(list, text) {
  const out = [];
  for (const f of list) {
    const last = out[out.length - 1];
    if (last && last.type === f.type && new RegExp(`^[${GAP}.,'’\\-]{0,3}$`).test(text.slice(last.end, f.start))) {
      last.end = f.end;
      last.score = Math.max(last.score, f.score);
    } else out.push(f);
  }
  return out;
}

// Models sometimes truncate entities ("Jasmine" but not "Carter", "118 Deer"
// but not "Creek Road"). Extend names/addresses across adjacent capitalized
// words and street suffixes; leaking half a name is worse than over-scrubbing.
const STREET_WORDS = /^(?:Road|Rd|Street|St|Avenue|Ave|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Way|Trail|Fork|Branch|Hollow|Creek|Ridge|Pike|Highway|Hwy|Route|Boulevard|Blvd)\.?,?$/i;
function extendEntities(text, list) {
  for (const f of list) {
    // CITY/STATE included because place names are also first names (Dalton,
    // Austin, Savannah…) — when the model calls "Dalton" a city, the "Hall"
    // right after it must not leak
    if (!['NAME', 'ADDRESS', 'ORG', 'CITY', 'STATE'].includes(f.type)) continue;
    if (f.type === 'ADDRESS') {
      // pull a leading house number into the address ("118 |Deer Creek Road")
      const m = text.slice(Math.max(0, f.start - 10), f.start).match(/(\d{1,6}[A-Za-z]?) $/);
      if (m) {
        const newStart = f.start - m[0].length;
        if (!list.some((g) => g !== f && g.start < f.start && g.end > newStart)) f.start = newStart;
      }
    }
    let extra = 0;
    while (extra < 3) {
      // places never span sentences — "Whitesburg, Kentucky. Email me" must
      // not swallow "Email", and "Hensley Auto Parts. His" must not swallow
      // "His" (names keep extending: "Mrs." ends with a period)
      if ((f.type === 'CITY' || f.type === 'STATE' || f.type === 'ADDRESS') && /[.!?]$/.test(text.slice(f.start, f.end))) break;
      // a possessive ENDS the name — "Robert's Quantile score" must not eat
      // "Quantile" (which the echo pass would then stamp out document-wide)
      if (/['’]s$/.test(text.slice(f.start, f.end))) break;
      const m = text.slice(f.end).match(new RegExp(`^[${GAP}]([\\p{L}'’.\\-]+)`, 'u'));
      if (!m) break;
      const word = m[1];
      const isCap = /^\p{Lu}[\p{Ll}'’\-]+\.?$/u.test(word);   // Unicode-aware: Márquez, Peña
      const isStreet = f.type === 'ADDRESS' && STREET_WORDS.test(word);
      if (!isCap && !isStreet) break;
      const nextEnd = f.end + 1 + word.length;
      if (list.some((g) => g !== f && g.start < nextEnd && g.end > f.end)) break; // don't swallow a neighboring finding
      f.end = nextEnd;
      extra++;
    }
  }
  return list;
}

// If a name was caught anywhere, scrub the same word everywhere else too
// (models are inconsistent on repeated mentions; students repeat their names).
function propagateNames(text, list) {
  const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'coach', 'professor', 'prof']);
  const words = new Set();
  for (const f of list) {
    if (f.type !== 'NAME') continue;
    for (const w of text.slice(f.start, f.end).split(/[^\p{L}'’\-]+/u)) {
      const clean = w.replace(/[’']s$/i, '');
      if (clean.length >= 3 && /^\p{Lu}/u.test(clean) && !HONORIFICS.has(clean.toLowerCase())) words.add(clean);
    }
  }
  const extra = [];
  for (const w of words) {
    // NOT \b: JavaScript's word boundary counts only [A-Za-z0-9_], so "José"
    // ends on a non-word character and \bJosé\b never matches — the echo pass
    // silently skipped every accented name. Unicode lookarounds do the same
    // job for every alphabet.
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}(?![\\p{L}\\p{N}])`, 'gu');
    let m;
    while ((m = re.exec(text)) !== null) {
      const covered = list.some((f) => m.index < f.end && m.index + w.length > f.start);
      if (!covered) extra.push({ type: 'NAME', start: m.index, end: m.index + w.length, score: 0.99, source: 'echo' });
    }
  }
  return extra;
}

// ---------------------------------------------------------------- deep check
// GLiNER fp16 in its own worker (deep-check-worker.mjs) — opt-in, heavy,
// built for IEPs and eval reports on staff laptops. All requests stay on
// this origin; the worker reassembles the model from its 7 repo slices.
let deepWorker = null;
let deepSeq = 0;
let deepUi = null;
const deepPending = new Map();

function deepCheckOn() { return TOOL === 'deid'; }

function runDeepCheck(text, ui) {
  if (!deepWorker) {
    deepWorker = new Worker(new URL('deep-check-worker.mjs', document.baseURI), { type: 'module' });
    deepWorker.onmessage = (e) => {
      const m = e.data;
      if (m.kind === 'progress') {
        deepUi?.say(m.label);
        if (typeof m.pct === 'number') deepUi?.bar(m.pct);
        return;
      }
      const p = deepPending.get(m.id);
      if (!p) return;
      deepPending.delete(m.id);
      if (m.kind === 'result') p.resolve(m.spans);
      else p.reject(new Error(m.message));
    };
    deepWorker.onerror = (e) => {
      const err = new Error(e.message || 'the deep-check worker crashed');
      for (const p of deepPending.values()) p.reject(err);
      deepPending.clear();
      deepWorker.terminate();
      deepWorker = null;   // next scrub can retry from scratch
    };
  }
  deepUi = ui;
  const id = ++deepSeq;
  return new Promise((resolve, reject) => {
    deepPending.set(id, { resolve, reject });
    deepWorker.postMessage({ id, text });
  });
}

// ---------------------------------------------------------------- detection
// Runs one chunk through the model and returns findings in chunk-local
// coordinates. The model truncates silently at 512 tokens, so a chunk that
// comes back at the ceiling is split and re-scanned rather than trusted —
// otherwise the tail of a dense page is never looked at at all.
async function scanChunk(pipe, piece, depth = 0) {
  const out = await pipe(piece, { ignore_labels: [] });
  if (out.length >= MODEL_MAX_TOKENS - 2 && piece.length > 120 && depth < 4) {
    let cut = piece.lastIndexOf(' ', Math.floor(piece.length / 2));
    if (cut < 20) cut = Math.floor(piece.length / 2);
    const left = await scanChunk(pipe, piece.slice(0, cut), depth + 1);
    const right = await scanChunk(pipe, piece.slice(cut), depth + 1);
    return [...left, ...right.map((e) => ({ ...e, start: e.start + cut, end: e.end + cut }))];
  }
  const tokens = out.filter((t) => !SPECIAL_TOKENS.has(String(t.word ?? '').trim()));
  const spans = mapTokens(piece, tokens);
  const found = [];
  for (const e of collectEntities(tokens, spans, piece)) {
    // Highest-confidence token, not the average. A name the model is sure about
    // gets dragged under the threshold by the low-scoring subword pieces around
    // it — averaging "Már|quez" throws away the detection of "Már".
    const score = Math.max(...e.scores);
    if (score < SCORE_THRESHOLD) continue;
    found.push({ type: e.type, start: e.start, end: e.end, score });
  }
  return found;
}

async function detectText(text, ui, paperName = '') {
  const pipe = await getPipe(ui);
  const chunks = chunkText(text, MODEL.chunkChars);
  const raw = [];

  for (let i = 0; i < chunks.length; i++) {
    const who = paperName ? `${paperName} — ` : '';
    ui.say(`Scanning ${who}part ${i + 1} of ${chunks.length}`);
    for (const e of await scanChunk(pipe, chunks[i].text)) {
      raw.push({ type: e.type, start: e.start + chunks[i].start, end: e.end + chunks[i].start, score: e.score, source: 'model' });
    }
    await new Promise((r) => setTimeout(r, 0)); // let the UI breathe
  }

  for (const rule of REGEX_RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      raw.push({ type: rule.type, start: m.index, end: m.index + m[0].length, score: 1, source: 'regex' });
    }
  }

  for (const f of raw) expandToWord(text, f);
  let list = resolveOverlaps(raw);
  list = mergeAdjacent(list, text);
  list = mergeAdjacent(extendEntities(text, list), text);
  // echoes can reveal new surname halves ("Boo" → "Boo Radley"), which can in
  // turn echo elsewhere — two rounds reaches a fixpoint on real papers
  for (let round = 0; round < 2; round++) {
    const echoes = propagateNames(text, list);
    if (!echoes.length) break;
    list = mergeAdjacent(resolveOverlaps([...list, ...echoes]), text);
    list = mergeAdjacent(extendEntities(text, list), text);
  }
  list = list.filter((f) => text.slice(f.start, f.end).trim().length >= 2);

  // opt-in second pass for contextual identifiers. A deep-check failure must
  // never kill the scrub — the regular pass has already done its job.
  if (deepCheckOn()) {
    try {
      const deep = await runDeepCheck(text, ui);
      for (const d of deep) {
        const type = DEEP_LABEL_TO_TYPE[d.label];
        if (!type) continue;
        // hits that will SCRUB (names, orgs) must look like proper nouns —
        // GLiNER also tags "school nurse" and "his grade" as school, and
        // auto-replacing those mangles the sentence for no privacy gain
        if ((type === 'NAME' || type === 'ORG') && !looksLikeRealName(d.text)) continue;
        if (DEEP_FLAG_STOP.has(d.text.trim().toLowerCase())) continue;
        if (list.some((f) => d.start < f.end && d.end > f.start)) continue;  // regular findings win
        list.push({ type, start: d.start, end: d.end, score: d.score, source: 'deep' });
        list.sort((a, b) => a.start - b.start);
      }
      list = mergeAdjacent(list, text);
    } catch (err) {
      console.error(err);
      ui.say(`The deep check couldn't run (${err.message}) — regular scrubbing was still applied.`);
    }
  }

  // The desktop edition serves reviewers who chose this tool BECAUSE they are
  // afraid of FERPA and do not want judgement calls: everything detected is
  // replaced, automatically, no questions. (Web versions keep the flag-for-
  // judgement behavior — teachers need the diagnosis left readable.)
  return list.map((f, i) => ({ ...f, id: i, enabled: DESKTOP ? true : !DEFAULT_KEPT.has(f.type) }));
}

// ---------------------------------------------------------------- docx engine
function ancestorP(el) {
  let a = el.parentNode;
  while (a && a.nodeType === 1) {
    if (a.localName === 'p' && a.namespaceURI === W_NS) return a;
    a = a.parentNode;
  }
  return null;
}

async function parseDocx(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  const names = Object.keys(zip.files).filter((p) =>
    /^word\/(document\d*|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(p));
  if (!names.some((n) => /^word\/document\d*\.xml$/.test(n))) {
    throw new Error('this does not look like a Word (.docx) file');
  }
  names.sort((a, b) =>
    ((/^word\/document/.test(a) ? 0 : 1) - (/^word\/document/.test(b) ? 0 : 1)) || a.localeCompare(b));

  const parser = new DOMParser();
  const parts = [];
  let fullText = '';
  for (const path of names) {
    const src = await zip.file(path).async('string');
    const xml = parser.parseFromString(src, 'application/xml');
    if (xml.getElementsByTagName('parsererror').length) continue; // skip unreadable part
    const decl = src.startsWith('<?xml') ? src.slice(0, src.indexOf('?>') + 2) : '';

    if (fullText.length) fullText += '\n';   // unmapped separator between parts
    const base = fullText.length;
    let text = '';
    const nodes = [];
    let lastP;
    const walker = xml.createTreeWalker(xml.documentElement, NodeFilter.SHOW_ELEMENT);
    let el;
    while ((el = walker.nextNode())) {
      if (el.namespaceURI !== W_NS) continue;
      // delText is a tracked deletion — the wording someone struck out. Word
      // still shows it in All Markup and it is still in the file, so it has to
      // be scanned and replaced like any other text. IEP drafts are full of it.
      // Runs are joined with nothing, exactly as they always were: Word tracks
      // edits a character at a time, so a separator here would split a phone
      // number around a retyped digit and lose it. The cost is that a word
      // touching a deletion can be swallowed into the tag next to it, which is
      // over-scrubbing — the direction this tool errs in on purpose.
      if (el.localName === 't' || el.localName === 'delText') {
        const p = ancestorP(el);
        if (lastP !== undefined && p !== lastP && text.length) text += '\n';
        lastP = p;
        const val = el.textContent;
        nodes.push({ node: el, start: text.length, end: text.length + val.length });
        text += val;
      } else if (el.localName === 'tab') text += '\t';
      else if (el.localName === 'br' || el.localName === 'cr') text += '\n';
    }
    parts.push({ path, xml, decl, nodes, text, base, everTouched: false });
    fullText += text;
  }
  return { zip, parts, fullText };
}

// Replace enabled findings inside the original XML text nodes, then rezip.
// Every node is first reset to its original text so repeated downloads (after
// the teacher toggles findings) always start from a clean slate.
async function buildScrubbedDocx(paper) {
  paper.unscrubMap = unscrubMapFor(paper);   // un-scrub against the tags the AI actually saw
  const ph = placeholderAssigner(paper);
  for (const part of paper.docx.parts) {
    for (const { node, start, end } of part.nodes) node.textContent = part.text.slice(start, end);

    const local = paper.findings
      .filter((f) => f.enabled && f.end > part.base && f.start < part.base + part.text.length)
      .map((f) => ({ start: f.start - part.base, end: f.end - part.base, ph: ph(f) }));

    for (const { node, start, end } of part.nodes) {
      const hits = local.filter((f) => f.start < end && f.end > start);
      if (!hits.length) continue;
      const orig = part.text.slice(start, end);
      let out = '';
      let pos = start;
      for (const f of hits.sort((a, b) => a.start - b.start)) {
        const s = Math.max(f.start, start);
        const e = Math.min(f.end, end);
        out += orig.slice(pos - start, s - start);
        if (f.start >= start) out += f.ph;   // placeholder lives in the node where the finding starts
        pos = e;
      }
      out += orig.slice(pos - start);
      node.textContent = out;
      node.setAttribute('xml:space', 'preserve');
    }

    const need = local.length > 0 || part.everTouched;
    if (local.length) part.everTouched = true;
    if (need) {
      const ser = new XMLSerializer().serializeToString(part.xml);
      paper.docx.zip.file(part.path, part.decl && !ser.startsWith('<?xml') ? part.decl + '\n' + ser : ser);
    }
  }
  const needles = [...new Set(paper.findings
    .filter((f) => f.enabled && LINK_NEEDLE_TYPES.has(f.type))
    .map((f) => paper.text.slice(f.start, f.end).trim().toLowerCase())
    .filter((s) => s.length >= 6))];
  await stripDocxIdentity(paper.docx.zip, needles);
  return paper.docx.zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: DOCX_MIME });
}

// A .docx is a zip, and the student's name lives in more of it than the text:
// Word stamps the author into docProps, onto every comment and tracked change,
// and into people.xml. Scrubbing only <w:t> hands the teacher a file she has
// been told is clean while her student's name rides along inside the package —
// visible in Explorer, in Drive, and to anything that parses the container.
// Values are blanked rather than the parts deleted, so the package stays valid.
const META_TEXT_ELS = /<(dc:creator|dc:title|dc:subject|dc:description|cp:lastModifiedBy|cp:category|cp:keywords|Company|Manager)(\s[^>]*)?>[\s\S]*?<\/\1>/g;
// app.xml mirrors the document title — and every heading — into these lists,
// so blanking dc:title in core.xml alone still ships "Jayden Combs IEP".
const APP_TITLE_LISTS = /<(TitlesOfParts|HeadingPairs)(\s[^>]*)?>[\s\S]*?<\/\1>/g;
// A hyperlink keeps its real target after the visible address is replaced:
// Word auto-links a typed email, so the text reads [EMAIL 1] while the link
// still resolves to the student. Reserved TLD, so a stray click goes nowhere.
const REDACTED_LINK = 'https://redacted.invalid/';
const REL_EL = /<Relationship\b[\s\S]*?(?:\/>|<\/Relationship>)/g;
const INSTR_EL = /(<w:(?:instrText|delInstrText)(?:\s[^>]*)?>)([\s\S]*?)(<\/w:(?:instrText|delInstrText)>)/g;

// Only identifiers that actually turn up inside a URL are matched against
// link targets. A name or place needle would take a legitimate citation with
// it — "hazard" appears in plenty of Kentucky links that are not about a
// student — and losing a source in an essay is its own kind of wrong.
const LINK_NEEDLE_TYPES = new Set(['EMAIL', 'PHONE', 'USERNAME', 'ID', 'SSN', 'LINK']);

// A target is scrubbed when it is personal contact by nature, or when it
// carries something this document already decided to replace. Plain citations
// (a Gutenberg link in an essay) are left alone — over-scrubbing has a cost too.
function riskyLinkTarget(target, needles) {
  if (/^\s*(mailto:|tel:|callto:|skype:)/i.test(target)) return true;
  const t = target.toLowerCase();
  return needles.some((n) => t.includes(n));
}

// Custom document properties are where a district's document library pushes
// columns like Student or Case Manager. They are pure metadata to a
// de-identified copy, so the part goes — along with the two references that
// would otherwise leave Word calling the file corrupt.
async function dropCustomProps(zip) {
  if (!zip.file('docProps/custom.xml')) return;
  zip.remove('docProps/custom.xml');
  const ct = zip.file('[Content_Types].xml');
  if (ct) {
    const s = await ct.async('string');
    zip.file('[Content_Types].xml', s.replace(/<Override\b[^>]*PartName="\/docProps\/custom\.xml"[^>]*\/>/g, ''));
  }
  const rels = zip.file('_rels/.rels');
  if (rels) {
    const s = await rels.async('string');
    zip.file('_rels/.rels', s.replace(/<Relationship\b[^>]*Target="[^"]*docProps\/custom\.xml"[^>]*\/>/g, ''));
  }
}

async function stripDocxIdentity(zip, linkNeedles = []) {
  for (const path of ['docProps/core.xml', 'docProps/app.xml']) {
    const f = zip.file(path);
    if (!f) continue;
    let s = await f.async('string');
    s = s.replace(META_TEXT_ELS, (_m, tag, attrs) => `<${tag}${attrs || ''}></${tag}>`);
    if (path.endsWith('app.xml')) s = s.replace(APP_TITLE_LISTS, '');
    zip.file(path, s);
  }
  await dropCustomProps(zip);
  // A content control can be data-bound to a customXml part, and Word refills
  // the visible text from it when the file opens — which would put the real
  // name back into a document this tool just cleaned. The part stays, so every
  // relationship and content type is still valid; the data inside it goes.
  for (const path of Object.keys(zip.files)) {
    if (/^customXml\/item\d*\.xml$/.test(path)) {
      zip.file(path, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><root/>');
    }
  }
  for (const path of Object.keys(zip.files)) {
    const isXml = /^word\/.*\.xml$/.test(path);
    const isRels = /^word\/_rels\/.*\.rels$/.test(path);
    if (!isXml && !isRels) continue;
    const f = zip.file(path);
    if (!f) continue;
    const s = await f.async('string');
    let cleaned = s;
    if (isXml) {
      cleaned = cleaned.replace(META_AUTHOR_ATTRS, '');
      // field codes carry the same targets as the .rels: HYPERLINK "mailto:…".
      // Only HYPERLINK, and only its first argument — the rest of a field
      // instruction is style names and switches that must survive untouched.
      cleaned = cleaned.replace(INSTR_EL, (m, open, body, close) => {
        if (!/\bHYPERLINK\b/i.test(body)) return m;
        let seen = false;
        const fixed = body.replace(/"([^"]*)"/g, (q, url) => {
          if (seen) return q;
          seen = true;
          return riskyLinkTarget(url, linkNeedles) ? `"${REDACTED_LINK}"` : q;
        });
        return fixed === body ? m : open + fixed + close;
      });
      // a picture's alt text is written by whoever inserted it, and routinely
      // names the child in the photo
      cleaned = cleaned.replace(/<(?:wp:docPr|pic:cNvPr)\b[^>]*?\/?>/g, (tag) =>
        tag.replace(/\s(?:descr|title)="[^"]*"/g, '').replace(/\sname="[^"]*"/, ' name="Picture"'));
    } else {
      cleaned = cleaned.replace(REL_EL, (rel) => {
        if (!/Type="[^"]*\/hyperlink"/.test(rel)) return rel;
        return rel.replace(/Target="([^"]*)"/, (m, target) =>
          (riskyLinkTarget(target, linkNeedles) ? `Target="${REDACTED_LINK}"` : m));
      });
    }
    if (cleaned !== s) zip.file(path, cleaned);
  }
  if (zip.file('word/people.xml')) {
    zip.file('word/people.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>');
  }
}

// ---------------------------------------------------------------- pdf engine
// pdf.js is imported only when a PDF actually arrives — no reason to parse
// ~1.8 MB of module on page load. The service worker still pre-caches both
// files, so PDFs keep working offline.
let pdfjsPromise = null;
function loadPdfJs() {
  pdfjsPromise ??= import('./vendor/pdf.min.mjs').then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', document.baseURI).href;
    return lib;
  });
  return pdfjsPromise;
}

// Rebuild readable text from pdf.js's positioned fragments: new line when the
// baseline moves, a space when two fragments on the same line don't touch.
function pdfPageText(items) {
  let text = '';
  let last = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const x = it.transform[4];
    const y = it.transform[5];
    if (last) {
      if (Math.abs(y - last.y) > 2) text += '\n';
      else if (x - last.endX > 1.5 && it.str && !/^\s/.test(it.str) && !/\s$/.test(text)) text += ' ';
    }
    text += it.str;
    if (it.hasEOL) { text += '\n'; last = null; }
    else last = { y, endX: x + (it.width ?? 0) };
  }
  return text;
}

async function extractPdfText(arrayBuffer, ui, who, paper) {
  const pdfjs = await loadPdfJs();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: arrayBuffer, isEvalSupported: false }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('this PDF is password-protected — remove the password and try again');
    if (err?.name === 'InvalidPDFException') throw new Error('this does not look like a working PDF');
    throw err;
  }
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      pages.push(pdfPageText((await page.getTextContent()).items));
    }
    const text = pages.join('\n\n').replace(/[ \t]+\n/g, '\n');
    // a page of print yields hundreds of characters; a scan yields none
    if (text.replace(/\s/g, '').length >= 30) return text;

    // no text layer — this PDF is a scan, so read the print off each page
    paper.ocr = true;
    const read = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      read.push(await ocrRead(await pdfPageCanvas(page), ui, who, doc.numPages > 1 ? ` (page ${n} of ${doc.numPages})` : ''));
    }
    const scanText = read.join('\n\n').trim();
    if (scanText.replace(/\s/g, '').length < 20) throw new Error(NOT_ENOUGH_PRINT);
    return scanText;
  } finally {
    doc.destroy();
  }
}

async function pdfPageCanvas(page) {
  const viewport = page.getViewport({ scale: 2 });   // ~144 dpi — plenty for print
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  return canvas;
}

// ---------------------------------------------------------------- ocr engine
// Photos and scans have no text layer, so the print is read with tesseract.js —
// vendored and offline-capable like everything else. It reads typed print well
// and handwriting essentially not at all, so every OCR'd paper is flagged for
// an extra-careful review.
const NOT_ENOUGH_PRINT = "couldn't find readable print — this works best on a clear, straight-on photo or scan of a typed paper (handwriting can't be read)";
const OCR_MAX_SIDE = 2400;

const ocrWorkers = {};                // one per language combo, created on demand
let ocrProgress = null;               // set around recognize() calls; the logger reads it

function loadOcrWorker(ui, langs) {
  ocrWorkers[langs] ??= (async () => {
    ui.say('Getting the print reader ready — one moment…');
    const base = new URL('vendor/', document.baseURI).href;
    const T = (await import('./vendor/tesseract.esm.min.js')).default;
    return T.createWorker(langs, 1, {
      workerPath: `${base}tesseract-worker.min.js`,
      corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
      langPath: base.replace(/\/$/, ''),
      logger: (m) => { if (m.status === 'recognizing text' && ocrProgress) ocrProgress(m.progress); },
    });
  })().catch((err) => { delete ocrWorkers[langs]; throw err; });
  return ocrWorkers[langs];
}

async function ocrRead(source, ui, who, pageInfo) {
  const worker = await loadOcrWorker(ui, 'eng');
  const label = `${who || 'the scan'}${pageInfo}`;
  ocrProgress = (frac) => {
    ui.say(`Reading print in ${label} — ${Math.round(frac * 100)}%`);
    ui.bar(frac * 100);
  };
  try {
    const { data } = await worker.recognize(source);
    return data.text ?? '';
  } finally {
    ocrProgress = null;
  }
}

async function imageToCanvas(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(/\.hei[cf]$/i.test(file.name)
      ? 'iPhone HEIC photos can\'t be read by the browser — in Settings → Camera → Formats pick “Most Compatible”, or share the photo as a JPEG first'
      : 'this image couldn\'t be read — a .png or .jpg photo works best');
  }
  const scale = Math.min(1, OCR_MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas;
}

// ---------------------------------------------------------------- papers
function newPaper(file) {
  const m = file.name.toLowerCase().match(/\.(docx|pdf|png|jpe?g|webp|bmp|heic|heif)$/);
  // phone photo pickers sometimes deliver gallery images with no usable
  // filename — the browser-reported MIME type still identifies them
  const kind = m ? (m[1] === 'docx' ? 'docx' : m[1] === 'pdf' ? 'pdf' : 'image')
    : (file.type || '').startsWith('image/') ? 'image' : 'text';
  return {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())),
    file, name: file.name, kind,
    status: 'waiting', text: '', docx: null, findings: [], error: null, ocr: false,
  };
}

async function loadPaperContent(p, ui, who) {
  if (p.kind === 'docx') {
    p.docx = await parseDocx(await p.file.arrayBuffer());
    p.text = p.docx.fullText;
  } else if (p.kind === 'pdf') {
    p.text = await extractPdfText(await p.file.arrayBuffer(), ui, who, p);
  } else if (p.kind === 'image') {
    p.ocr = true;
    const text = await ocrRead(await imageToCanvas(p.file), ui, who || 'the photo', '');
    if (text.replace(/\s/g, '').length < 20) throw new Error(NOT_ENOUGH_PRINT);
    p.text = text;
  } else {
    p.text = await p.file.text();
  }
  if (!p.text.trim()) throw new Error('the file appears to be empty');
}

async function scrubPapers(list) {
  busy = true;
  els.btnScrub.disabled = true;
  const ui = statusSurface();
  try {
    await getPipe(ui);
  } catch (err) {
    console.error(err);
    ui.say(`Couldn't load the scrubber: ${err.message}. If this is the first run, check the internet connection and try again (the one-time download needs it).`);
    els.statusText.className = 'error';
    busy = false;
    updateScrubButton();
    return false;
  }
  let done = 0;
  for (const p of list) {
    p.status = 'scanning';
    if (list.length > 1) renderBatch();
    try {
      if (!p.text) await loadPaperContent(p, statusSurface(), list.length > 1 ? p.name : '');
      p.findings = await detectText(p.text, statusSurface(), list.length > 1 ? p.name : '');
      p.status = 'done';
    } catch (err) {
      console.error(err);
      p.status = 'error';
      p.error = err.message;
    }
    done++;
    if (list.length > 1) {
      renderBatch();
      statusSurface().bar((done / list.length) * 100);
    }
  }
  busy = false;
  updateScrubButton();
  return true;
}

async function loadFiles(fileList) {
  if (busy) { setStatus('Still working on the last papers — one moment…'); return; }
  const all = [...fileList];
  const ok = all.filter((f) => /\.(docx|pdf|txt|md|text|png|jpe?g|webp|bmp|heic|heif)$/i.test(f.name) || (f.type || '').startsWith('image/'));
  const skipped = all.filter((f) => !ok.includes(f));
  if (!ok.length) {
    showView('input');
    const hasOldDoc = skipped.some((f) => /\.doc$/i.test(f.name));
    setStatus(hasOldDoc
      ? 'That\'s an old-style .doc file. Open it in Word, use “Save As → .docx”, then try again.'
      : 'Please use Word (.docx), PDF, photo, or plain text (.txt) files.', { error: true });
    return;
  }
  papers = ok.sort((a, b) => a.name.localeCompare(b.name)).map(newPaper);
  current = -1;
  const skipNote = skipped.length
    ? ` Skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} (only .docx, .pdf, photos, and .txt work): ${skipped.map((f) => f.name).join(', ')}.`
    : '';

  if (papers.length === 1) {
    showView('input');
    setStatus(`Reading ${papers[0].name}…`);
    const started = await scrubPapers(papers);
    if (!started) return;
    if (papers[0].status === 'done') {
      hideStatus();
      openReview(0);
    } else {
      setStatus(`Couldn't read ${papers[0].name}: ${papers[0].error}. Try copying and pasting the text instead.`, { error: true });
    }
  } else {
    showView('batch');
    els.batchTitle.textContent = `Scrubbing ${papers.length} papers, one at a time…`;
    els.btnZip.disabled = true;
    els.btnZip.textContent = '⬇️ Download all scrubbed papers';
    batchUnscrub.reset();   // new set, new tag mapping
    renderBatch();
    await scrubPapers(papers);
    const good = papers.filter((p) => p.status === 'done').length;
    const bad = papers.length - good;
    els.batchTitle.textContent = good === papers.length
      ? `Done — all ${good} papers are scrubbed ✅`
      : `${good} of ${papers.length} papers scrubbed`;
    statusSurface().say((good
      ? `Every paper was scrubbed separately.${bad ? ` ${bad} couldn't be read — see below.` : ''} Check any one you want with the Check button, then get them all with the green button at the bottom.`
      : 'None of these files could be read. They need to be Word (.docx), PDF, photos, or plain text (.txt).') + skipNote);
    statusSurface().barOff();
    els.btnZip.disabled = good === 0;
    els.btnZip.textContent = `⬇️ Download all ${good} scrubbed paper${good === 1 ? '' : 's'} (one .zip)`;
  }
  if (papers.length === 1 && skipNote) {
    statusSurface().say(skipNote.trim());
  }
}

// ---------------------------------------------------------------- placeholders
// Tags belong to VALUES, batch-wide: the same name/email/number gets the same
// tag in every paper of a set, so an AI reading several papers can track who's
// who — and a reply about any of them un-scrubs with one shared mapping.
// Numbering counts every finding (kept ones too), so toggling a highlight
// never renumbers the others; a tag may vanish, but it never changes meaning.
function placeholderAssigner(paper) {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '').trim();
  const seen = {};
  for (const q of papers) {
    if (!q?.findings) continue;
    for (const f of q.findings) {
      const key = norm(q.text.slice(f.start, f.end));
      seen[f.type] ??= new Map();
      if (!seen[f.type].has(key)) seen[f.type].set(key, seen[f.type].size + 1);
    }
  }
  const byId = {};
  for (const f of paper.findings) {
    byId[f.id] = seen[f.type]?.get(norm(paper.text.slice(f.start, f.end)));
  }
  return (f) => {
    const multi = (seen[f.type]?.size ?? 0) > 1;
    return `[${TYPES[f.type].ph}${multi ? ' ' + byId[f.id] : ''}]`;
  };
}

function scrubbedPlainTextFor(paper) {
  paper.unscrubMap = unscrubMapFor(paper);   // un-scrub against the tags the AI actually saw
  const ph = placeholderAssigner(paper);
  let out = '';
  let pos = 0;
  for (const f of paper.findings) {
    out += paper.text.slice(pos, f.start);
    out += f.enabled ? ph(f) : paper.text.slice(f.start, f.end);
    pos = f.end;
  }
  return out + paper.text.slice(pos);
}

// ---------------------------------------------------------------- review view
function openReview(i) {
  current = i;
  const p = papers[current];
  const multi = papers.length > 1;
  els.btnBack.textContent = multi ? '← All papers' : '← Scrub another paper';
  els.crumb.textContent = multi ? `Paper ${current + 1} of ${papers.length} — ${p.name}` : (p.name || '');
  const next = papers.findIndex((q, j) => j > current && q.status === 'done');
  els.btnNext.hidden = !(multi && next !== -1);
  els.btnDownloadDocx.hidden = p.kind !== 'docx';
  els.ocrNote.hidden = !p.ocr;
  paperUnscrub.reset();   // fresh box per paper
  renderResults();
  showView('review');
}

function renderResults() {
  const p = papers[current];
  const ph = placeholderAssigner(p);
  const frag = document.createDocumentFragment();
  let pos = 0;
  for (const f of p.findings) {
    if (f.start > pos) frag.appendChild(document.createTextNode(p.text.slice(pos, f.start)));
    const original = p.text.slice(f.start, f.end);
    const mark = document.createElement('mark');
    mark.dataset.id = f.id;
    mark.setAttribute('role', 'button');   // clickable AND keyboard-toggleable
    mark.tabIndex = 0;
    if (f.enabled) {
      mark.className = `t-${f.type.toLowerCase()}`;
      mark.textContent = ph(f);
      mark.title = `Was: “${original}” — click to keep the original`;
      mark.setAttribute('aria-label', `${ph(f)} — was “${original}”. Press to keep the original.`);
    } else {
      mark.className = 'kept';
      mark.textContent = original;
      mark.title = `Detected as ${TYPES[f.type].title} — click to scrub it`;
      mark.setAttribute('aria-label', `${original} — kept. Detected as ${TYPES[f.type].title}; press to scrub it.`);
    }
    frag.appendChild(mark);
    pos = f.end;
  }
  frag.appendChild(document.createTextNode(p.text.slice(pos)));
  els.outputText.replaceChildren(frag);

  renderLegend();

  const n = p.findings.filter((f) => f.enabled).length;
  const kept = p.findings.length - n;
  els.summaryLine.textContent = p.findings.length === 0
    ? 'No personal information found 🎉'
    : n === 0
      ? `Found ${p.findings.length} personal detail${p.findings.length === 1 ? '' : 's'} — all kept as-is.`
      : `Replaced ${n} personal detail${n === 1 ? '' : 's'}${kept ? ` · ${kept} more underlined for your judgement` : ''}.`;

  paperUnscrub.render();   // keep the un-scrubbed preview in sync with toggles
}

function renderLegend() {
  const p = papers[current];
  const byType = {};
  for (const f of p.findings) {
    byType[f.type] ??= { total: 0, on: 0 };
    byType[f.type].total++;
    if (f.enabled) byType[f.type].on++;
  }
  const frag = document.createDocumentFragment();
  for (const type of Object.keys(TYPES)) {
    const c = byType[type];
    if (!c) continue;
    const label = document.createElement('label');
    if (c.on === 0) label.classList.add('off');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = c.on === c.total;
    box.addEventListener('change', () => {
      const turnOn = !(c.on === c.total);
      p.findings.forEach((f) => { if (f.type === type) f.enabled = turnOn; });
      renderResults();
    });
    const dot = document.createElement('span');
    dot.className = `dot t-${type.toLowerCase()}`;
    const txt = document.createElement('span');
    txt.textContent = `${TYPES[type].title} · ${c.on === c.total ? c.total : `${c.on}/${c.total}`}`;
    label.append(box, dot, txt);
    frag.appendChild(label);
  }
  els.legend.replaceChildren(frag);
}

// ---------------------------------------------------------------- un-scrub
// The other half of the workflow: the AI's feedback comes back full of
// [NAME 1] tags, and the teacher needs the real names in it before handing it
// to the student. The tag → original-word mapping never leaves this device.
function unscrubMapFor(paper) {
  const ph = placeholderAssigner(paper);
  const map = new Map();
  for (const f of paper.findings) {
    if (!f.enabled) continue;
    const tag = ph(f);
    if (!map.has(tag)) map.set(tag, paper.text.slice(f.start, f.end));
  }
  return map;
}

// one shared mapping for the whole batch — tags are batch-unique, so a reply
// about any paper (or several at once) resolves correctly
function unscrubMapAll() {
  const map = new Map();
  for (const q of papers) {
    if (q.status !== 'done') continue;
    for (const [tag, original] of (q.unscrubMap ?? unscrubMapFor(q))) {
      if (!map.has(tag)) map.set(tag, original);
    }
  }
  return map;
}

function copyToClipboard(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  });
}

function wireUnscrub(inEl, outEl, btnEl, getMap) {
  const label = btnEl.textContent;
  const render = () => {
    const raw = inEl.value;
    if (!raw.trim()) { outEl.hidden = true; btnEl.hidden = true; return; }
    let out = raw;
    for (const [tag, original] of getMap()) out = out.split(tag).join(original);
    outEl.textContent = out;
    outEl.hidden = false;
    btnEl.hidden = false;
  };
  inEl.addEventListener('input', render);
  btnEl.addEventListener('click', async () => {
    await copyToClipboard(outEl.textContent);
    btnEl.textContent = '✅ Copied!';
    setTimeout(() => { btnEl.textContent = label; }, 2000);
  });
  const reset = () => {
    inEl.value = '';
    outEl.textContent = '';
    outEl.hidden = true;
    btnEl.hidden = true;
  };
  return { render, reset };
}

const paperUnscrub = wireUnscrub(els.unscrubIn, els.unscrubOut, els.btnCopyUnscrub,
  () => (current >= 0 ? (papers[current].unscrubMap ?? unscrubMapFor(papers[current])) : new Map()));
const batchUnscrub = wireUnscrub(els.unscrubBatchIn, els.unscrubBatchOut, els.btnCopyUnscrubBatch, unscrubMapAll);

// ---------------------------------------------------------------- batch view
function renderBatchIfVisible() {
  if (!els.batchView.hidden) renderBatch();
}

function renderBatch() {
  const frag = document.createDocumentFragment();
  const nameOf = new Map(plannedNames().map(({ p, name }) => [p, name]));
  papers.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'batch-row';
    const icon = document.createElement('span');
    icon.className = 'b-icon';
    icon.textContent = { waiting: '⏳', scanning: '🔍', done: '✅', error: '⚠️' }[p.status];
    const main = document.createElement('div');
    main.className = 'b-main';
    const name = document.createElement('div');
    name.className = 'b-name';
    name.textContent = p.name;
    const sub = document.createElement('div');
    sub.className = 'b-sub' + (p.status === 'error' ? ' err' : '');
    const hits = p.findings.filter((f) => f.enabled).length;
    sub.textContent = {
      waiting: 'waiting its turn…',
      scanning: 'scrubbing now…',
      done: (hits ? `${hits} personal detail${hits === 1 ? '' : 's'} replaced` : 'nothing personal found')
        + (p.ocr ? ' · read from a photo — double-check it' : '')
        + (nameOf.has(p) ? ` · saves as ${nameOf.get(p)}` : ''),
      error: `couldn't read this file — ${p.error}`,
    }[p.status];
    main.append(name, sub);
    row.append(icon, main);

    if (p.status === 'done') {
      const actions = document.createElement('div');
      actions.className = 'b-actions';
      const review = document.createElement('button');
      review.className = 'btn secondary small';
      review.textContent = 'Check';
      review.title = 'Read this paper and fix anything the scrubber got wrong';
      review.addEventListener('click', () => openReview(i));
      const dl = document.createElement('button');
      dl.className = 'btn secondary small';
      dl.textContent = 'Save';
      dl.title = 'Download just this scrubbed paper';
      dl.addEventListener('click', () => downloadPaper(p, dl));
      actions.append(review, dl);
      row.append(actions);
    }
    frag.appendChild(row);
  });
  els.batchList.replaceChildren(frag);
}

// A file name is PII too: "Dalton Hall essay.docx" names the student to the AI
// just as loudly as the byline did. Safe names replace it with the same tag the
// paper already uses inside, so the teacher keeps a way to tell papers apart —
// and the key file below turns the tag back into a kid.
function safeNamesOn() {
  if (DESKTOP) return true;   // no choices in the desktop edition — always safe
  return els.safeNames ? els.safeNames.checked : true;
}

// Whose paper is this? The first name the scrubber found, which on a school
// assignment is the byline at the top. If the heuristic picks the teacher's
// name instead, the key file shows exactly what it chose, and the mapping is
// still one-to-one — annoying to read, never wrong.
function paperTag(p) {
  const f = p.findings?.find((x) => x.enabled && x.type === 'NAME');
  if (!f) return null;
  return placeholderAssigner(p)(f).replace(/[[\]]/g, '').trim().replace(/\s+/g, '-');
}

function outName(p, ext, seq) {
  if (!safeNamesOn()) {
    const base = (p.name || 'paper').replace(/\.[^.]+$/, '') || 'paper';
    return `${base}-scrubbed.${ext}`;
  }
  const n = String(seq ?? 1).padStart(2, '0');
  return `${paperTag(p) || `paper-${n}`}-scrubbed.${ext}`;
}

const KEY_FILE_NAME = 'WHO-IS-WHO — keep this, do not send it.txt';

// The tag→student mapping, written down. Two jobs: it tells the teacher whose
// paper NAME-4 is, and it makes the un-scrub round trip survive a closed tab —
// until now the mapping only existed in memory.
// One naming pass, used by both the zip and the key file — otherwise a
// collision rename in one place makes the key point at a file that isn't there.
function plannedNames() {
  const used = new Set();
  const plan = [];
  let seq = 0;
  for (const p of papers) {
    if (p.status !== 'done') continue;
    seq++;
    let name = outName(p, p.kind === 'docx' ? 'docx' : 'txt', seq);
    let n = 2;
    while (used.has(name)) name = name.replace(/(-scrubbed)/, `$1 (${n++})`);
    used.add(name);
    plan.push({ p, name });
  }
  return plan;
}

function buildKeyFile(plan = plannedNames()) {
  const out = [
    'PAPER SCRUBBER — YOUR KEY',
    '',
    'This file is the only thing linking the scrubbed papers back to your',
    'students. Keep it. Do NOT paste it into ChatGPT, Claude, or any other AI —',
    'that would undo the whole point of scrubbing them.',
    '',
    '='.repeat(66),
    '',
  ];
  plan.forEach(({ p, name }) => {
    out.push(name);
    out.push(`    originally: ${p.name || '(text you pasted in)'}`);
    const map = p.unscrubMap ?? unscrubMapFor(p);
    if (map.size) {
      out.push('');
      for (const [tag, original] of map) out.push(`    ${tag.padEnd(16)} = ${original}`);
    } else {
      out.push('    (nothing personal was found in this one)');
    }
    out.push('');
  });
  return out.join('\r\n');   // \r\n so Windows Notepad shows the line breaks
}

function saveBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

async function downloadPaper(p, btn) {
  const old = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const seq = papers.indexOf(p) + 1;
    if (p.kind === 'docx') saveBlob(await buildScrubbedDocx(p), outName(p, 'docx', seq));
    else saveBlob(new Blob([scrubbedPlainTextFor(p)], { type: 'text/plain;charset=utf-8' }), outName(p, 'txt', seq));
    if (btn) btn.textContent = 'Saved ✅';
  } catch (err) {
    // a swallowed failure here looks exactly like success: no file, no message,
    // and a teacher who thinks the paper is sitting in her Downloads folder
    console.error(err);
    if (btn) btn.textContent = '⚠️ failed';
    statusSurface().say(`Couldn't save ${p.name || 'that paper'}: ${err.message}. Try the Check screen and copy the text instead.`);
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 2200);
  }
}

async function buildAllZip() {
  const zip = new JSZip();
  const plan = plannedNames();
  for (const { p, name } of plan) {
    if (p.kind === 'docx') zip.file(name, await buildScrubbedDocx(p));
    else zip.file(name, scrubbedPlainTextFor(p));
  }
  // built last: scrubbedPlainTextFor/buildScrubbedDocx refresh each paper's
  // unscrubMap, so the key reflects exactly the tags in the files beside it
  zip.file(KEY_FILE_NAME, buildKeyFile(plan));
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------- events
function toggleMark(mark) {
  const p = papers[current];
  const f = p.findings.find((x) => x.id === Number(mark.dataset.id));
  if (!f) return;
  f.enabled = !f.enabled;
  renderResults();
  // renderResults rebuilds the marks, so put keyboard focus back where it was
  els.outputText.querySelector(`mark[data-id="${f.id}"]`)?.focus();
}
els.outputText.addEventListener('click', (e) => {
  const mark = e.target.closest('mark[data-id]');
  if (mark) toggleMark(mark);
});
els.outputText.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const mark = e.target.closest('mark[data-id]');
  if (!mark) return;
  e.preventDefault();   // Space must toggle, not scroll the page
  toggleMark(mark);
});

function updateScrubButton() {
  els.btnScrub.disabled = busy || els.paperText.value.trim().length === 0;
}
els.paperText.addEventListener('input', updateScrubButton);

els.btnSample.addEventListener('click', () => {
  if (busy) return;
  els.paperText.value = TOOL === 'deid' ? SAMPLE_DEID : SAMPLE;
  updateScrubButton();
  hideStatus();
  els.btnScrub.click();   // one click should show the whole magic trick
});

els.btnFile.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files.length) loadFiles(els.fileInput.files);
  els.fileInput.value = '';
});

// camera button — only on touch devices, where tapping it opens the camera
// (capture="environment"); a photographed typed page goes through OCR
if (window.matchMedia?.('(pointer: coarse)').matches) els.btnCamera.hidden = false;
els.btnCamera.addEventListener('click', () => els.cameraInput.click());
els.cameraInput.addEventListener('change', () => {
  if (els.cameraInput.files.length) loadFiles(els.cameraInput.files);
  els.cameraInput.value = '';
});

// whole-page drag & drop
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  e.preventDefault();
  if (++dragDepth === 1) document.body.classList.add('page-dragging');
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('page-dragging'); }
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('page-dragging');
  if (e.dataTransfer?.files?.length) loadFiles(e.dataTransfer.files);
});

els.btnScrub.addEventListener('click', async () => {
  if (busy || !els.paperText.value.trim()) return;
  papers = [{
    id: 'pasted', file: null, name: '', kind: 'text', status: 'waiting',
    text: els.paperText.value, docx: null, findings: [], error: null,
  }];
  current = -1;
  const started = await scrubPapers(papers);
  if (started && papers[0].status === 'done') {
    hideStatus();
    openReview(0);
  } else if (papers[0].status === 'error') {
    setStatus(`Something went wrong: ${papers[0].error}`, { error: true });
  }
});

els.btnBack.addEventListener('click', () => {
  if (papers.length > 1) { renderBatch(); showView('batch'); }
  else showView('input');
});
els.btnNext.addEventListener('click', () => {
  const next = papers.findIndex((q, j) => j > current && q.status === 'done');
  if (next !== -1) openReview(next);
});
els.btnBatchBack.addEventListener('click', () => {
  if (busy) return;
  papers = [];
  current = -1;
  hideStatus();
  showView('input');
});

els.btnCopy.addEventListener('click', async () => {
  const text = scrubbedPlainTextFor(papers[current]);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  els.btnCopy.textContent = '✅ Copied!';
  setTimeout(() => { els.btnCopy.textContent = '📋 Copy scrubbed text'; }, 2000);
});

els.btnDownloadTxt.addEventListener('click', () => {
  const p = papers[current];
  saveBlob(new Blob([scrubbedPlainTextFor(p)], { type: 'text/plain;charset=utf-8' }), outName(p, 'txt'));
  els.btnDownloadTxt.textContent = '✅ Saved!';
  setTimeout(() => { els.btnDownloadTxt.textContent = '⬇️ Save as .txt'; }, 2000);
});

els.btnDownloadDocx.addEventListener('click', async () => {
  const p = papers[current];
  els.btnDownloadDocx.disabled = true;
  els.btnDownloadDocx.textContent = 'Building…';
  try {
    saveBlob(await buildScrubbedDocx(p), outName(p, 'docx'));
    els.btnDownloadDocx.textContent = '✅ Saved!';
  } catch (err) {
    console.error(err);
    els.btnDownloadDocx.textContent = '⚠️ Failed — use Copy instead';
  } finally {
    setTimeout(() => {
      els.btnDownloadDocx.disabled = false;
      els.btnDownloadDocx.textContent = '⬇️ Download Word file';
    }, 2500);
  }
});

els.btnZip.addEventListener('click', async () => {
  els.btnZip.disabled = true;
  const old = els.btnZip.textContent;
  els.btnZip.textContent = 'Building the zip…';
  try {
    saveBlob(await buildAllZip(), 'scrubbed-papers.zip');
    els.btnZip.textContent = '✅ Saved to your Downloads folder';
  } catch (err) {
    console.error(err);
    els.btnZip.textContent = '⚠️ Something went wrong';
  } finally {
    setTimeout(() => { els.btnZip.textContent = old; els.btnZip.disabled = false; }, 3000);
  }
});

// install-as-app button — only appears when the browser says installing is
// possible (Chrome/Edge, not already installed). One click, desktop icon,
// works offline; no IT rights needed.
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  els.btnInstall.hidden = false;
});
els.btnInstall.addEventListener('click', async () => {
  const p = installPrompt;
  installPrompt = null;
  els.btnInstall.hidden = true;   // the saved prompt is single-use either way
  if (!p || typeof p.prompt !== 'function') return;
  try {
    p.prompt();
    await p.userChoice;
  } catch { /* teacher dismissed it — the browser menu can still install */ }
});
window.addEventListener('appinstalled', () => {
  installPrompt = null;
  els.btnInstall.hidden = true;
});

// help dialog — Escape closes it natively; clicking the backdrop closes too
// (the padded inner .help-body means content clicks never hit the dialog itself)
els.btnHelp.addEventListener('click', () => els.helpDialog.showModal());
els.btnHelpClose.addEventListener('click', () => els.helpDialog.close());
els.helpDialog.addEventListener('click', (e) => {
  if (e.target === els.helpDialog) els.helpDialog.close();
});

// safe-file-name preference — remembered per device, both checkboxes stay in sync
function setSafeNames(on) {
  for (const b of [els.safeNames, els.safeNamesBatch]) if (b) b.checked = on;
  try { localStorage.setItem(SAFENAMES_KEY, on ? '1' : '0'); } catch { /* private mode */ }
  renderBatchIfVisible();
}
for (const b of [els.safeNames, els.safeNamesBatch]) {
  if (b) b.addEventListener('change', () => setSafeNames(b.checked));
}

// ---------------------------------------------------------------- init
try {
  // default ON: a teacher who never finds the checkbox is still protected
  const saved = localStorage.getItem(SAFENAMES_KEY);
  for (const b of [els.safeNames, els.safeNamesBatch]) if (b) b.checked = saved !== '0';
  localStorage.removeItem('paperScrubber.roster');    // cleanup: roster feature removed
  localStorage.removeItem('paperScrubber.mode');      // cleanup: language toggle removed
  localStorage.removeItem('paperScrubber.deepCheck'); // cleanup: deep check moved to the De-Identifier
} catch { /* private mode */ }
updateScrubButton();

// Google Docs hand-off: the add-on passes the document in the URL fragment,
// which never leaves the browser — fragments aren't sent to any server, so
// the paper travels straight from the Doc to this tab. Runs at load AND on
// hashchange (the browser may hand a link to an already-open scrubber tab).
function handleGdocFragment() {
  const m = location.hash.match(/^#gdoc=([A-Za-z0-9\-_]+=*)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);   // keep the text out of the URL bar and history
  if (busy) return;   // mid-scrub of something else — the teacher can re-click the link
  try {
    const b64 = m[1].replace(/-/g, '+').replace(/_/g, '/');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const { t, x } = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof x !== 'string' || !x.trim()) return;
    papers = [{
      id: 'gdoc', file: null, name: typeof t === 'string' ? t : '', kind: 'text', status: 'waiting',
      text: x, docx: null, findings: [], error: null, ocr: false,
    }];
    current = -1;
    showView('input');
    setStatus(`Reading ${papers[0].name || 'your Google Doc'}…`);
    scrubPapers(papers).then((started) => {
      if (started && papers[0].status === 'done') { hideStatus(); openReview(0); }
      else if (papers[0]?.status === 'error') setStatus(`Something went wrong: ${papers[0].error}`, { error: true });
    });
  } catch { /* malformed fragment — just show the normal page */ }
}
window.addEventListener('hashchange', handleGdocFragment);
handleGdocFragment();

// ---------------------------------------------------------------- road-ready
// "Installed" only counts if it works in a building with no signal. This
// checks that every file a scrub needs — app, AI runtime, model, PDF & photo
// readers — is actually sitting in this device's cache, and says so.
const ROAD_CRITICAL = [
  './', './app.js', './styles.css', './labels.js', './sample.js',
  './vendor/transformers.min.js', './vendor/jszip.min.js',
  './vendor/ort-wasm-simd-threaded.asyncify.mjs', './vendor/ort-wasm-simd-threaded.asyncify.wasm',
  './vendor/pdf.min.mjs', './vendor/pdf.worker.min.mjs',
  './vendor/tesseract.esm.min.js', './vendor/tesseract-worker.min.js',
  './vendor/tesseract-core-simd-lstm.wasm.js', './vendor/eng.traineddata.gz',
  './models/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX/config.json',
  './models/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX/tokenizer.json',
  './models/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX/tokenizer_config.json',
  './models/onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX/onnx/model_quantized.onnx',
];

async function isRoadReady() {
  if (!('caches' in window) || !navigator.serviceWorker?.controller) return false;
  const need = [...ROAD_CRITICAL];
  if (deepCheckOn()) {
    // deep check enabled = its 553 MB of parts must be on the device too
    need.push('./deep-check-worker.mjs', './vendor/gliner-bundle.mjs',
      './vendor/gliner-ort/ort-wasm-simd-threaded.mjs', './vendor/gliner-ort/ort-wasm-simd-threaded.wasm',
      './models/onnx-community/gliner_multi_pii-v1/tokenizer.json');
    for (let i = 0; i < 7; i++) need.push(`./models/onnx-community/gliner_multi_pii-v1/onnx/model_fp16.onnx.part${String(i).padStart(2, '0')}`);
  }
  const hits = await Promise.all(
    need.map((u) => caches.match(new URL(u, document.baseURI).href).then((r) => !!r).catch(() => false)),
  );
  return hits.every(Boolean);
}

let roadPoll = null;
async function updateRoadReady() {
  const el = els.roadReady;
  if (!el) return;
  if (DESKTOP) {
    // nothing to download, nothing to wait for — the models ship in the bundle
    el.hidden = false;
    el.textContent = '✅ Everything runs inside this program, and everything identifying is removed automatically — names and details never reach the AI you paste into.';
    el.classList.add('ok');
    return;
  }
  if (await isRoadReady()) {
    el.hidden = false;
    el.textContent = '✅ Road-ready: everything is saved on this device — scrubbing works with no internet at all.';
    el.classList.add('ok');
    if (roadPoll) { clearInterval(roadPoll); roadPoll = null; }
  } else if (navigator.onLine) {
    el.hidden = false;
    el.textContent = '📶 Setting up for offline use in the background (~100 MB, one time). Stay online a few minutes — this line flips to road-ready by itself.';
    el.classList.remove('ok');
    if (!roadPoll) roadPoll = setInterval(updateRoadReady, 4000);
  }
}

// ---------------------------------------------------------------- desktop
if (DESKTOP) {
  document.body.classList.add('desktop');
  updateRoadReady();

  // this edition asks nothing and decides everything — the copy must match
  const steps = document.querySelectorAll('.steps li div');
  if (steps[1]) steps[1].innerHTML = '<strong>Everything identifying is removed</strong><span>Names, contacts, schools, family, health, activities — replaced automatically by two AIs.</span>';
  if (steps[2]) steps[2].innerHTML = '<strong>Save &amp; send</strong><span>The output carries tags, never identities. Paste the AI’s reply back here to restore the names.</span>';
  const reviewHint = document.querySelector('#resultsView .hint');
  if (reviewHint) reviewHint.innerHTML = 'Everything identifying was replaced automatically — there is nothing you have to do here. If it replaced something that isn’t about a person (a book title, a curriculum name), <strong>click it</strong> to restore just that word.';

  // files arriving from the scans-folder watcher or Finder's "Open With"
  window.deidDesktop.onFile(({ name, data }) => {
    loadFiles([new File([new Uint8Array(data)], name)]);
  });

  // "Watch a scans folder" — the desktop headline: point it at wherever the
  // office scanner drops files, and every new scan de-identifies itself
  const watchBtn = document.createElement('button');
  watchBtn.type = 'button';
  watchBtn.className = 'btn secondary';
  watchBtn.textContent = '📠 Watch a scans folder…';
  watchBtn.addEventListener('click', async () => {
    const dir = await window.deidDesktop.chooseInbox();
    if (dir) setStatus(`Watching ${dir} — every new scan that lands there will be de-identified automatically. Leave this window open.`);
  });
  els.btnFile.after(watchBtn);

  // web-only furniture has no meaning inside a program
  els.btnInstall?.remove();
}

if (!DESKTOP && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js')
    .then(() => updateRoadReady())
    .catch(() => { /* dev over plain http is fine */ });
  // When a newer version of the app installs, pick it up right away instead of
  // making the teacher visit twice. The `had a controller` guard keeps the very
  // first install (which claims an uncontrolled page) from triggering a reload.
  // Never reload while papers are loaded (scrubbing OR reviewing) — findings
  // live only in memory, so a reload would silently destroy the teacher's work;
  // they get the update on their next natural visit instead.
  let reloading = false;
  const hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || busy || papers.length) return;
    reloading = true;
    location.reload();
  });
}

// dev/testing hook (harmless in production)
window.__dev = {
  setText(t) { els.paperText.value = t; updateScrubButton(); },
  papers: () => papers,
  getFindings(i = current) {
    const p = papers[i];
    return p.findings.map((f) => ({
      type: f.type, text: p.text.slice(f.start, f.end),
      score: Number(f.score.toFixed(3)), source: f.source, enabled: f.enabled,
    }));
  },
  scrubbedPlainText: (i = current) => scrubbedPlainTextFor(papers[i]),
  buildDocxBlob: (i = current) => buildScrubbedDocx(papers[i]),
  buildAllZip,
  async loadUrls(urls) {
    const files = [];
    for (const u of urls) {
      const blob = await (await fetch(u)).blob();
      files.push(new File([blob], u.split('/').pop(), { type: blob.type }));
    }
    return loadFiles(files);
  },
};
