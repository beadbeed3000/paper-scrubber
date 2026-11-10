// node tests/inject-spans.mjs <port> <map.json>
// Reloads the dev De-Identifier and makes its deep check answer from a file of
// precomputed spans ({ documentText: [spans] }) instead of running the model.
// Any text not in the file (bench.mjs's warm-up) still goes to the real worker.
// Run tests/bench.mjs with --no-reload afterwards.
import { readFileSync } from 'node:fs';
import { connect } from './cdp.mjs';

const [port, mapPath] = process.argv.slice(2);
const map = readFileSync(mapPath, 'utf8');
let c = await connect(Number(port), '/deid/');
await c.send('Page.reload', { ignoreCache: true });
c.close();
await new Promise((r) => setTimeout(r, 3000));
c = await connect(Number(port), '/deid/');
await c.waitFor(`!!(window.__dev && document.readyState === 'complete')`, 60000, 500);
const n = await c.evaluate(`(() => {
  window.__deepInject = new Map(Object.entries(${map}));
  window.__injHits = 0;
  const orig = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (msg, ...rest) {
    if (msg && typeof msg === 'object' && typeof msg.text === 'string' && typeof msg.id === 'number' && window.__deepInject.has(msg.text)) {
      const spans = window.__deepInject.get(msg.text);
      window.__injHits++;
      setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { kind: 'result', id: msg.id, spans } })), 20);
      return;
    }
    return orig.call(this, msg, ...rest);
  };
  return window.__deepInject.size;
})()`);
console.log('injector ready:', n, 'documents');
c.close();
setTimeout(() => process.exit(0), 500);
