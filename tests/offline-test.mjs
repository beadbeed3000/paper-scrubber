// Offline road-ready test for the web De-Identifier.
//   node offline-test.mjs fresh    — fixed sw.js, fresh profile, deploy bump, offline
//   node offline-test.mjs upgrade  — the committed sw.js first (git HEAD), then the working copy
// Serves the repo the way GitHub Pages does: under /paper-scrubber/, with
// max-age=600, ACAO *, and NO COOP/COEP headers. "Offline" = the server is shut
// down and every socket destroyed, so nothing can come from the network.
import { createServer } from 'node:http';
import { createReadStream, statSync, readFileSync, mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const SCRATCH = join(tmpdir(), 'deid-offline-test');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 8190, DBG = 9341;
const BASE = `http://localhost:${PORT}/paper-scrubber/`;
const MODE = process.argv[2] || 'fresh';

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.gz': 'application/gzip' };

let swSource = readFileSync(join(REPO, 'sw.js'), 'utf8');
const reqLog = [];
let phase = 'start';
const sockets = new Set();
const server = createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  reqLog.push({ phase, path });
  if (!path.startsWith('/paper-scrubber/')) { res.writeHead(404).end(); return; }
  path = path.slice('/paper-scrubber'.length);
  if (path.endsWith('/')) path += 'index.html';
  const headers = { 'Cache-Control': 'max-age=600', 'Access-Control-Allow-Origin': '*', Vary: 'Accept-Encoding' };
  if (path === '/sw.js') {
    res.writeHead(200, { ...headers, 'Content-Type': MIME['.js'] }).end(swSource);
    return;
  }
  const file = normalize(join(REPO, path));
  try {
    const st = statSync(file);
    if (!st.isFile()) throw new Error('not a file');
    res.writeHead(200, { ...headers, 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size });
    createReadStream(file).pipe(res);
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
});
server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
const online = () => new Promise((r) => server.listen(PORT, r));
const offline = () => new Promise((r) => { server.close(() => r()); for (const s of sockets) s.destroy(); });

// ---------------------------------------------------------------- CDP
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, seq = 0;
const pending = new Map();
const logs = [];
const workers = [];
function send(method, params = {}, sessionId) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
}
let pageSession;
async function evaluate(expression, timeoutMs = 60000) {
  const r = await Promise.race([
    send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, pageSession),
    sleep(timeoutMs).then(() => { throw new Error(`evaluate timed out: ${expression.slice(0, 80)}`); }),
  ]);
  if (r.exceptionDetails) throw new Error(`page threw: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
  return r.result.value;
}
async function waitFor(expression, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try { const v = await evaluate(expression, 15000); if (v) return v; } catch { /* page mid-navigation */ }
    await sleep(1000);
  }
  throw new Error(`timed out waiting for: ${label}`);
}
async function navigate(url) {
  await send('Page.navigate', { url }, pageSession);
  await sleep(1500);
  await waitFor('document.readyState === "complete"', 60000, `load ${url}`);
}

async function startEdge(profile) {
  mkdirSync(profile, { recursive: true });
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${DBG}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*', 'about:blank'], { stdio: 'ignore' });
  let ver;
  for (let i = 0; i < 60 && !ver; i++) { await sleep(500); ver = await fetch(`http://127.0.0.1:${DBG}/json/version`).then((r) => r.json()).catch(() => null); }
  ws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.reject(new Error(`${p.method}: ${m.error.message}`)) : p.resolve(m.result);
      return;
    }
    if (m.method === 'Target.attachedToTarget') {
      const s = m.params.sessionId;
      const t = m.params.targetInfo;
      if (t.type === 'worker') workers.push({ phase, title: t.title, url: t.url.split('/').pop() });
      send('Runtime.enable', {}, s).catch(() => {});
      send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, s).catch(() => {});
      send('Runtime.runIfWaitingForDebugger', {}, s).catch(() => {});
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
      logs.push({ phase, type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
    }
    if (m.method === 'Runtime.exceptionThrown') {
      logs.push({ phase, type: 'exception', text: (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300) });
    }
  });
  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  ({ sessionId: pageSession } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true }));
  await send('Page.enable', {}, pageSession);
  await send('Runtime.enable', {}, pageSession);
  await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, pageSession);
  return edge;
}

// ---------------------------------------------------------------- probes
const RECORD = 'Journey Adams is in 3rd grade. Her mamaw takes her to Troublesome Creek Pediatrics for asthma, '
  + 'and she plays on the Hazard Bulldogs softball team. The family attends Grace Baptist Church and gets SNAP benefits.';

// `win` is the window expression to act in — 'window' or an iframe's contentWindow
const cacheReport = (win = 'window') => evaluate(`(async () => {
  const w = ${win}; const out = {};
  for (const k of await w.caches.keys()) {
    const c = await w.caches.open(k);
    const urls = (await c.keys()).map((r) => new URL(r.url).pathname);
    out[k] = { count: urls.length, glinerOrt: urls.filter((u) => u.includes('/vendor/gliner-ort/')).map((u) => u.split('/').pop()),
      deepParts: urls.filter((u) => u.includes('gliner_multi_pii-v1/onnx/')).length };
  }
  return out;
})()`);

const chip = (win = 'window') => evaluate(`(() => { const el = ${win}.document.getElementById('trustOffline');
  return el ? { text: el.textContent, ok: el.classList.contains('ok'), busy: el.classList.contains('busy') } : null; })()`);

