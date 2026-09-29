// With a paper open, let the new service worker take over and confirm the page
// did NOT reload itself (the paper survives), then reload by hand and check isolation.
import { connect } from './cdp.mjs';
const port = Number(process.argv[2] || 9335);
let c = await connect(port);
const before = JSON.parse(await c.evaluate(`JSON.stringify({ origin: performance.timeOrigin, papers: window.__dev.papers().length, coi: self.crossOriginIsolated, sw: navigator.serviceWorker.controller && 1 })`));
await c.evaluate(`window.__changed = false; navigator.serviceWorker.addEventListener('controllerchange', () => { window.__changed = true; });
  navigator.serviceWorker.getRegistration().then((r) => r.update())`);
await c.waitFor(`window.__changed === true`, 60000, 500);
await new Promise((r) => setTimeout(r, 3000));
const after = JSON.parse(await c.evaluate(`(async () => JSON.stringify({ origin: performance.timeOrigin, papers: window.__dev.papers().length, coi: self.crossOriginIsolated, caches: await caches.keys() }))()`));
console.log('before update:', JSON.stringify(before));
console.log('after update: ', JSON.stringify(after), after.origin === before.origin ? '→ same page, not reloaded' : '→ PAGE RELOADED');
await c.send('Page.reload', {});
c.close();
await new Promise((r) => setTimeout(r, 3000));
c = await connect(port);
await c.waitFor(`!!(window.__dev && document.readyState === 'complete')`, 60000, 500);
console.log('after a normal reload:', await c.evaluate(`JSON.stringify({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, getProgramLine: !!document.querySelector('.get-program') })`));
c.close();
