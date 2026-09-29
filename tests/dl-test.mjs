// A Save click (blob + download attribute, as saveBlob does) must still become a
// download, not be swallowed by the navigation guard. The download is caught in
// the main process and cancelled, so no dialog appears.
import { connect } from './cdp.mjs';
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const mws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r, j) => { mws.onopen = r; mws.onerror = j; });
let mid = 0; const mp = new Map();
mws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && mp.has(d.id)) { mp.get(d.id)(d.result); mp.delete(d.id); } };
const mainEval = (expression) => new Promise((res) => { const i = ++mid; mp.set(i, res); mws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true } })); });
const hook = (await mainEval(`(() => { const { session } = require('electron'); globalThis.__dl = []; session.defaultSession.once('will-download', (e, item) => { globalThis.__dl.push(item.getFilename()); e.preventDefault(); }); globalThis.__opened.length = 0; return 'ok'; })()`)).result;
if (hook.value !== 'ok') { console.log('hook failed', JSON.stringify(hook)); process.exit(1); }
const c = await connect(9334);
await c.evaluate(`(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['test'], { type: 'text/plain' })); a.download = 'NAME-1-scrubbed.txt'; document.body.append(a); a.click(); a.remove(); })()`);
await new Promise((r) => setTimeout(r, 1500));
console.log(JSON.stringify({ downloadStarted: (await mainEval('globalThis.__dl')).result.value, handedToBrowser: (await mainEval('globalThis.__opened')).result.value, windowAt: await c.evaluate('location.pathname') }));
c.close(); mws.close();