async function deepCheck(win = 'window', timeoutMs = 15 * 60000) {
  const t0 = Date.now();
  await evaluate(`(() => { const w = ${win}; w.__dev.setText(${JSON.stringify(RECORD)}); w.document.getElementById('btnScrub').click(); return true; })()`);
  const res = await waitFor(`(() => { const p = ${win}.__dev.papers()[0];
    return p && (p.status === 'done' || p.status === 'error') ? { status: p.status, error: p.error, deepFailed: !!p.deepFailed,
      deep: ${win}.__dev.getFindings(0).filter((f) => f.source === 'deep').map((f) => f.type + ':' + f.text) } : null; })()`, timeoutMs, 'deep check');
  await sleep(1500);
  const threads = workers.filter((w) => w.phase === phase && /pthread/i.test(w.title + ' ' + w.url)).length;
  const sinceStart = workers.filter((w) => w.phase === phase).map((w) => w.title || w.url);
  return { ...res, seconds: Math.round((Date.now() - t0) / 1000), threadWorkersThisPhase: threads, workersThisPhase: sinceStart };
}

const isolation = (win = 'window') => evaluate(`({ isolated: ${win}.crossOriginIsolated, controlled: !!${win}.navigator.serviceWorker.controller })`);

function show(label, v) { console.log(`\n== ${label}\n${JSON.stringify(v, null, 1)}`); }
function glinerOrtRequests(ph) { return reqLog.filter((r) => r.phase === ph && r.path.includes('gliner-ort')).map((r) => r.path.split('/').pop()); }

// ---------------------------------------------------------------- scenarios
async function main() {
  const profile = join(SCRATCH, `edge-profile-${MODE}-${Date.now()}`);
  if (MODE === 'upgrade') swSource = execSync('git show HEAD:sw.js', { cwd: REPO, encoding: 'utf8' });
  console.log(`mode=${MODE} profile=${profile} sw CACHE=${swSource.match(/const CACHE = '([^']+)'/)[1]}`);
  await online();
  const edge = await startEdge(profile);
  try {
    // 1. first visit, online: uncontrolled page, the worker installs and claims it
    phase = 'first-visit';
    await navigate(`${BASE}deid/`);
    await waitFor('!!navigator.serviceWorker.controller', 180000, 'service worker control');
    show('first visit: isolation', await isolation());
    show('first visit: gliner-ort requests during install', glinerOrtRequests('first-visit'));
    phase = 'first-deep-check';
    show('first deep check (online, single-threaded session)', await deepCheck());
    show('first deep check: gliner-ort requests', glinerOrtRequests('first-deep-check'));
    await sleep(6000);   // the chip polls every 4 s
    show('chip after first deep check', await chip());
    show('caches after first deep check', await cacheReport());

    // 2. deploy: a CACHE bump (upgrade mode: committed sw.js -> working copy; fresh mode: vN -> vN+1)
    phase = 'deploy';
    const before = swSource.match(/const CACHE = '([^']+)'/)[1];
    swSource = MODE === 'upgrade'
      ? readFileSync(join(REPO, 'sw.js'), 'utf8')
      : swSource.replace(`const CACHE = '${before}'`, `const CACHE = 'paper-scrubber-v${Number(before.match(/\d+$/)[0]) + 1}'`);
    const after = swSource.match(/const CACHE = '([^']+)'/)[1];
    console.log(`\n-- deploying ${before} -> ${after}`);
    await navigate(`${BASE}deid/`);
    await waitFor(`caches.keys().then((k) => k.includes('${after}') && !k.includes('${before}'))`, 180000, 'new version active, old cache purged');
    await sleep(3000);   // controllerchange reload settles
    await navigate(`${BASE}deid/`);
    show('after deploy: isolation', await isolation());
    show('after deploy: gliner-ort requests', glinerOrtRequests('deploy'));
    show('caches after deploy', await cacheReport());
    await sleep(6000);
    show('chip after deploy (still online, no new deep check)', await chip());

    // 3. offline: server down. Top-level De-Identifier (isolated, threaded)
    phase = 'offline';
    await offline();
    console.log('\n-- server is DOWN');
    await navigate(`${BASE}deid/`);
    show('offline top-level: isolation', await isolation());
    await sleep(6000);
    show('offline top-level: chip', await chip());
    phase = 'offline-top';
    show('offline top-level deep check (threaded)', await deepCheck());

    // 4. offline: the De-Identifier inside an iframe on a non-isolated page, so
    //    it cannot be isolated and runs single-threaded
    phase = 'offline-iframe';
    await navigate(`${BASE}index.html`);
    show('offline Paper Scrubber page: isolation', await isolation());
    await sleep(6000);
    show('offline Paper Scrubber page: its own chip', await chip());
    await evaluate(`new Promise((r) => { const f = document.createElement('iframe'); f.id = 'deidFrame'; f.src = 'deid/';
      f.style.cssText = 'width:1000px;height:800px'; f.onload = () => r(true); document.body.appendChild(f); })`);
    const W = `document.getElementById('deidFrame').contentWindow`;
    await waitFor(`!!${W}.__dev`, 60000, 'iframe app loaded');
    show('offline iframe: isolation', await isolation(W));
    await sleep(6000);
    show('offline iframe: chip', await chip(W));
    show('offline iframe deep check (single-threaded)', await deepCheck(W));
    show('requests the server saw while down (must be empty)', reqLog.filter((r) => r.phase.startsWith('offline')));
  } finally {
    show('console errors/warnings (page + workers)', logs);
    try { await send('Browser.close'); } catch { edge.kill(); }
    server.close(); for (const s of sockets) s.destroy();
  }
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
