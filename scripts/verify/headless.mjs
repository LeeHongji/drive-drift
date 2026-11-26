// Load the game headless, then evaluate each expression given on the command line (after the URL).
import { spawn } from 'node:child_process';
const [url, ...exprs] = process.argv.slice(2);
const port = +(process.env.PORT ?? 9379);
const size = process.env.SIZE ?? '1280,720';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/drive-verify/profile-${port}`, `--window-size=${size}`,
  '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--enable-unsafe-webgpu', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300)); else if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300)); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => { const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result; return r?.exceptionDetails ? 'EXC ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) : r?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
if (process.env.VW) {
  const mobile = !!process.env.MOBILE;
  await send('Emulation.setDeviceMetricsOverride', { width: +process.env.VW, height: +process.env.VH, deviceScaleFactor: +(process.env.DPR ?? 1), mobile });
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
}
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
await send('Page.navigate', { url });
for (let i = 0; i < 100; i++) { await sleep(300); if (await evaluate('!!(window.__game && window.__game.state().loadTimings && window.__game.state().loadTimings.total)')) break; }
for (const e of exprs) {
  if (e.startsWith('sleep:')) { await sleep(Number(e.slice(6))); continue; }
  if (e.startsWith('shot:')) { const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }); (await import('node:fs')).writeFileSync(e.slice(5), Buffer.from(r.result.data, 'base64')); console.log('saved', e.slice(5)); continue; }
  const v = await evaluate(e.startsWith('file:') ? (await import('node:fs')).readFileSync(e.slice(5), 'utf8') : e); console.log(typeof v === 'string' ? v : JSON.stringify(v));
}
if (logs.length) console.log('console:', [...new Set(logs)].slice(0, 8).join('\n  '));
ws.close(); chrome.kill();
