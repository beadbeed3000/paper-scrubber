// CPU-profile the deep-check worker (and its thread-pool workers) while it
// checks one document, then print where the time went by function.
// Usage: node profile-deep.mjs <port> <textfile>
import { readFileSync } from 'node:fs';
const [port, textFile] = process.argv.slice(2);
const text = readFileSync(textFile, 'utf8');
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
const attached = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); return; }
  if (d.method === 'Target.attachedToTarget') {
    const { sessionId, targetInfo } = d.params;
    attached.push({ sessionId, parent: d.sessionId, url: targetInfo.url, type: targetInfo.type });
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
  }
};
function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
}
const timeout = (p, ms, what) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error(what + ' timed out')), ms))]);
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page' && t.url.includes('/deid/'));
const { sessionId: pageSession } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageSession);
for (let i = 0; i < 20 && !attached.some((a) => a.url.endsWith('deep-check-worker.mjs')); i++) await new Promise((r) => setTimeout(r, 500));
await new Promise((r) => setTimeout(r, 2000));
console.log('attached:', attached.map((a) => a.type + ' ' + a.url.replace(/^.*\//, '')).join(', '));
const deep = attached.find((a) => a.url.endsWith('deep-check-worker.mjs'));
const deepPool = attached.filter((a) => a.parent === deep?.sessionId);
if (!deep) throw new Error('no deep-check worker yet — run a scrub first');
const targets = [deep, ...deepPool];
for (const t of targets) {
  await timeout(send('Profiler.enable', {}, t.sessionId), 10000, 'enable');
  await send('Profiler.setSamplingInterval', { interval: 1000 }, t.sessionId);
  await timeout(send('Profiler.start', {}, t.sessionId), 10000, 'start');
}
const eval1 = (expr) => send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, pageSession);
const t0 = Date.now();
await eval1(`window.__dev.setText(${JSON.stringify(text)}); document.getElementById('btnScrub').click();`);
await eval1(`new Promise((res) => { const t = setInterval(() => { if (!document.getElementById('resultsView').hidden) { clearInterval(t); res(); } }, 300); })`);
console.log('scrub took', ((Date.now() - t0) / 1000).toFixed(1), 's;', deepPool.length, 'pool workers in the deep worker');
for (const t of targets) {
  const { profile } = await timeout(send('Profiler.stop', {}, t.sessionId), 30000, 'stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const dt = profile.timeDeltas;
  profile.samples.forEach((sid, i) => {
    const n = byId.get(sid);
    const name = n.callFrame.functionName || `(${n.callFrame.url.replace(/^.*\//, '') || 'anon'})`;
    self.set(name, (self.get(name) || 0) + (dt[i] || 0));
  });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const busy = [...self].filter(([k]) => k !== '(idle)' && k !== '(program)').reduce((a, [, v]) => a + v, 0);
  console.log(`\n== ${t === deep ? 'deep-check worker' : 'pool worker ' + t.sessionId.slice(0, 6)}: busy ${(busy / 1e6).toFixed(1)} s of ${(total / 1e6).toFixed(1)} s sampled`);
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, t === deep ? 25 : 6)) console.log(`   ${(100 * v / total).toFixed(1).padStart(5)}%  ${k.slice(0, 110)}`);
}
ws.close();
