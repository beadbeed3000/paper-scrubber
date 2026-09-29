// Drop one file on a running tool page and report what came back.
// Usage: node drop-file.mjs <port> <match> <file> [--hard-reload | --reload]
import { connect } from './cdp.mjs';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const [port, match, file, flag] = process.argv.slice(2);
let c = await connect(Number(port), match);
if (flag) { await c.send('Page.reload', { ignoreCache: flag === '--hard-reload' }); c.close(); await new Promise((r) => setTimeout(r, 3000)); c = await connect(Number(port), match); }
await c.send('Log.enable');
await c.waitFor(`!!(window.__dev && document.readyState === 'complete')`, 60000, 500);
await c.evaluate(`(() => { const b = document.getElementById('btnBatchBack'); if (b && !document.getElementById('batchView').hidden) b.click(); const r = document.getElementById('btnBack'); if (r && !document.getElementById('resultsView').hidden) r.click(); })()`);
const b64 = readFileSync(file).toString('base64');
const t0 = Date.now();
await c.evaluate(`(() => { const bin = atob(${JSON.stringify(b64)}); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const dt = new DataTransfer(); dt.items.add(new File([u], ${JSON.stringify(basename(file))}));
  window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
await c.waitFor(`(() => { const p = window.__dev.papers()[0]; return p && p.name === ${JSON.stringify(basename(file))} && (p.status === 'done' || p.status === 'error'); })()`, 900000, 1000);
const r = JSON.parse(await c.evaluate(`JSON.stringify((() => { const p = window.__dev.papers()[0]; return { coi: self.crossOriginIsolated, status: p.status, error: p.error, kind: p.kind, ocr: !!p.ocr, deepFailed: !!p.deepFailed, chars: (p.text || '').length, findings: (p.findings || []).length, deep: (p.findings || []).filter(f => f.source === 'deep').length, sample: window.__dev.scrubbedPlainText(0).slice(0, 220) }; })())`));
await new Promise((res) => setTimeout(res, 1000));
const errs = c.events.filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error' && !/constant fold/.test(e.params.entry.text)).map((e) => e.params.entry.text.slice(0, 160));
console.log(JSON.stringify({ secs: Math.round((Date.now() - t0) / 1000), ...r, consoleErrors: errs }, null, 1));
c.close();
