// Static server for web-behavior tests: serves the repo like GitHub Pages does
// (no COOP/COEP headers, under /paper-scrubber/), with per-path overrides so a
// variant worker or an older sw.js can be served without touching the repo.
// Usage: node tests/webserve.mjs <port> [/path=file ...]
// (in Git Bash, set MSYS_NO_PATHCONV=1 so "/sw.js=..." is not rewritten)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]+$/, '') + sep;
const PREFIX = '/paper-scrubber';
const [port, ...pairs] = process.argv.slice(2);
const over = Object.fromEntries(pairs.map((p) => p.split('=')));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8' };

createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === PREFIX || (p.startsWith(PREFIX + '/') && !p.includes('.') && !p.endsWith('/'))) { res.writeHead(301, { Location: p + '/' }).end(); return; }
    if (!p.startsWith(PREFIX + '/')) { res.writeHead(404).end(); return; }
    p = p.slice(PREFIX.length);
    if (p.endsWith('/')) p += 'index.html';
    const file = over[p] || normalize(join(ROOT, p));
    if (!over[p] && !file.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'max-age=600' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(Number(port), () => console.log(`serving on ${port}`, JSON.stringify(over)));
