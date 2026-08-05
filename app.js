// Paper Scrubber v2 — on-device PII removal for student papers.
// All inference happens in the browser via transformers.js + ONNX Runtime WASM.
// .docx files are edited in place (only the text inside <w:t> nodes changes),
// so the scrubbed Word file keeps all original formatting.

import { pipeline, env } from './vendor/transformers.min.js';
import { TYPES, LABEL_TO_TYPE } from './labels.js';
import { SAMPLE } from './sample.js';

env.allowLocalModels = false;          // fetch models from the HF hub (cached by the browser)
// absolute URL so it resolves the same from the page and from inside the library
env.backends.onnx.wasm.wasmPaths = new URL('vendor/', document.baseURI).href;

const MODELS = {
  fast: {
    id: 'onnx-community/distilbert_finetuned_ai4privacy_v2-ONNX',
    dtype: 'q8', chunkChars: 1300, sizeMB: 64, label: 'English',
  },
  max: {
    id: 'onnx-community/multilang-pii-ner-ONNX',
    dtype: 'q8', chunkChars: 1300, sizeMB: 266, label: 'multilingual',
  },
};

const SPECIAL_TOKENS = new Set(['[CLS]', '[SEP]', '[PAD]', '[MASK]', '[UNK]', '<s>', '</s>', '<pad>', '<unk>', '<mask>']);
const SCORE_THRESHOLD = 0.4;
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MODE_KEY = 'paperScrubber.mode';

