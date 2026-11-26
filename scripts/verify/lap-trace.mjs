// GC pauses and long frames during play, through CDP tracing. Usage: node gc.mjs <url> [seconds]
import { spawn } from 'node:child_process';
const url = process.argv[2];
const seconds = Number(process.argv[3] ?? 20);
const port = 9378;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/drive-verify/profile2', '--window-size=1280,720',
  '--no-first-run', ...(process.env.UNCAPPED ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : []), '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const events = []; let traceDone;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === 'Tracing.dataCollected') events.push(...d.params.value);
  else if (d.method === 'Tracing.tracingComplete') traceDone();
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 100; i++) { await sleep(300); if (await evaluate('!!(window.__game && window.__game.state().loadTimings && window.__game.state().loadTimings.total)')) break; }
await evaluate('window.__game.setDemo(true)');
await sleep(3000);
await evaluate(`(() => { const a = window.__ft = []; const dc = window.__dc = []; let last = performance.now(); const tick = (t) => { a.push(t - last); last = t; dc.push(window.__game.app.stats.drawCalls.total); requestAnimationFrame(tick); }; requestAnimationFrame((t) => { last = t; requestAnimationFrame(tick); }); const s = window.__game.app.graphicsDevice.shaders; window.__sh = 0; const p = s.push; s.push = function (...x) { window.__sh++; return p.apply(this, x); }; })()`);
await send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { includedCategories: ['v8', 'devtools.timeline', 'disabled-by-default-v8.gc'] } });
const heap = [];
for (let i = 0; i < seconds; i++) { await sleep(1000); heap.push((await send('Runtime.getHeapUsage')).result.usedSize / 1048576); }
const done = new Promise((r) => (traceDone = r));
await send('Tracing.end'); await done;
const ft = JSON.parse(await evaluate('JSON.stringify(window.__ft)')).sort((a, b) => a - b);
const q = (p) => ft[Math.min(ft.length - 1, Math.floor(ft.length * p))].toFixed(1);
console.log(`frames ${ft.length}: avg ${(ft.reduce((a, b) => a + b, 0) / ft.length).toFixed(2)} p95 ${q(0.95)} p99 ${q(0.99)} max ${ft[ft.length - 1].toFixed(1)} ms; over 20 ms: ${ft.filter((v) => v > 20).length}; new shaders: ${await evaluate('window.__sh')}`);
const dc = JSON.parse(await evaluate('JSON.stringify(window.__dc)'));
const info = JSON.parse(await evaluate('JSON.stringify((() => { const g = window.__game, st = g.state(), d = g.app.graphicsDevice; return { device: st.device, load: st.loadTimings, laps: st.laps, vramMB: Object.fromEntries(Object.entries(d._vram).map(([k, v]) => [k, +(v / 1048576).toFixed(1)])) }; })())'));
console.log(`draw calls ${Math.min(...dc)}–${Math.max(...dc)} avg ${Math.round(dc.reduce((a, b) => a + b, 0) / dc.length)}; JS heap ${Math.min(...heap).toFixed(1)}–${Math.max(...heap).toFixed(1)} MB; ${JSON.stringify(info)}`);
const gc = new Map();
for (const e of events) {
  if (e.ph !== 'X' || !/GC|Scaveng|MarkCompact/i.test(e.name)) continue;
  const g = gc.get(e.name) ?? { n: 0, total: 0, max: 0 }; g.n++; g.total += e.dur / 1000; g.max = Math.max(g.max, e.dur / 1000); gc.set(e.name, g);
}
for (const [k, g] of [...gc].sort((a, b) => b[1].total - a[1].total).filter(([k]) => /^(MinorGC|MajorGC)$/.test(k))) console.log(`${k.padEnd(44)} n=${String(g.n).padStart(4)} total ${g.total.toFixed(1).padStart(7)} ms  max ${g.max.toFixed(2)} ms`);
ws.close(); chrome.kill();
