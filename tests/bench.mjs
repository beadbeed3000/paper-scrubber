// Benchmark + grade a running De-Identifier over CDP.
// One batch: every keyed .docx from every set. Captures, per document, the
// deep-check wall time (worker request -> result, model already warm) and every
// raw deep-check span, then grades the scrubbed text twice:
//   desktop semantics - everything detected is replaced
//   web semantics     - the web defaults (DEFAULT_KEPT categories stay underlined)
// Usage: node tests/bench.mjs <port> <label> <out.json> [--match /deid/] [--sets roberts,tuning,heldout] [--soft] [--no-reload]
// --soft reloads normally: a hard reload bypasses the web version's service worker.
import { connect } from './cdp.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const [port, label, outPath, ...flags] = process.argv.slice(2);
const matchIdx = flags.indexOf('--match');
const match = matchIdx >= 0 ? flags[matchIdx + 1] : '/deid/';
const here = (p) => new URL(p, import.meta.url);
const SETS = [
  { name: 'roberts', key: here('keys/roberts.json'), dir: here('files/roberts/') },
  { name: 'tuning', key: here('keys/tuning.json'), dir: here('files/tuning/') },
  { name: 'heldout', key: here('keys/heldout.json'), dir: here('files/heldout/') },
  // written 30 Sep 2026 by an agent that never saw the rules: the honest check
  ...(existsSync(here('keys/fresh.json')) ? [{ name: 'fresh', key: here('keys/fresh.json'), dir: here('files/fresh/') }] : []),
];
const setsIdx = flags.indexOf('--sets');
if (setsIdx >= 0) { const want = flags[setsIdx + 1].split(','); SETS.splice(0, SETS.length, ...SETS.filter((s) => want.includes(s.name))); }
const DEFAULT_KEPT = ['HEALTH', 'GRADE', 'FAMILY', 'CHURCH', 'WORK', 'ACTIVITY', 'BENEFIT'];   // app.js line 52

const docs = [];
for (const s of SETS) {
  const keys = JSON.parse(readFileSync(s.key, 'utf8'));
  const man = JSON.parse(readFileSync(new URL('manifest.json', s.dir), 'utf8')).filter((m) => keys.some((k) => k.key === m.key));
  for (const m of man) docs.push({ set: s.name, file: m.file, key: keys.find((k) => k.key === m.key), b64: readFileSync(new URL(encodeURIComponent(m.file), s.dir)).toString('base64') });
}

let c = await connect(Number(port), match);
if (!flags.includes('--no-reload')) {
  await c.send('Page.reload', { ignoreCache: !flags.includes('--soft') });
  c.close();
  await new Promise((r) => setTimeout(r, 3000));
  c = await connect(Number(port), match);
}
await c.waitFor(`!!(window.__dev && document.readyState === 'complete')`, 60000, 500);
const env = await c.evaluate(`({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, desktop: !!window.deidDesktop, cores: navigator.hardwareConcurrency, ua: navigator.userAgent, sw: !!navigator.serviceWorker?.controller })`);
env.workerSrc = await c.evaluate(`fetch('deep-check-worker.mjs', { cache: 'no-store' }).then(r => r.text()).then(t => t.length + ':' + t.split('\\n').slice(0, 1).join(''))`);
console.log(label, 'env', JSON.stringify(env));

// hook the deep-check worker: time every request and keep its raw spans
await c.evaluate(`(() => {
  if (window.__deepHook) return;
  window.__deepHook = true;
  window.__deepLog = [];
  const seen = new WeakSet();
  const orig = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (msg, ...rest) {
    if (msg && typeof msg === 'object' && typeof msg.text === 'string' && typeof msg.id === 'number') {
      if (!seen.has(this)) {
        seen.add(this);
        this.addEventListener('message', (e) => {
          const m = e.data, now = performance.now();
          const cur = window.__deepLog.find((x) => x.id === m.id && !x.t1) || window.__deepLog.find((x) => !x.t1);
          if (!cur) return;
          if (m.kind === 'progress') {
            cur.lastLabel = m.label;
            if (!cur.tFirstPart && /^Deep check/.test(m.label)) cur.tFirstPart = now;
            return;
          }
          cur.t1 = now; cur.kind = m.kind; cur.spans = m.spans; cur.message = m.message;
        });
      }
      window.__deepLog.push({ id: msg.id, chars: msg.text.length, t0: performance.now() });
    }
    return orig.call(this, msg, ...rest);
  };
})()`);

// warm-up: load both models so no document's time includes loading them
const tw = Date.now();
await c.evaluate(`window.__dev.setText('Jayden Combs is a 7th grader at Belfry Middle School with ADHD. He attends youth group at First Baptist Church and qualifies for free lunch. Call his mother Tammy at (606) 555-0142.'); document.getElementById('btnScrub').click();`);
await c.waitFor(`!document.getElementById('resultsView').hidden`, 900000, 1000);
const warm = await c.evaluate(`JSON.stringify(window.__deepLog[0])`);
console.log(label, 'warm-up (model load + first check)', Math.round((Date.now() - tw) / 1000), 's', warm.slice(0, 200));
await c.evaluate(`document.getElementById('btnBack').click()`);
await c.waitFor(`!document.getElementById('resultsView').hidden === false`, 10000, 300);
const warmCount = await c.evaluate(`window.__deepLog.length`);

// the batch
await c.evaluate(`(() => {
  const dt = new DataTransfer();
  for (const f of ${JSON.stringify(docs.map((d) => ({ name: d.file, b64: d.b64 })))}) {
    const bin = atob(f.b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    dt.items.add(new File([u], f.name, { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
  }
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
})()`);
const t0 = Date.now();
await c.waitFor(`(() => { const ps = window.__dev.papers(); return ps.length === ${docs.length} && ps.every(p => p.status === 'done' || p.status === 'error'); })()`, 6 * 3600000, 3000);
const batchSecs = Math.round((Date.now() - t0) / 1000);

