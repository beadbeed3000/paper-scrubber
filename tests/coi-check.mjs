// Load the web De-Identifier, wait for its service worker, reload, and report isolation.
import { connect } from './cdp.mjs';
const port = Number(process.argv[2] || 9335);
let c = await connect(port, '/deid/');
await c.waitFor(`!!(window.__dev && document.readyState === 'complete')`, 60000, 500);
const first = await c.evaluate(`JSON.stringify({ coi: self.crossOriginIsolated, controlled: !!navigator.serviceWorker.controller })`);
await c.waitFor(`navigator.serviceWorker.ready.then(r => !!r.active && r.active.state === 'activated')`, 120000, 1000);
await c.waitFor(`!!navigator.serviceWorker.controller`, 60000, 500);
const cache = await c.evaluate(`caches.keys().then(k => JSON.stringify(k))`);
await c.send('Page.reload', {});
c.close();
await new Promise((r) => setTimeout(r, 2500));
c = await connect(port, '/deid/');
await c.waitFor(`!!(window.__dev && document.readyState === 'complete')`, 60000, 500);
const second = await c.evaluate(`JSON.stringify({ coi: self.crossOriginIsolated, sab: typeof SharedArrayBuffer, controlled: !!navigator.serviceWorker.controller, papers: window.__dev.papers().length })`);
const hdr = await c.evaluate(`fetch('deep-check-worker.mjs').then(r => JSON.stringify({ coep: r.headers.get('cross-origin-embedder-policy'), coop: r.headers.get('cross-origin-opener-policy') }))`);
console.log('first load:', first, '| caches:', cache, '\nafter reload:', second, '| worker script headers via SW:', hdr);
c.close();
