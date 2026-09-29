// List every worker under the tool's page (recursively — ORT's thread pool
// lives in workers nested inside the deep-check worker) and ask each one
// whether it is cross-origin isolated.
// Usage: node threads.mjs <port> [match]
const [port, match = '/deid/'] = process.argv.slice(2);
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
    attached.push({ sessionId, parent: d.sessionId, type: targetInfo.type, url: targetInfo.url, title: targetInfo.title });
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
    send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
  }
};
function send(method, params = {}, sessionId) {
  return new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
}
const { targetInfos } = await send('Target.getTargets');
const page = targetInfos.find((t) => t.type === 'page' && t.url.includes(match));
const { sessionId } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
const pageInfo = await send('Runtime.evaluate', { expression: `JSON.stringify({ url: location.href, coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, cores: navigator.hardwareConcurrency })`, returnByValue: true }, sessionId);
await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);
await new Promise((r) => setTimeout(r, 2500));
console.log('page', pageInfo.result.value);
for (const a of attached) {
  let v = '?';
  try {
    v = (await Promise.race([send('Runtime.evaluate', { expression: `JSON.stringify({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, name: self.name })`, returnByValue: true }, a.sessionId), new Promise((_, j) => setTimeout(() => j(new Error('busy (no answer in 4 s)')), 4000))])).result.value;
  } catch (e) { v = 'eval failed: ' + e.message; }
  const parent = attached.find((x) => x.sessionId === a.parent);
  console.log(`  ${a.type} ${a.url.replace(/^.*\//, '')} ${v}  (inside: ${parent ? parent.url.replace(/^.*\//, '') : 'page'})`);
}
const byParent = {};
for (const a of attached) byParent[a.parent] = (byParent[a.parent] || 0) + 1;
for (const a of attached.filter((x) => x.parent === sessionId)) console.log(`workers inside ${a.url.replace(/^.*\//, '')}: ${byParent[a.sessionId] || 0}`);
ws.close();
