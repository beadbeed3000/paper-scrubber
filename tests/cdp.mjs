// Minimal Chrome DevTools Protocol client for driving the installed
// De-Identifier (Electron honors --remote-debugging-port). Node 24 has WebSocket.
import { writeFileSync } from 'node:fs';

export async function connect(port, match = '/deid/') {
  let targets = [];
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { targets = []; }
    if (targets.some((t) => t.type === 'page' && t.url.includes(match))) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const page = targets.find((t) => t.type === 'page' && t.url.includes(match));
  if (!page) throw new Error('no page target matching ' + match + ' — got ' + JSON.stringify(targets.map((t) => t.url)));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); }
    else if (d.method) events.push(d);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 600000 });
    if (r.exceptionDetails) throw new Error('page threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  };
  const screenshot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  };
  const waitFor = async (expression, ms = 600000, every = 1000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await evaluate(expression);
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for: ' + expression);
      await new Promise((r) => setTimeout(r, every));
    }
  };
  return { send, evaluate, screenshot, waitFor, events, url: page.url, close: () => ws.close() };
}
