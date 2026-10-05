// Compare two bench.mjs runs: deep-check time per document, graded totals under
// both semantics, and exactly what changed (new leaks, readable terms newly
// lost, quasi-identifiers newly left, name pieces, deep spans gained/lost).
// Usage: node compare.mjs <before.json> <after.json>
import { readFileSync, existsSync } from 'node:fs';

const [aPath, bPath] = process.argv.slice(2);
const A = JSON.parse(readFileSync(aPath, 'utf8')), B = JSON.parse(readFileSync(bPath, 'utf8'));
const keys = Object.fromEntries(['roberts', 'tuning', 'heldout', 'fresh', 'fresh2'].filter((f) => existsSync(new URL(`keys/${f}.json`, import.meta.url))).flatMap((f) => JSON.parse(readFileSync(new URL(`keys/${f}.json`, import.meta.url), 'utf8')).map((k) => [k.key, k])));

// piece-level name scoring (rescore.mjs): a person leaks if ANY piece of the name survives
const NOT_NAME = /^(?:Dr|Mr|Mrs|Ms|Miss|Coach|LPCC|CDCES|CCC|SLP|NCSP|OTR|MD|PhD|APRN|RN|BCBA|LCSW|MSW|EdS|Ed|DO|PA|NP|OT|PT|MA|MS|BS|The|And|Of|Papaw|Mamaw|Pawpaw|Mawmaw|Memaw|Aunt|Uncle|Granny|Grandma|Grandpa|Nana|Cousin|Brother|Sister|Pastor|ENT)$/;
const ORG = /\b(?:Pediatrics|Clinic|Counseling|Health|Hospital|Center|Medical|Services|Therapy|Associates|Care|Dental|Practice|Group|Family|Pharmacy|Rehab|Rehabilitation|Wellness|Behavioral|Psychology|Speech|Hearing)\b/;
const isPerson = (x) => /^name|^initials$/.test(x.category) || (x.category === 'clinic_or_doctor' && !ORG.test(x.text));
const survives = (t, w) => new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(t);
function pieceLeaks(k, t) {
  const out = [];
  for (const x of k.identifiers.filter(isPerson)) {
    if (t.includes(x.text)) { out.push(x.text + ' (whole)'); continue; }
    const pieces = x.text.split(/[^\p{L}'’]+/u).map((w) => w.replace(/['’]s?$/, '')).filter((w) => w.length >= 3 && /^\p{Lu}/u.test(w) && !NOT_NAME.test(w));
    const left = pieces.filter((w) => survives(t, w));
    if (left.length) out.push(`${x.text} → ${left.join(', ')}`);
  }
  return out;
}

const docOf = (run, name) => run.papers.find((p) => p.name === name);
console.log(`deep-check time per document: ${A.label} → ${B.label}`);
let ta = 0, tb = 0;
const setTimes = {};
for (const pa of A.papers) {
  const pb = docOf(B, pa.name);
  const g = A.graded.desktop.find((x, i) => A.papers[i].name === pa.name);
  const sa = pa.deep.ms / 1000, sb = pb.deep.ms / 1000;
  ta += sa; tb += sb;
  (setTimes[g.set] ??= [0, 0]); setTimes[g.set][0] += sa; setTimes[g.set][1] += sb;
  console.log(`  ${g.doc.padEnd(16)} ${String(pa.chars).padStart(6)} ch  ${sa.toFixed(1).padStart(6)}s (${String(pa.deep.parts).padStart(3)} calls) → ${sb.toFixed(1).padStart(6)}s (${String(pb.deep.parts).padStart(3)} calls)  ×${(sa / sb).toFixed(2)}`);
}
for (const [s, [x, y]] of Object.entries(setTimes)) console.log(`  set ${s.padEnd(8)} ${x.toFixed(0)}s → ${y.toFixed(0)}s  ×${(x / y).toFixed(2)}`);
console.log(`  ALL      ${ta.toFixed(0)}s → ${tb.toFixed(0)}s  ×${(ta / tb).toFixed(2)}   (batch wall ${A.batchSecs}s → ${B.batchSecs}s)`);

