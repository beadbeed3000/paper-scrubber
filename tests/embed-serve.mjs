import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
createServer(async (req, res) => { try { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(await readFile(new URL('./embed-parent.html', import.meta.url))); } catch { res.writeHead(500).end(); } }).listen(8141, '127.0.0.1', () => console.log('parent on 8141'));
