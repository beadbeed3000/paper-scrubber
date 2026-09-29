import { readFileSync } from 'node:fs';
const [a, b] = process.argv.slice(2).map((f) => JSON.parse(readFileSync(f, 'utf8')));
for (const pa of a.papers) {
  const pb = b.papers.find((p) => p.name === pa.name);
  const k = (f) => `${f.type}|${f.start}|${f.end}|${f.source}`;
  const A = new Set(pa.findings.map(k)), B = new Set(pb.findings.map(k));
  const lost = pa.findings.filter((f) => !B.has(k(f))), gained = pb.findings.filter((f) => !A.has(k(f)));
  const same = pa.desktopText === pb.desktopText && pa.webText === pb.webText;
  console.log(`${pa.name.slice(0, 40).padEnd(40)} findings ${pa.findings.length} → ${pb.findings.length}  lost ${lost.length} gained ${gained.length}  output text identical: ${same}`);
  for (const f of lost) console.log(`    - ${f.type}/${f.source} "${f.text}"`);
  for (const f of gained) console.log(`    + ${f.type}/${f.source} "${f.text}"`);
}
