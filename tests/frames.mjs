// Open a URL in a new tab of the CDP browser and report every frame's isolation state.
const [port, url, waitMs = '8000'] = process.argv.slice(2);
const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } else events.push(d); };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
const { targetId } = await send('Target.createTarget', { url });
await new Promise((r) => setTimeout(r, Number(waitMs)));
const { targetInfos } = await send('Target.getTargets');
const mine = targetInfos.filter((t) => t.targetId === targetId || t.openerId === targetId || t.parentFrameId || (t.type === 'iframe'));
for (const t of targetInfos.filter((t) => t.type === 'page' || t.type === 'iframe')) {
  if (!(t.targetId === targetId || t.type === 'iframe')) continue;
  const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const r = await send('Runtime.evaluate', { expression: `JSON.stringify({ url: location.href, coi: self.crossOriginIsolated, dev: typeof window.__dev, controlled: !!navigator.serviceWorker?.controller, frames: [...document.querySelectorAll('iframe')].map(f => f.src) })`, returnByValue: true }, sessionId);
  console.log(t.type, r.result.value);
}
console.log('TARGET', targetId);
ws.close();
