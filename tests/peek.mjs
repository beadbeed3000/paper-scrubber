import { connect } from './cdp.mjs';
const c = await connect(Number(process.argv[2] || 9334), process.argv[3] || '/deid/');
console.log(await c.evaluate(`JSON.stringify({ status: document.getElementById('statusText')?.textContent, papers: window.__dev.papers().map(p => p.status[0]).join(''), log: (window.__deepLog || []).map(x => x.t1 ? Math.round((x.t1 - x.t0) / 1000) + 's' : 'running ' + (x.lastLabel || '')) })`));
c.close();
