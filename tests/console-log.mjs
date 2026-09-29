import { connect } from './cdp.mjs';
const c = await connect(Number(process.argv[2] || 9334));
await c.send('Log.enable');
await new Promise((r) => setTimeout(r, 1500));
const rows = c.events.filter((e) => e.method === 'Log.entryAdded').map((e) => e.params.entry);
const counts = {};
for (const r of rows) { const k = r.level + ' ' + r.text.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+/, '').replace(/\u001b\[[\d;]*m/g, '').slice(0, 140); counts[k] = (counts[k] || 0) + 1; }
console.log('entries', rows.length);
for (const [k, n] of Object.entries(counts)) console.log(String(n).padStart(4), k);
console.log('timestamps of the pthread error:', rows.filter((r) => r.text.includes('aT is not a function')).map((r) => new Date(r.timestamp).toISOString().slice(11, 19)).join(' '));
console.log('first/last entry', new Date(rows[0].timestamp).toISOString(), new Date(rows.at(-1).timestamp).toISOString());
c.close();