const REGEX_RULES = [
  { type: 'EMAIL', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { type: 'PHONE', re: /(?:\+?1[\s.\-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.\-])\d{3}[\s.\-]\d{4}(?!\d)/g },
  { type: 'SSN',   re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // school names — the models have no "school" label, so catch the common shapes
  { type: 'ORG',   re: /\b(?:[A-Z][A-Za-z'’\-]+ ){1,4}(?:Elementary|Middle|High|Academy|University|College)(?: School)?\b|\b(?:[A-Z][A-Za-z'’\-]+ ){1,4}School\b/g },
];

// ---------------------------------------------------------------- state
const pipes = {};
let papers = [];      // [{id, name, kind:'text'|'docx', file, docx, text, findings, status, error}]
let current = -1;     // index of the paper open in the review view
let busy = false;

// ---------------------------------------------------------------- dom
const $ = (id) => document.getElementById(id);
const els = {
  inputView: $('inputView'), batchView: $('batchView'), resultsView: $('resultsView'),
  paperText: $('paperText'),
  btnFile: $('btnFile'), btnSample: $('btnSample'), fileInput: $('fileInput'),
  btnScrub: $('btnScrub'), statusArea: $('statusArea'), statusText: $('statusText'),
  progressWrap: $('progressWrap'), progressBar: $('progressBar'),
  btnBatchBack: $('btnBatchBack'), batchTitle: $('batchTitle'), batchStatus: $('batchStatus'),
  batchProgressWrap: $('batchProgressWrap'), batchProgressBar: $('batchProgressBar'),
  batchList: $('batchList'), btnZip: $('btnZip'),
  btnBack: $('btnBack'), btnNext: $('btnNext'), crumb: $('crumb'),
  summaryLine: $('summaryLine'), legend: $('legend'), outputText: $('outputText'),
  btnCopy: $('btnCopy'), btnDownloadTxt: $('btnDownloadTxt'), btnDownloadDocx: $('btnDownloadDocx'),
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
async function getPipe(modeKey, ui) {
  if (pipes[modeKey]) return pipes[modeKey];
  const cfg = MODELS[modeKey];
  let sawDownload = false;
  const progress_callback = (e) => {
    if (e.status === 'progress' && typeof e.progress === 'number' && String(e.file || '').endsWith('.onnx')) {
      sawDownload = true;
      const mb = (n) => Math.round(n / 1048576);
      ui.say(`Downloading the ${cfg.label} scrubber — ${mb(e.loaded)} of ${mb(e.total)} MB. This happens once; after this it's saved on this device.`);
      ui.bar(e.progress);
    }
  };
  ui.say(`Getting the ${cfg.label} scrubber ready…`);
  pipes[modeKey] = pipeline('token-classification', cfg.id, { dtype: cfg.dtype, progress_callback })
    .then((p) => {
      if (sawDownload) ui.say('Saved! Loading it into memory…');
      return p;
    })
    .catch((err) => { delete pipes[modeKey]; throw err; });
  return pipes[modeKey];
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
// token in the chunk with a forward-moving cursor (case-insensitive).
function mapTokens(chunkStr, tokens) {
  const lower = chunkStr.toLowerCase();
  let cursor = 0;
  return tokens.map((t) => {
    if (Number.isFinite(t.start) && Number.isFinite(t.end) && t.end > t.start) {
      cursor = Math.max(cursor, t.end);
      return { start: t.start, end: t.end };
    }
    const w = String(t.word ?? '').replace(/^##/, '').replace(/^[▁Ġ]+/, '').trim();
    if (!w || SPECIAL_TOKENS.has(w)) return null;
    const idx = lower.indexOf(w.toLowerCase(), cursor);
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
  const ok = (ch) => (loose ? /[^\s()[\]{}<>,;:"']/ : /[A-Za-z0-9'’\-]/).test(ch);
  while (ent.start > 0 && ok(text[ent.start - 1])) ent.start--;
  while (ent.end < text.length && ok(text[ent.end])) ent.end++;
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
    if (last && last.type === f.type && /^[ \t.,'’\-]{0,3}$/.test(text.slice(last.end, f.start))) {
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
    if (!['NAME', 'ADDRESS', 'ORG'].includes(f.type)) continue;
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
      const m = text.slice(f.end).match(/^ ([A-Za-z'’.\-]+)/);
      if (!m) break;
      const word = m[1];
      const isCap = /^[A-Z][a-z'’\-]+\.?$/.test(word);
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
    for (const w of text.slice(f.start, f.end).split(/[^A-Za-z'’\-]+/)) {
      const clean = w.replace(/[’']s$/i, '');
      if (clean.length >= 3 && /^[A-Z]/.test(clean) && !HONORIFICS.has(clean.toLowerCase())) words.add(clean);
    }
  }
  const extra = [];
  for (const w of words) {
    const re = new RegExp(`\\b${escapeRe(w)}\\b`, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const covered = list.some((f) => m.index < f.end && m.index + w.length > f.start);
      if (!covered) extra.push({ type: 'NAME', start: m.index, end: m.index + w.length, score: 0.99, source: 'echo' });
    }
  }
  return extra;
}

// ---------------------------------------------------------------- detection
async function detectText(text, modeKey, ui, paperName = '') {
  const cfg = MODELS[modeKey];
  const pipe = await getPipe(modeKey, ui);
  const chunks = chunkText(text, cfg.chunkChars);
  const raw = [];

  for (let i = 0; i < chunks.length; i++) {
    const who = paperName ? `${paperName} — ` : '';
    ui.say(`Scanning ${who}part ${i + 1} of ${chunks.length}`);
    const out = await pipe(chunks[i].text, { ignore_labels: [] });
    const tokens = out.filter((t) => !SPECIAL_TOKENS.has(String(t.word ?? '').trim()));
    const spans = mapTokens(chunks[i].text, tokens);
    for (const e of collectEntities(tokens, spans, chunks[i].text)) {
      const score = e.scores.reduce((a, b) => a + b, 0) / e.scores.length;
      if (score < SCORE_THRESHOLD) continue;
      raw.push({ type: e.type, start: e.start + chunks[i].start, end: e.end + chunks[i].start, score, source: 'model' });
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
  return list.map((f, i) => ({ ...f, id: i, enabled: true }));
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
      if (el.localName === 't') {
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
  return paper.docx.zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: DOCX_MIME });
}

// ---------------------------------------------------------------- papers
function newPaper(file) {
  return {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())),
    file, name: file.name,
    kind: file.name.toLowerCase().endsWith('.docx') ? 'docx' : 'text',
    status: 'waiting', text: '', docx: null, findings: [], error: null,
  };
}

async function loadPaperContent(p) {
  if (p.kind === 'docx') {
    p.docx = await parseDocx(await p.file.arrayBuffer());
    p.text = p.docx.fullText;
  } else {
    p.text = await p.file.text();
  }
  if (!p.text.trim()) throw new Error('the file appears to be empty');
}

function currentMode() {
  return document.querySelector('input[name="mode"]:checked')?.value ?? 'fast';
}

async function scrubPapers(list) {
  busy = true;
  els.btnScrub.disabled = true;
  const ui = statusSurface();
  const mode = currentMode();
  try {
    await getPipe(mode, ui);
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
      if (!p.text) await loadPaperContent(p);
      p.findings = await detectText(p.text, mode, statusSurface(), list.length > 1 ? p.name : '');
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
  const ok = all.filter((f) => /\.(docx|txt|md|text)$/i.test(f.name));
  const skipped = all.filter((f) => !ok.includes(f));
  if (!ok.length) {
    showView('input');
    const hasOldDoc = skipped.some((f) => /\.doc$/i.test(f.name));
    setStatus(hasOldDoc
      ? 'That\'s an old-style .doc file. Open it in Word, use “Save As → .docx”, then try again.'
      : 'Please use Word (.docx) or plain text (.txt) files.', { error: true });
    return;
  }
  papers = ok.sort((a, b) => a.name.localeCompare(b.name)).map(newPaper);
  current = -1;

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
    renderBatch();
    await scrubPapers(papers);
    const good = papers.filter((p) => p.status === 'done').length;
    const bad = papers.length - good;
    els.batchTitle.textContent = good === papers.length
      ? `Done — all ${good} papers are scrubbed ✅`
      : `${good} of ${papers.length} papers scrubbed`;
    statusSurface().say(good
      ? `Every paper was scrubbed separately.${bad ? ` ${bad} couldn't be read — see below.` : ''} Check any one you want with the Check button, then get them all with the green button at the bottom.`
      : 'None of these files could be read. They need to be Word (.docx) or plain text (.txt).');
    statusSurface().barOff();
    els.btnZip.disabled = good === 0;
    els.btnZip.textContent = `⬇️ Download all ${good} scrubbed paper${good === 1 ? '' : 's'} (one .zip)`;
  }
  if (skipped.length) {
    statusSurface().say(`Skipped ${skipped.length} file${skipped.length === 1 ? '' : 's'} (only .docx and .txt work): ${skipped.map((f) => f.name).join(', ')}`);
  }
}

// ---------------------------------------------------------------- placeholders
function placeholderAssigner(paper) {
  const enabled = paper.findings.filter((f) => f.enabled);
  const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?]+$/, '').trim();
  const seen = {};
  const byId = {};
  for (const f of enabled) {
    const key = norm(paper.text.slice(f.start, f.end));
    seen[f.type] ??= new Map();
    if (!seen[f.type].has(key)) seen[f.type].set(key, seen[f.type].size + 1);
    byId[f.id] = seen[f.type].get(key);
  }
  return (f) => {
    const multi = (seen[f.type]?.size ?? 0) > 1;
    return `[${TYPES[f.type].ph}${multi ? ' ' + byId[f.id] : ''}]`;
  };
}

function scrubbedPlainTextFor(paper) {
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
    if (f.enabled) {
      mark.className = `t-${f.type.toLowerCase()}`;
      mark.textContent = ph(f);
      mark.title = `Was: “${original}” — click to keep the original`;
    } else {
      mark.className = 'kept';
      mark.textContent = original;
      mark.title = `Detected as ${TYPES[f.type].title} — click to scrub it`;
    }
    frag.appendChild(mark);
    pos = f.end;
  }
  frag.appendChild(document.createTextNode(p.text.slice(pos)));
  els.outputText.replaceChildren(frag);

  renderLegend();

  const n = p.findings.filter((f) => f.enabled).length;
  els.summaryLine.textContent = p.findings.length === 0
    ? 'No personal information found 🎉'
    : n === 0
      ? `Found ${p.findings.length} personal detail${p.findings.length === 1 ? '' : 's'} — all kept as-is.`
      : `Replaced ${n} personal detail${n === 1 ? '' : 's'}.`;
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

// ---------------------------------------------------------------- batch view
function renderBatch() {
  const frag = document.createDocumentFragment();
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
      done: hits ? `${hits} personal detail${hits === 1 ? '' : 's'} replaced` : 'nothing personal found',
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

function outName(p, ext) {
  const base = (p.name || 'paper').replace(/\.[^.]+$/, '') || 'paper';
  return `${base}-scrubbed.${ext}`;
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
    if (p.kind === 'docx') saveBlob(await buildScrubbedDocx(p), outName(p, 'docx'));
    else saveBlob(new Blob([scrubbedPlainTextFor(p)], { type: 'text/plain;charset=utf-8' }), outName(p, 'txt'));
    if (btn) btn.textContent = 'Saved ✅';
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; btn.textContent = old; }, 1800);
  }
}

async function buildAllZip() {
  const zip = new JSZip();
  const used = new Set();
  for (const p of papers) {
    if (p.status !== 'done') continue;
    let name = outName(p, p.kind === 'docx' ? 'docx' : 'txt');
    let n = 2;
    while (used.has(name)) name = name.replace(/(-scrubbed)/, `$1 (${n++})`);
    used.add(name);
    if (p.kind === 'docx') zip.file(name, await buildScrubbedDocx(p));
    else zip.file(name, scrubbedPlainTextFor(p));
  }
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

// ---------------------------------------------------------------- events
els.outputText.addEventListener('click', (e) => {
  const mark = e.target.closest('mark[data-id]');
  if (!mark) return;
  const p = papers[current];
  const f = p.findings.find((x) => x.id === Number(mark.dataset.id));
  if (f) { f.enabled = !f.enabled; renderResults(); }
});

function updateScrubButton() {
  els.btnScrub.disabled = busy || els.paperText.value.trim().length === 0;
}
els.paperText.addEventListener('input', updateScrubButton);

els.btnSample.addEventListener('click', () => {
  els.paperText.value = SAMPLE;
  updateScrubButton();
  hideStatus();
});

els.btnFile.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', () => {
  if (els.fileInput.files.length) loadFiles(els.fileInput.files);
  els.fileInput.value = '';
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

// mode persistence
document.querySelectorAll('input[name="mode"]').forEach((r) =>
  r.addEventListener('change', () => { try { localStorage.setItem(MODE_KEY, currentMode()); } catch { } }));

// ---------------------------------------------------------------- init
try {
  if (localStorage.getItem(MODE_KEY) === 'max') $('modeMax').checked = true;
  localStorage.removeItem('paperScrubber.roster');   // cleanup: roster feature removed
} catch { /* private mode */ }
updateScrubButton();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* dev over plain http is fine */ });
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
