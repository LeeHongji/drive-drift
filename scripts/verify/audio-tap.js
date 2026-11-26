// Tap the master output and look for clicks: a click is a sample-to-sample jump far above what the
// surrounding signal does. Also records peak level, clipping and the RMS over time.
(async () => { const g = window.__game; const a = g.audio; if (!a.ctx) return 'no audio context: ' + JSON.stringify(a.status());
const ctx = a.ctx; if (ctx.state !== 'running') await ctx.resume();
const T = (window.__tap = { peak: 0, clipped: 0, maxJump: 0, jumps: [], blocks: 0, rms: [], state: ctx.state, rate: ctx.sampleRate });
const sp = ctx.createScriptProcessor(4096, 2, 2); let prev = 0; let n = 0;
sp.onaudioprocess = (e) => { const x = e.inputBuffer.getChannelData(0); let sum = 0; let blockMax = 0;
  for (let i = 0; i < x.length; i++) { const v = x[i]; const d = Math.abs(v - prev); if (d > blockMax) blockMax = d; if (d > 0.25) T.jumps.push([+((n + i) / ctx.sampleRate).toFixed(3), +d.toFixed(3), Math.round(g.state().kmh)]); const av = Math.abs(v); if (av > T.peak) T.peak = av; if (av >= 0.999) T.clipped++; sum += v * v; prev = v; }
  n += x.length; if (blockMax > T.maxJump) T.maxJump = blockMax; T.blocks++; T.rms.push(+Math.sqrt(sum / x.length).toFixed(3)); };
a.nodes.master.connect(sp); const mute = ctx.createGain(); mute.gain.value = 0; sp.connect(mute).connect(ctx.destination);
g.setDemo(true); return 'tapping ' + JSON.stringify(a.status()); })()
