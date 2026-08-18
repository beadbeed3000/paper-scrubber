// De-Identifier — desktop edition. The whole tool (page, engine, BOTH AI
// models) ships inside the app bundle; a loopback-only server serves it to the
// window exactly the way the tested web version is served, so worker/WASM/fetch
// behavior is identical. Nothing ever touches the network.
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');

const SMOKE = process.argv.includes('--smoke');
const SCRUB_TEST = process.argv.includes('--scrub-test');
const WEB_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'webapp')
  : path.join(__dirname, 'webapp');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.gz': 'application/gzip', '.onnx': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
};

let win = null;
let port = 0;
const pendingOpens = [];   // files handed to us before the window was ready

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = path.normalize(path.join(WEB_ROOT, p));
        if (!file.startsWith(WEB_ROOT)) { res.writeHead(403).end(); return; }
        const data = await fs.promises.readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404).end('Not found');
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

// ---------------------------------------------------------------- scans inbox
// The scanning workflow: the office scanner drops PDFs into a folder; the app
// watches it and de-identifies every new arrival automatically.
let watcher = null;
const seen = new Set();
const settle = new Map();   // filename -> timeout, so half-written scans wait

const INBOX_OK = /\.(pdf|docx|txt|md|png|jpe?g|webp|bmp)$/i;

function sendFile(fullPath) {
  fs.promises.readFile(fullPath)
    .then((buf) => {
      if (!win) return;
      win.webContents.send('inbox-file', { name: path.basename(fullPath), data: buf });
    })
    .catch(() => { /* file vanished mid-read — the watcher will see it again if it returns */ });
}

function watchInbox(dir) {
  if (watcher) { watcher.close(); watcher = null; }
  seen.clear();
  // existing files are NOT auto-processed — only new arrivals. A folder full
  // of last year's scans should not stampede the queue uninvited.
  for (const f of fs.readdirSync(dir)) seen.add(f);
  watcher = fs.watch(dir, (_event, filename) => {
    if (!filename || !INBOX_OK.test(filename) || filename.startsWith('.')) return;
    if (filename.includes('-scrubbed')) return;   // our own output
    if (seen.has(filename)) return;
    clearTimeout(settle.get(filename));
    settle.set(filename, setTimeout(() => {
      settle.delete(filename);
      const full = path.join(dir, filename);
      fs.promises.stat(full).then((st) => {
        if (!st.isFile()) return;
        seen.add(filename);
        sendFile(full);
      }).catch(() => { });
    }, 1500));   // scanners write in bursts — let the file finish landing
  });
  return dir;
}

ipcMain.handle('choose-inbox', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose the folder your scanner saves into',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return watchInbox(r.filePaths[0]);
});

// ---------------------------------------------------------------- app window
async function createWindow() {
  port = await startServer();
  win = new BrowserWindow({
    width: 1120,
    height: 840,
    minWidth: 760,
    minHeight: 560,
    show: !SMOKE && !SCRUB_TEST,
    backgroundColor: '#151b17',
    title: 'De-Identifier',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.on('closed', () => { win = null; });
  await win.loadURL(`http://127.0.0.1:${port}/deid/`);

  for (const f of pendingOpens.splice(0)) sendFile(f);

  if (SMOKE) {
    try {
      const r = await win.webContents.executeJavaScript(
        `({ tool: document.body.dataset.tool, dev: typeof window.__dev, desktop: !!window.deidDesktop, title: document.title })`,
      );
      const ok = r.tool === 'deid' && r.dev === 'object' && r.desktop === true;
      console.log('SMOKE ' + JSON.stringify({ ok, ...r, port }));
      app.exit(ok ? 0 : 1);
    } catch (e) {
      console.error('SMOKE FAILED: ' + e.message);
      app.exit(1);
    }
  }

  // The release gate: an actual de-identify run inside the packaged stack —
  // both models must load from the bundle and produce findings, offline.
  if (SCRUB_TEST) {
    try {
      const r = await win.webContents.executeJavaScript(`(async () => {
        window.__dev.setText('Jayden Combs is a 7th grader at Belfry Middle School with ADHD. He attends youth group at First Baptist Church and qualifies for free lunch. Call his mother Tammy at (606) 555-0142.');
        document.getElementById('btnScrub').click();
        const t0 = Date.now();
        while (document.getElementById('resultsView').hidden) {
          if (Date.now() - t0 > 300000) throw new Error('scrub timed out');
          await new Promise((res) => setTimeout(res, 500));
        }
        const f = window.__dev.getFindings();
        const out = window.__dev.scrubbedPlainText();
        return {
          findings: f.length,
          deep: f.filter((x) => x.source === 'deep').length,
          flagged: f.filter((x) => !x.enabled).length,
          leaks: ['Jayden', 'Combs', 'Belfry', 'Tammy', '555-0142'].filter((w) => out.includes(w)),
          secs: Math.round((Date.now() - t0) / 1000),
        };
      })()`, true);
      const ok = r.findings >= 5 && r.flagged >= 2 && r.leaks.length === 0;
      console.log('SCRUB_TEST ' + JSON.stringify({ ok, ...r }));
      app.exit(ok ? 0 : 1);
    } catch (e) {
      console.error('SCRUB_TEST FAILED: ' + e.message);
      app.exit(1);
    }
  }
}

// Finder "Open With → De-Identifier" (macOS) and double-clicked files
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (win) sendFile(p);
  else pendingOpens.push(p);
});

app.whenReady().then(() => {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },     // without this, Cmd+C / Cmd+V are dead on a Mac
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || SMOKE) app.quit();
});
