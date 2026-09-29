// Regression sentences for the detection rules (rule-cases.json): each case
// says what must stay readable and what must be scrubbed, with every finding
// applied (desktop behavior). Runs each case through the live tool page.
// Usage: node tests/rule-cases.mjs [port=9334] [page-match=/deid/] [cases.json]
import { connect } from './cdp.mjs';
import { readFileSync } from 'node:fs';

const [port = '9334', match = '/deid/', file] = process.argv.slice(2);
const cases = JSON.parse(readFileSync(file || new URL('rule-cases.json', import.meta.url), 'utf8'));
const c = await connect(Number(port), match);
await c.waitFor(`!!(window.__dev && document.readyState === 'complete')`, 60000, 500);
console.log('tool:', await c.evaluate('document.body.dataset.tool || "scrubber"'));
let failed = 0;
for (const k of cases) {
  await c.evaluate(`(() => { document.getElementById('btnBack')?.click(); window.__dev.setText(${JSON.stringify(k.text)}); document.getElementById('btnScrub').click(); })()`);
  await new Promise((r) => setTimeout(r, 400));
  await c.waitFor(`!document.getElementById('resultsView').hidden && window.__dev.papers().every(p => p.status === 'done')`, 300000, 300);
  const r = JSON.parse(await c.evaluate(`(() => { const i = window.__dev.papers().length - 1; const p = window.__dev.papers()[i];
    p.findings.forEach((f) => { f.enabled = true; });
    return JSON.stringify({ out: window.__dev.scrubbedPlainText(i), f: window.__dev.getFindings(i).map((x) => x.source + ':' + x.type + '=' + x.text) }); })()`));
  const lost = (k.keep || []).filter((w) => !r.out.includes(w));
  const left = (k.scrub || []).filter((w) => r.out.includes(w));
  const ok = !lost.length && !left.length;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${k.why}`);
  if (!ok) {
    if (lost.length) console.log(`      should stay readable: ${lost.join(' | ')}`);
    if (left.length) console.log(`      should be scrubbed:   ${left.join(' | ')}`);
    console.log(`      output:   ${r.out.replace(/\n/g, ' / ')}`);
    console.log(`      findings: ${r.f.join(' | ')}`);
  }
}
console.log(`\n${cases.length - failed} of ${cases.length} cases pass`);
c.close();
process.exit(failed ? 1 : 0);
