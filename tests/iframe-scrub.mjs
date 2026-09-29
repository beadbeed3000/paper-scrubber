// Open the cross-site parent page, then scrub inside each embedded tool (the iframes).
const port = 9335;
const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } };
const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
const ev = async (s, expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, s); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const { targetId } = await send('Target.createTarget', { url: 'http://127.0.0.1:8141/' });
await new Promise((r) => setTimeout(r, 9000));
const text = 'Jayden Combs is a 7th grader at Belfry Middle School with ADHD. He attends youth group at First Baptist Church. Call his mother Tammy at (606) 555-0142.';
for (const round of [1, 2]) {   // round 2 = after the embedded pages reload under their service worker
  const { targetInfos } = await send('Target.getTargets');
  for (const t of targetInfos.filter((t) => t.type === 'iframe' && t.url.includes('localhost:8140'))) {
    const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
    for (let i = 0; i < 60 && !(await ev(sessionId, `!!(window.__dev && document.readyState === 'complete')`)); i++) await new Promise((r) => setTimeout(r, 500));
    await ev(sessionId, `(() => { document.getElementById('btnBack')?.click(); window.__dev.setText(${JSON.stringify(text)}); document.getElementById('btnScrub').click(); })()`);
    const t0 = Date.now();
    for (;;) { if (await ev(sessionId, `!document.getElementById('resultsView').hidden`)) break; if (Date.now() - t0 > 300000) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 500)); }
    const r = await ev(sessionId, `JSON.stringify({ tool: document.body.dataset.tool || 'scrubber', coi: self.crossOriginIsolated, controlled: !!navigator.serviceWorker.controller, findings: window.__dev.getFindings().length, deep: window.__dev.getFindings().filter(f => f.source === 'deep').length, deepFailed: !!window.__dev.papers()[0].deepFailed, out: window.__dev.scrubbedPlainText().slice(0, 90) })`);
    console.log(`round ${round} ${t.url.replace('http://localhost:8140', '')}: ${r} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
  if (round === 1) { await send('Page.reload', {}, (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId); await new Promise((r) => setTimeout(r, 9000)); }
}
await send('Target.closeTarget', { targetId });
ws.close();