for (const sem of ['desktop', 'web']) {
  console.log(`\n[${sem} semantics]`);
  const tot = (run) => {
    const r = {};
    run.graded[sem].forEach((g, i) => {
      const p = run.papers[i], t = sem === 'desktop' ? p.desktopText : p.webText;
      const s = (r[g.set] ??= { leaks: 0, ids: 0, quasiRemoved: 0, quasi: 0, keep: 0, keepTotal: 0, occ: 0, occTotal: 0, people: 0, peopleLeak: 0 });
      s.leaks += g.idLeaks.length; s.ids += g.idTotal; s.quasiRemoved += g.quasiTotal - g.quasiLeft.length; s.quasi += g.quasiTotal;
      s.keep += g.keepTotal - g.keepLost.length; s.keepTotal += g.keepTotal; s.occ += g.keepOccKept; s.occTotal += g.keepOcc;
      const k = keys[g.doc]; s.people += k.identifiers.filter(isPerson).length; s.peopleLeak += pieceLeaks(k, t).length;
    });
    return r;
  };
  const ra = tot(A), rb = tot(B);
  for (const set of Object.keys(ra)) {
    const a = ra[set], b = rb[set];
    console.log(`  ${set.padEnd(8)} leaks ${a.leaks}/${a.ids} → ${b.leaks}/${b.ids} | people w/ a name piece left ${a.peopleLeak}/${a.people} → ${b.peopleLeak}/${b.people} | quasi removed ${a.quasiRemoved}/${a.quasi} → ${b.quasiRemoved}/${b.quasi} | readable ${a.keep}/${a.keepTotal} → ${b.keep}/${b.keepTotal} (occ ${a.occ}/${a.occTotal} → ${b.occ}/${b.occTotal})`);
  }
  A.graded[sem].forEach((ga, i) => {
    const gb = B.graded[sem][B.papers.findIndex((p) => p.name === A.papers[i].name)];
    const pa = A.papers[i], pb = docOf(B, pa.name);
    const ta2 = sem === 'desktop' ? pa.desktopText : pa.webText, tb2 = sem === 'desktop' ? pb.desktopText : pb.webText;
    const k = keys[ga.doc];
    const diff = (x, y) => y.filter((v) => !x.includes(v));
    const lines = [];
    const nl = diff(ga.idLeaks, gb.idLeaks), fl = diff(gb.idLeaks, ga.idLeaks);
    if (nl.length) lines.push('NEW LEAKS: ' + nl.join(' | '));
    if (fl.length) lines.push('leaks fixed: ' + fl.join(' | '));
    const pl = diff(pieceLeaks(k, ta2), pieceLeaks(k, tb2)), pf = diff(pieceLeaks(k, tb2), pieceLeaks(k, ta2));
    if (pl.length) lines.push('NEW NAME PIECES LEFT: ' + pl.join(' | '));
    if (pf.length) lines.push('name pieces fixed: ' + pf.join(' | '));
    const ql = diff(ga.quasiLeft, gb.quasiLeft), qf = diff(gb.quasiLeft, ga.quasiLeft);
    if (ql.length) lines.push('QUASI NEWLY LEFT: ' + ql.join(' | '));
    if (qf.length) lines.push('quasi newly removed: ' + qf.join(' | '));
    const kl = diff(ga.keepLost, gb.keepLost), kf = diff(gb.keepLost, ga.keepLost);
    if (kl.length) lines.push('READABLE NEWLY LOST: ' + kl.join(' | '));
    if (kf.length) lines.push('readable newly kept: ' + kf.join(' | '));
    if (ga.keepOccKept !== gb.keepOccKept) lines.push(`readable occurrences ${ga.keepOccKept} → ${gb.keepOccKept}`);
    if (lines.length) console.log(`  ${ga.doc}:\n    ` + lines.join('\n    '));
  });
}

console.log('\n[deep spans]');
for (const pa of A.papers) {
  const pb = docOf(B, pa.name);
  const key = (s) => `${s.label}|${s.start}|${s.end}`;
  const sa = new Map(pa.deep.spans.map((s) => [key(s), s])), sb = new Map(pb.deep.spans.map((s) => [key(s), s]));
  const lost = [...sa.values()].filter((s) => !sb.has(key(s))), gained = [...sb.values()].filter((s) => !sa.has(key(s)));
  let maxd = 0;
  for (const [k2, s] of sa) if (sb.has(k2)) maxd = Math.max(maxd, Math.abs(s.score - sb.get(k2).score));
  const g = A.graded.desktop[A.papers.indexOf(pa)];
  console.log(`  ${g.doc.padEnd(16)} ${pa.deep.spans.length} → ${pb.deep.spans.length} spans, same ${pa.deep.spans.length - lost.length}, lost ${lost.length}, gained ${gained.length}, max score shift on shared ${maxd.toFixed(4)}`);
  const show = (arr) => arr.slice(0, 40).map((s) => `${s.label}:"${s.text}"(${s.score.toFixed(2)})`).join(', ');
  if (lost.length) console.log(`    lost:   ${show(lost)}`);
  if (gained.length) console.log(`    gained: ${show(gained)}`);
}
