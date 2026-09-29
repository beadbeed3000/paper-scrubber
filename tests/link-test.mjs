// Desktop link handling: stub shell.openExternal in the main process, click
// every link in the footer (and the privacy link up top), and confirm the
// window never leaves the tool while each link is handed to the browser.
import { connect } from './cdp.mjs';
const list = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const mws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((r, j) => { mws.onopen = r; mws.onerror = j; });
let mid = 0; const mp = new Map();
mws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && mp.has(d.id)) { mp.get(d.id)(d.result); mp.delete(d.id); } };
const mainEval = (expression) => new Promise((res) => { const i = ++mid; mp.set(i, res); mws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true, includeCommandLineAPI: true } })); });
const stub = (await mainEval(`(() => { const { shell } = require('electron'); globalThis.__opened = []; shell.openExternal = async (u) => { globalThis.__opened.push(u); }; return 'ok'; })()`)).result;
console.log('stub:', JSON.stringify(stub));
if (stub.value !== 'ok') { console.log('stub failed — not clicking anything'); process.exit(1); }

const c = await connect(9334);
await c.waitFor(`!!(window.__dev && document.readyState === 'complete')`, 60000, 500);
const state = await c.evaluate(`JSON.stringify({ getProgram: !!document.querySelector('.get-program'), footerLinks: [...document.querySelectorAll('footer a')].map(a => a.getAttribute('href')), privacyTop: document.querySelector('.trust-note a')?.getAttribute('href') })`);
console.log('page:', state);
const links = await c.evaluate(`[...document.querySelectorAll('footer a, .trust-note a')].length`);
for (let i = 0; i < links; i++) {
  const href = await c.evaluate(`(() => { const a = [...document.querySelectorAll('footer a, .trust-note a')][${i}]; a.click(); return a.getAttribute('href') + (a.target ? ' [target=' + a.target + ']' : ''); })()`);
  await new Promise((r) => setTimeout(r, 700));
  const where = await c.evaluate('location.pathname').catch((e) => 'eval failed: ' + e.message);
  console.log(`clicked ${href.padEnd(75)} → window still at ${where}`);
}
console.log('handed to the browser:', JSON.stringify((await mainEval('globalThis.__opened')).result.value, null, 1));
c.close(); mws.close();