const res = await c.evaluate(`(async () => {
  const KEPT = new Set(${JSON.stringify(DEFAULT_KEPT)});
  const ps = window.__dev.papers();
  const log = window.__deepLog.slice(${warmCount});
  const orig = ps.map((p) => p.findings.map((f) => f.enabled));
  const texts = { desktop: [], web: [] };
  for (const p of ps) for (const f of p.findings) f.enabled = true;
  ps.forEach((p, i) => texts.desktop.push(window.__dev.scrubbedPlainText(i)));
  const z = await JSZip.loadAsync(await window.__dev.buildAllZip());
  const inner = {};
  for (const n of Object.keys(z.files).filter(n => n.endsWith('.docx'))) {
    const d = await JSZip.loadAsync(await z.file(n).async('arraybuffer'));
    let s = ''; for (const m of Object.keys(d.files)) if (/\\.(xml|rels)$/.test(m)) s += await d.file(m).async('string');
    inner[n] = s;
  }
  for (const p of ps) for (const f of p.findings) f.enabled = !KEPT.has(f.type);
  ps.forEach((p, i) => texts.web.push(window.__dev.scrubbedPlainText(i)));
  ps.forEach((p, i) => p.findings.forEach((f, j) => { f.enabled = orig[i][j]; }));
  return {
    papers: ps.map((p, i) => ({
      name: p.name, status: p.status, error: p.error, deepFailed: !!p.deepFailed, chars: p.text.length, text: p.text,
      findings: p.findings.map((f) => ({ type: f.type, source: f.source, start: f.start, end: f.end, text: p.text.slice(f.start, f.end), score: +f.score.toFixed(3) })),
      deep: log[i] ? { ms: Math.round(log[i].t1 - log[i].t0), chars: log[i].chars, parts: +(String(log[i].lastLabel || '').match(/of (\\d+)/) || [0, 0])[1], kind: log[i].kind, spans: log[i].spans } : null,
    })),
    texts, entries: Object.keys(z.files), inner,
  };
})()`);

const count = (hay, needle) => { let n = 0, i = -1; while ((i = hay.indexOf(needle, i + 1)) !== -1) n++; return n; };
function grade(sem) {
  const per = [];
  for (let i = 0; i < res.papers.length; i++) {
    const p = res.papers[i], d = docs.find((x) => x.file === p.name), k = d.key, t = res.texts[sem][i];
    const idLeaks = k.identifiers.filter((x) => t.includes(x.text));
    const quasiLeft = k.quasi.filter((x) => t.includes(x.text));
    const keepLost = k.mustStayReadable.filter((w) => !t.includes(w));
    let occ = 0, occKept = 0;
    for (const w of k.mustStayReadable) { const a = count(p.text, w), b = count(t, w); occ += a; occKept += Math.min(a, b); }
    per.push({ set: d.set, doc: k.key, idTotal: k.identifiers.length, idLeaks: idLeaks.map((x) => x.category + ': ' + x.text), quasiTotal: k.quasi.length, quasiLeft: quasiLeft.map((x) => x.text), keepTotal: k.mustStayReadable.length, keepLost, keepOcc: occ, keepOccKept: occKept });
  }
  return per;
}
const graded = { desktop: grade('desktop'), web: grade('web') };
const names = docs.flatMap((d) => d.key.identifiers.filter((x) => /name|initial/.test(x.category) && x.text.length > 3).map((x) => x.text));
const fileNameLeaks = res.entries.filter((n) => names.some((s) => n.includes(s)));
const insideDocx = {};
for (const [n, s] of Object.entries(res.inner)) { const h = [...new Set(names.filter((w) => new RegExp('(?<![A-Za-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![A-Za-z])').test(s)))]; if (h.length) insideDocx[n] = h; }

const out = { label, env, batchSecs, graded, fileNameLeaks, insideDocx,
  papers: res.papers.map((p, i) => ({ ...p, desktopText: res.texts.desktop[i], webText: res.texts.web[i] })) };
writeFileSync(outPath, JSON.stringify(out, null, 1));

console.log(`${label}: batch ${batchSecs}s`);
for (const p of res.papers) console.log(`  ${p.name.slice(0, 44).padEnd(44)} ${String(p.chars).padStart(6)} ch  deep ${p.deep ? (p.deep.ms / 1000).toFixed(1).padStart(6) + 's  calls ' + String(p.deep.parts).padStart(4) + '  spans ' + String(p.deep.spans?.length).padStart(4) : 'none'}${p.deepFailed ? ' DEEP FAILED' : ''}${p.status !== 'done' ? ' ' + p.status + ' ' + p.error : ''}`);
for (const sem of ['desktop', 'web']) {
  for (const set of SETS.map((s) => s.name)) {
    const g = graded[sem].filter((x) => x.set === set);
    const s = (f) => g.reduce((a, x) => a + f(x), 0);
    console.log(`  [${sem.padEnd(7)}] ${set.padEnd(8)} leaks ${s((x) => x.idLeaks.length)}/${s((x) => x.idTotal)}  quasi removed ${s((x) => x.quasiTotal - x.quasiLeft.length)}/${s((x) => x.quasiTotal)}  readable kept ${s((x) => x.keepTotal - x.keepLost.length)}/${s((x) => x.keepTotal)} (occurrences ${s((x) => x.keepOccKept)}/${s((x) => x.keepOcc)})`);
  }
}
console.log('  file-name leaks:', JSON.stringify(fileNameLeaks), '| names inside rebuilt .docx:', JSON.stringify(insideDocx));
c.close();
