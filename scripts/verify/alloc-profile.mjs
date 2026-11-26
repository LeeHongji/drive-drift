// Allocation sampling profile of the game through raw CDP. Usage: node alloc.mjs <url> [seconds]
import { spawn } from 'node:child_process';
const url = process.argv[2];
const seconds = Number(process.argv[3] ?? 10);
const port = 9377;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/drive-verify/profile', '--window-size=1280,720',
  '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send('Page.enable'); await send('Runtime.enable'); await send('HeapProfiler.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 100; i++) { await sleep(300); if (await evaluate('!!(window.__game && window.__game.state().loadTimings && window.__game.state().loadTimings.total)')) break; }
await evaluate('window.__game.setDemo(true)');
await sleep(4000);
const pre = process.argv[4]; if (pre) console.log('pre:', await evaluate(pre));
const f0 = await evaluate('window.__game.app.frame');
await send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
await sleep(seconds * 1000);
const prof = (await send('HeapProfiler.stopSampling')).result.profile;
console.log("post:", await evaluate(process.env.POST || "window.__game.app.graphicsDevice.shaders.length"));
const f1 = await evaluate('window.__game.app.frame');
const st = await evaluate('JSON.stringify((({device,kmh,drawCalls,fps})=>({device,kmh,drawCalls,fps}))(window.__game.state()))');
const self = new Map(); let total = 0;
const walk = (n, path) => {
  const key = `${n.callFrame.functionName || '(anon)'}:${n.callFrame.lineNumber + 1}`;
  if (n.selfSize) { const e = self.get(key) ?? { size: 0, path }; e.size += n.selfSize; self.set(key, e); total += n.selfSize; }
  for (const c of n.children) walk(c, `${path} > ${key}`);
};
walk(prof.head, '');
const frames = f1 - f0;
console.log(`state ${st}; ${frames} frames in ${seconds}s; ${(total / 1048576 / seconds).toFixed(2)} MB/s; ${(total / frames / 1024).toFixed(1)} KB/frame`);
for (const [k, e] of [...self].sort((a, b) => b[1].size - a[1].size).slice(0, Number(process.env.TOP)||18)) {
  console.log(`${(e.size / total * 100).toFixed(1).padStart(5)}%  ${(e.size / frames / 1024).toFixed(2).padStart(7)} KB/f  ${k}   <- ${e.path.split(" > ").slice(-(Number(process.env.DEPTH)||3)).join(" > ")}`);
}
ws.close(); chrome.kill();
