// Write every raw deep-check span of a bench run to CSV: document, label, start, end, score, text
import { readFileSync, writeFileSync } from 'node:fs';
const [inp, out] = process.argv.slice(2);
const r = JSON.parse(readFileSync(inp, 'utf8'));
const q = (s) => '"' + String(s).replace(/"/g, '""').replace(/\s+/g, ' ') + '"';
const rows = ['document,deep_seconds,label,start,end,score,text'];
for (const p of r.papers) for (const s of p.deep.spans) rows.push([q(p.name), (p.deep.ms / 1000).toFixed(1), q(s.label), s.start, s.end, s.score.toFixed(3), q(s.text)].join(','));
writeFileSync(out, rows.join('\n'));
console.log(out, rows.length - 1, 'spans');
