// Procedural game audio on the Web Audio API. No audio files: the engine is four wavetable oscillators
// crossfaded by rpm, the loops are filtered views of one shared noise buffer, the one-shots are rendered into
// buffers when the graph is built (synth.ts). What each sound follows is decided in mapping.ts (pure, tested);
// every number lives in src/config/audio.ts.
//
// Signal flow:
//   sources ─► mix ─► rumble cut ─► tunnel low shelf ─► limiter ─► master ─► output
//               └─► tunnel send ─► convolver reverb + feedback echo ─► engine-note resonance ─► limiter
//
// Rules kept here:
//   - The AudioContext is created suspended while the game loads (so building the graph never costs a frame
//     mid-drive) and started by the first user gesture; until then, and whenever the browser has no Web
//     Audio, every method is a no-op.
//   - Parameters only ever glide (setTargetAtTime): no clicks.
//   - update() allocates nothing. A one-shot costs one AudioBufferSourceNode per trigger (they are single-use
//     by design); everything else is built once.
//   - Paused, muted or hidden: the output ducks, then the context is suspended, so silence costs no CPU.

import { AUDIO, type SfxName } from '../config/audio';
import type { FrameState } from '../core/frame';
import { clamp } from '../core/math';
import { Rng } from '../core/rng';
import type { LapEvent } from '../gameplay/laps';
import type { PickupEvent } from '../gameplay/pickups';
import type { ScoreEvent } from '../gameplay/scoring';
import * as map from './mapping';
import { engineWave, lowpassNoiseRms, renderSfx, shaperCurve, tunnelImpulse, whiteNoise } from './synth';

/** Things with their own level control: `debug.solo()` / `debug.mute()` / `debug.trim` work on these. */
export const SOURCES = ['engine', 'screech', 'scrape', 'road', 'wind', 'kerb', 'roar', 'hiss', 'ambience', 'sfx', 'tunnel'] as const;
export type SourceName = (typeof SOURCES)[number];

const SFX_NAMES = Object.keys(AUDIO.sfx.sounds) as SfxName[];

/** Console tuning handle (see the notes at the end of this file). */
export interface AudioDebug {
  /** The live config object: most values are read every frame, static ones need `retune()`. */
  readonly config: typeof AUDIO;
  /** Level multiplier per source, applied on top of the config gains. */
  readonly trim: Record<SourceName, number>;
  /** Null until the audio has started. */
  readonly ctx: AudioContext | null;
  /** Every node of the graph by name. */
  readonly nodes: Graph['nodes'] | null;
  /** Hear only these sources (`solo()` with no names restores all). */
  solo(...names: SourceName[]): void;
  mute(name: SourceName, on?: boolean): void;
  /** Re-apply the static config values: wavetables, filter shapes, fixed gains, one-shot recipes. */
  retune(): void;
  /** Audition a one-shot. */
  play(name: SfxName, volume?: number, rate?: number): void;
  status(): { state: string; sampleRate: number; nodes: number; silent: boolean; tunnelConnected: boolean };
}

export interface AudioSystem {
  /** Continuous sounds; call once per rendered frame (it is a FrameSystem). */
  update(frame: FrameState): void;
  onScore(e: ScoreEvent): void;
  onLap(e: LapEvent): void;
  onPickup(e: PickupEvent): void;
  /** Wall contact at `normalSpeed` m/s (CarState.hit); soft touches and rapid repeats are ignored. */
  impact(normalSpeed: number): void;
  setMuted(muted: boolean): void;
  /** Duck everything quickly and stop the audio clock; the reverse on resume. */
  setPaused(paused: boolean): void;
  readonly muted: boolean;
  readonly debug: AudioDebug;
  /** Remove the listeners and close the context. */
  dispose(): void;
}

/**
 * One automated parameter. `to` glides it toward a value and skips the call when the target has not changed,
 * so a steady state (most parameters, most frames) schedules nothing.
 */
class Aim {
  private last = NaN;
  constructor(private readonly param: AudioParam) {}
  to(value: number, now: number, time: number): void {
    if (Math.abs(value - this.last) <= 1e-4 * (1 + Math.abs(value))) return;
    this.last = value;
    this.param.setTargetAtTime(value, now, time);
  }
}

function buildGraph(ctx: AudioContext) {
  const rng = new Rng(AUDIO.noise.seed);
  let count = 0;
  const add = <T extends AudioNode>(node: T): T => {
    count++;
    return node;
  };
  const gain = (value: number): GainNode => {
    const node = add(ctx.createGain());
    node.gain.value = value;
    return node;
  };
  const filter = (type: BiquadFilterType): BiquadFilterNode => {
    const node = add(ctx.createBiquadFilter());
    node.type = type;
    return node;
  };
  const toBuffer = (...channels: Float32Array[]): AudioBuffer => {
    const buffer = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
    channels.forEach((data, c) => buffer.getChannelData(c).set(data));
    return buffer;
  };

  // ---- output chain ----
  const mix = gain(1);
  const rumbleCut = filter('highpass');
  const shelf = filter('lowshelf');
  const limiter = add(ctx.createDynamicsCompressor());
  const master = gain(0);
  mix.connect(rumbleCut).connect(shelf).connect(limiter).connect(master).connect(ctx.destination);

  // ---- tunnel: mix ─► send ─► (reverb, echo) ─► boom ─► limiter. `mix ─► send` is connected on demand. ----
  const send = gain(0);
  const convolver = add(ctx.createConvolver());
  convolver.buffer = toBuffer(...tunnelImpulse(ctx.sampleRate, rng));
  const reverbGain = gain(0);
  const echoDelay = add(ctx.createDelay(1));
  const echoTone = filter('lowpass');
  const echoFeedback = gain(0);
  const echoGain = gain(0);
  const boom = filter('peaking');
  send.connect(convolver).connect(reverbGain).connect(boom);
  send.connect(echoDelay).connect(echoTone).connect(echoFeedback).connect(echoDelay);
  echoTone.connect(echoGain).connect(boom);
  boom.connect(limiter);

  // ---- the one noise source every noise-based sound filters ----
  const noise = add(ctx.createBufferSource());
  noise.buffer = toBuffer(whiteNoise(Math.round(AUDIO.noise.seconds * ctx.sampleRate), rng));
  noise.loop = true;

  // ---- engine: wavetables ─► layer gains ─► drive ─► soft clip ─► tone ─► shift duck ─► bus ----
  const drive = gain(1);
  const shaper = add(ctx.createWaveShaper());
  shaper.oversample = '2x';
  const tone = filter('lowpass');
  const duck = gain(1);
  const engine = gain(0);
  drive.connect(shaper).connect(tone).connect(duck).connect(engine).connect(mix);
  // Pitch jitter: slow noise into every wavetable's detune.
  const jitterTone = filter('lowpass');
  const jitterDepth = gain(0);
  noise.connect(jitterTone).connect(jitterDepth);
  const oscs: OscillatorNode[] = [];
  const layers: GainNode[] = [];
  for (let i = 0; i < AUDIO.engine.layers.length; i++) {
    const osc = add(ctx.createOscillator());
    osc.frequency.value = map.engineHz(0, 0);
    const layer = gain(0);
    osc.connect(layer).connect(drive);
    jitterDepth.connect(osc.detune);
    oscs.push(osc);
    layers.push(layer);
  }
  // Intake rasp: noise band × engine waveform (the clipped engine signal drives raspMod's gain).
  const raspBand = filter('bandpass');
  const raspMod = gain(0);
  const rasp = gain(0);
  noise.connect(raspBand).connect(raspMod).connect(rasp).connect(tone);
  shaper.connect(raspMod.gain);

  // ---- loops ----
  const squealA = filter('bandpass');
  const squealB = filter('bandpass');
  const scrubBand = filter('bandpass');
  const scrubLevel = gain(0);
  const screech = gain(0);
  noise.connect(squealA).connect(screech);
  noise.connect(squealB).connect(screech);
  noise.connect(scrubBand).connect(scrubLevel).connect(screech);
  screech.connect(mix);

  const scrapeA = filter('bandpass');
  const scrapeB = filter('bandpass');
  const scrape = gain(0);
  const scrapePan = add(ctx.createStereoPanner());
  noise.connect(scrapeA).connect(scrape);
  noise.connect(scrapeB).connect(scrape);
  scrape.connect(scrapePan).connect(mix);

  const roadTone = filter('lowpass');
  const road = gain(0);
  noise.connect(roadTone).connect(road).connect(mix);

  const windBand = filter('bandpass');
  const wind = gain(0);
  noise.connect(windBand).connect(wind).connect(mix);

  const kerbOsc = add(ctx.createOscillator());
  kerbOsc.type = 'sawtooth';
  kerbOsc.frequency.value = AUDIO.kerb.minHz;
  const kerbTone = filter('lowpass');
  const kerb = gain(0);
  kerbOsc.connect(kerbTone).connect(kerb).connect(mix);

  const roarBand = filter('bandpass');
  const roar = gain(0);
  noise.connect(roarBand).connect(roar).connect(mix);
  const hissBand = filter('highpass');
  const hiss = gain(0);
  noise.connect(hissBand).connect(hiss).connect(mix);

  const ambienceTone = filter('lowpass');
  const ambience = gain(0);
  noise.connect(ambienceTone).connect(ambience).connect(mix);

  // ---- one-shots: buffer source (per trigger) ─► that sound's gain ─► sfx bus ----
  const sfx = gain(1);
  sfx.connect(mix);
  const sfxGains = {} as Record<SfxName, GainNode>;
  const buffers = {} as Record<SfxName, AudioBuffer>;
  for (const name of SFX_NAMES) {
    sfxGains[name] = gain(0);
    sfxGains[name].connect(sfx);
  }

  const nodes = {
    mix, rumbleCut, shelf, limiter, master,
    send, convolver, reverbGain, echoDelay, echoTone, echoFeedback, echoGain, boom,
    noise,
    oscs, layers, drive, shaper, tone, duck, engine, jitterTone, jitterDepth, raspBand, raspMod, rasp,
    squealA, squealB, scrubBand, scrubLevel, screech,
    scrapeA, scrapeB, scrape, scrapePan,
    roadTone, road, windBand, wind, kerbOsc, kerbTone, kerb, roarBand, roar, hissBand, hiss,
    ambienceTone, ambience,
    sfx, sfxGains,
  };
  const aims = {
    master: new Aim(master.gain),
    shelf: new Aim(shelf.gain),
    send: new Aim(send.gain),
    boomHz: new Aim(boom.frequency),
    oscHz: oscs.map((o) => new Aim(o.frequency)),
    layers: layers.map((l) => new Aim(l.gain)),
    drive: new Aim(drive.gain),
    tone: new Aim(tone.frequency),
    engine: new Aim(engine.gain),
    raspHz: new Aim(raspBand.frequency),
    rasp: new Aim(rasp.gain),
    squealA: new Aim(squealA.frequency),
    squealB: new Aim(squealB.frequency),
    screech: new Aim(screech.gain),
    scrapeA: new Aim(scrapeA.frequency),
    scrapeB: new Aim(scrapeB.frequency),
    scrape: new Aim(scrape.gain),
    scrapePan: new Aim(scrapePan.pan),
    roadHz: new Aim(roadTone.frequency),
    road: new Aim(road.gain),
    windHz: new Aim(windBand.frequency),
    wind: new Aim(wind.gain),
    kerbHz: new Aim(kerbOsc.frequency),
    kerb: new Aim(kerb.gain),
    roar: new Aim(roar.gain),
    hiss: new Aim(hiss.gain),
    ambience: new Aim(ambience.gain),
    sfx: new Aim(sfx.gain),
  };

  const graph = { ctx, count, nodes, aims, buffers, toBuffer };
  applyStatic(graph);
  noise.start();
  for (const osc of oscs) osc.start();
  kerbOsc.start();
  return graph;
}

export type Graph = ReturnType<typeof buildGraph>;

/** Everything the per-frame update does not touch: filter shapes, fixed gains, wavetables, one-shot buffers. */
function applyStatic(g: Pick<Graph, 'ctx' | 'nodes' | 'buffers' | 'toBuffer'>): void {
  const n = g.nodes;
  const sampleRate = g.ctx.sampleRate;
  const flat = AUDIO.noise.flatQdB;
  // Separate streams, so editing one recipe does not change the noise of the others.
  const rng = new Rng(AUDIO.noise.seed ^ 0x9e3779b9);

  n.rumbleCut.frequency.value = AUDIO.master.rumbleCut;
  n.rumbleCut.Q.value = flat;
  const L = AUDIO.limiter;
  n.limiter.threshold.value = L.threshold;
  n.limiter.knee.value = L.knee;
  n.limiter.ratio.value = L.ratio;
  n.limiter.attack.value = L.attack;
  n.limiter.release.value = L.release;

  const T = AUDIO.tunnel;
  n.shelf.frequency.value = T.shelfHz;
  n.reverbGain.gain.value = T.reverbGain;
  n.echoDelay.delayTime.value = T.echoDelay;
  n.echoTone.frequency.value = T.echoCutoff;
  n.echoTone.Q.value = flat;
  n.echoFeedback.gain.value = T.echoFeedback;
  n.echoGain.gain.value = T.echoGain;
  n.boom.gain.value = T.boomDb;
  n.boom.Q.value = T.boomQ;

  const E = AUDIO.engine;
  const waveRng = rng.fork();
  E.layers.forEach((layer, i) => {
    const wave = engineWave(layer, waveRng);
    n.oscs[i].setPeriodicWave(g.ctx.createPeriodicWave(wave.real, wave.imag, { disableNormalization: true }));
    n.oscs[i].detune.value = layer.detune;
  });
  n.shaper.curve = shaperCurve(E.shaperK);
  n.tone.Q.value = flat;
  n.jitterTone.frequency.value = E.jitterHz;
  n.jitterTone.Q.value = flat;
  n.jitterDepth.gain.value = E.jitterCents / lowpassNoiseRms(E.jitterHz, sampleRate);
  n.raspBand.Q.value = E.raspQ;

  n.squealA.Q.value = AUDIO.screech.q;
  n.squealB.Q.value = AUDIO.screech.q;
  n.scrubBand.frequency.value = AUDIO.screech.scrubHz;
  n.scrubBand.Q.value = AUDIO.screech.scrubQ;
  n.scrubLevel.gain.value = AUDIO.screech.scrubLevel;
  n.scrapeA.Q.value = AUDIO.scrape.q;
  n.scrapeB.Q.value = AUDIO.scrape.q;
  n.roadTone.Q.value = flat;
  n.windBand.Q.value = AUDIO.wind.q;
  n.kerbTone.frequency.value = AUDIO.kerb.cutoff;
  n.kerbTone.Q.value = flat;
  n.roarBand.frequency.value = AUDIO.nitro.roarHz;
  n.roarBand.Q.value = AUDIO.nitro.roarQ;
  n.hissBand.frequency.value = AUDIO.nitro.hissHz;
  n.hissBand.Q.value = flat;
  n.ambienceTone.frequency.value = AUDIO.ambience.cutoff;
  n.ambienceTone.Q.value = flat;

  for (const name of SFX_NAMES) {
    const recipe = AUDIO.sfx.sounds[name];
    g.buffers[name] = g.toBuffer(renderSfx(recipe, sampleRate, rng.fork()));
    // Start at the usual volume, so the first trigger's attack is not softened by the gain glide.
    n.sfxGains[name].gain.value = recipe.volume;
  }
}

const ignore = (): void => {};
const GESTURES = ['keydown', 'pointerdown', 'pointerup', 'touchend'] as const;

class WebAudio implements AudioSystem {
  /** Null without Web Audio (or when building it threw): every method is then a no-op for good. */
  private graph: Graph | null = null;
  private listening = false;
  private isMuted = false;
  private paused = false;
  private hidden = false;
  /** The run state last applied (see applyRunState). */
  private wasSilent = false;
  private suspendTimer = 0;
  /** The master gain glides with `fadeTime` until `fadeEnd` (context time; −1 = set on the next update). */
  private fadeTime = AUDIO.master.fadeIn;
  private fadeEnd = -1;
  private readonly weights = new Float32Array(AUDIO.engine.layers.length);
  private readonly rng = new Rng(AUDIO.noise.seed);
  private readonly trim = Object.fromEntries(SOURCES.map((s) => [s, 1])) as Record<SourceName, number>;
  /** Edge detectors; prevGear −1 = no previous frame. */
  private prevGear = -1;
  private prevLoad = 0;
  private prevBoost = false;
  private tunnelOn = false;
  private tunnelIdle = 0;
  private lastCrash = -Infinity;
  private lastBurble = -Infinity;
  readonly debug: AudioDebug;

  constructor() {
    const self = this;
    this.debug = {
      config: AUDIO,
      trim: this.trim,
      get ctx() {
        return self.graph?.ctx ?? null;
      },
      get nodes() {
        return self.graph?.nodes ?? null;
      },
      solo: (...names) => {
        for (const s of SOURCES) this.trim[s] = names.length === 0 || names.includes(s) ? 1 : 0;
      },
      mute: (name, on = true) => {
        this.trim[name] = on ? 0 : 1;
      },
      retune: () => {
        if (this.graph) applyStatic(this.graph);
      },
      play: (name, volume = 1, rate = 1) => {
        this.play(name, volume, rate);
      },
      status: () => ({
        state: this.graph?.ctx.state ?? 'unavailable',
        sampleRate: this.graph?.ctx.sampleRate ?? 0,
        nodes: this.graph?.count ?? 0,
        silent: this.silent,
        tunnelConnected: this.tunnelOn,
      }),
    };
    if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return;
    this.listening = true;
    this.hidden = document.hidden;
    for (const type of GESTURES) window.addEventListener(type, this.onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', this.onVisibility);
    this.build();
    this.applyRunState();
  }

  get muted(): boolean {
    return this.isMuted;
  }

  private get silent(): boolean {
    return this.isMuted || this.paused || this.hidden;
  }

  /**
   * Create the context and the whole graph. Without a user gesture yet the context stays suspended (the
   * browser's autoplay policy) and onGesture starts it; arriving from the menu it may run straight away.
   */
  private build(): void {
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext({ latencyHint: 'interactive' });
      this.graph = buildGraph(ctx);
      ctx.addEventListener('statechange', this.onState);
      this.onState();
    } catch (err) {
      this.graph = null;
      this.stopListening();
      ctx?.close().catch(ignore);
      console.warn('audio unavailable', err);
    }
  }

  /** First key or pointer press: start the audio clock. Removed once the context runs. */
  private readonly onGesture = (): void => {
    const g = this.graph;
    if (!g) return;
    if (g.ctx.state === 'running') this.stopListening();
    else if (!this.silent) g.ctx.resume().catch(ignore);
  };

  private readonly onState = (): void => {
    if (this.graph?.ctx.state === 'running') this.stopListening();
  };

  private readonly onVisibility = (): void => {
    this.hidden = document.hidden;
    this.applyRunState();
  };

  private stopListening(): void {
    if (!this.listening) return;
    this.listening = false;
    for (const type of GESTURES) window.removeEventListener(type, this.onGesture, { capture: true });
  }

  private readonly suspend = (): void => {
    this.suspendTimer = 0;
    const g = this.graph;
    if (g && this.silent && g.ctx.state === 'running') g.ctx.suspend().catch(ignore);
  };

  /** Duck and suspend when silent; resume and fade back otherwise. */
  private applyRunState(): void {
    const g = this.graph;
    if (!g || this.silent === this.wasSilent) return;
    this.wasSilent = this.silent;
    if (this.silent) {
      g.aims.master.to(0, g.ctx.currentTime, AUDIO.master.duckTime);
      if (!this.suspendTimer) this.suspendTimer = window.setTimeout(this.suspend, AUDIO.master.suspendDelay * 1000);
      return;
    }
    if (this.suspendTimer) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = 0;
    }
    if (g.ctx.state !== 'running') g.ctx.resume().catch(ignore);
    this.fadeTime = AUDIO.master.resumeTime;
    this.fadeEnd = -1;
    // Whatever changed while silent is not an event: no shift blip or burble on the way back.
    this.prevGear = -1;
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    this.applyRunState();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.applyRunState();
  }

  update(frame: FrameState): void {
    const g = this.graph;
    if (!g || this.silent || g.ctx.state !== 'running') return;
    const now = g.ctx.currentTime;
    const aims = g.aims;
    const trim = this.trim;
    const car = frame.car;
    const pace = Math.hypot(car.vx, car.vz);
    const sr = clamp(frame.speedRatio, 0, 1);
    const tunnel = clamp(frame.tunnel, 0, 1);
    const load = map.engineLoad(frame.input.throttle, frame.input.brake, car.gear, car.boost);

    // ---- engine ----
    const E = AUDIO.engine;
    const hz = map.engineHz(car.rpm, frame.boost);
    map.engineLayerGains(car.rpm, map.idleWeight(pace, load), this.weights);
    for (let i = 0; i < aims.oscHz.length; i++) {
      aims.oscHz[i].to(hz, now, E.pitchTime);
      aims.layers[i].to(this.weights[i] * E.layers[i].gain, now, E.layerTime);
    }
    aims.drive.to(map.engineDrive(load), now, E.toneTime);
    aims.tone.to(map.engineCutoff(load), now, E.toneTime);
    aims.raspHz.to(map.raspHz(car.rpm), now, E.toneTime);
    aims.rasp.to(E.rasp * map.raspLevel(car.rpm, load), now, E.toneTime);
    aims.engine.to(map.engineBusGain(car.rpm, load) * trim.engine, now, E.gainTime);

    if (this.prevGear >= 0) {
      if (map.isUpshift(this.prevGear, car.gear, load)) this.shift(g, now);
      if (map.shouldBurble(this.prevLoad, load, car.boost, car.rpm, pace) && now - this.lastBurble > E.burbleCooldown) {
        this.lastBurble = now;
        this.play('burble', 1, 1);
      }
      if (car.boost && !this.prevBoost) this.play('nitro', 1, 1);
    }
    this.prevGear = car.gear;
    this.prevLoad = load;
    this.prevBoost = car.boost;

    // ---- tyres, wall, road, wind, kerb ----
    const S = AUDIO.screech;
    const squealRate = map.squealRate(frame.screech);
    aims.squealA.to(S.hzA * squealRate, now, S.time);
    aims.squealB.to(S.hzB * squealRate, now, S.time);
    aims.screech.to(S.gain * map.squealLevel(frame.screech) * trim.screech, now, S.time);

    const W = AUDIO.scrape;
    const scrapeRate = map.scrapeRate(sr);
    aims.scrapeA.to(W.hzA * scrapeRate, now, W.time);
    aims.scrapeB.to(W.hzB * scrapeRate, now, W.time);
    aims.scrape.to(W.gain * map.scrapeLevel(car.scrape, pace) * trim.scrape, now, W.time);
    // wallSide +1 = wall on the left = pan toward −1.
    aims.scrapePan.to(-car.wallSide * W.pan, now, W.time);

    aims.roadHz.to(AUDIO.road.hz * map.roadRate(sr), now, AUDIO.road.time);
    aims.road.to(AUDIO.road.gain * map.roadLevel(pace, sr) * trim.road, now, AUDIO.road.time);
    aims.windHz.to(AUDIO.wind.hz * map.windRate(sr), now, AUDIO.wind.time);
    aims.wind.to(AUDIO.wind.gain * map.windLevel(sr) * trim.wind, now, AUDIO.wind.time);
    aims.kerbHz.to(map.kerbHz(pace), now, AUDIO.kerb.time);
    aims.kerb.to(AUDIO.kerb.gain * map.kerbLevel(car.onKerb, pace) * trim.kerb, now, AUDIO.kerb.time);

    // ---- nitro, ambience ----
    const N = AUDIO.nitro;
    aims.roar.to(N.roarGain * map.roarLevel(frame.boost, frame.surge) * trim.roar, now, N.roarTime);
    aims.hiss.to(car.boost ? N.hissGain * trim.hiss : 0, now, car.boost ? N.hissAttack : N.hissRelease);
    const A = AUDIO.ambience;
    aims.ambience.to(A.gain * map.ambienceLevel(pace, tunnel, map.gust(frame.time)) * trim.ambience, now, A.time);
    aims.sfx.to(trim.sfx, now, AUDIO.master.duckTime);

    // ---- tunnel ----
    const T = AUDIO.tunnel;
    const wet = T.wet * map.tunnelWet(tunnel, sr) * trim.tunnel;
    if (wet > 0) {
      this.tunnelIdle = 0;
      if (!this.tunnelOn) {
        g.nodes.mix.connect(g.nodes.send);
        this.tunnelOn = true;
      }
    } else if (this.tunnelOn) {
      // Leave the wet path connected until the tail has rung out, then stop paying for the convolver.
      this.tunnelIdle += frame.dt;
      if (this.tunnelIdle > T.release) {
        g.nodes.mix.disconnect(g.nodes.send);
        this.tunnelOn = false;
      }
    }
    aims.send.to(wet, now, T.time);
    aims.shelf.to(T.shelfDb * tunnel, now, T.time);
    aims.boomHz.to(T.boomHarmonic * hz, now, E.pitchTime);

    // ---- output ----
    const M = AUDIO.master;
    if (this.fadeEnd < 0) this.fadeEnd = now + 5 * this.fadeTime;
    aims.master.to(M.volume * (1 + M.tunnelLift * tunnel), now, now < this.fadeEnd ? this.fadeTime : M.gainTime);
  }

  /** Upshift: the blip, and the engine dips while the gear goes in. */
  private shift(g: Graph, now: number): void {
    const E = AUDIO.engine;
    this.play('shift', 1, 1);
    const duck = g.nodes.duck.gain;
    duck.cancelScheduledValues(now);
    duck.setTargetAtTime(E.shiftDuck, now, E.shiftDown);
    duck.setTargetAtTime(1, now + E.shiftHold, E.shiftUp);
  }

  /** Start a one-shot. Returns false when nothing was played (audio not running). */
  private play(name: SfxName, volume: number, rate: number): boolean {
    const g = this.graph;
    if (!g || this.silent || g.ctx.state !== 'running') return false;
    const recipe = AUDIO.sfx.sounds[name];
    const source = g.ctx.createBufferSource();
    source.buffer = g.buffers[name];
    source.playbackRate.value = rate * (recipe.rate[0] + (recipe.rate[1] - recipe.rate[0]) * this.rng.next());
    g.nodes.sfxGains[name].gain.setTargetAtTime(recipe.volume * volume, g.ctx.currentTime, AUDIO.sfx.gainTime);
    source.connect(g.nodes.sfxGains[name]);
    source.start();
    return true;
  }

  onScore(e: ScoreEvent): void {
    const name = map.scoreSound(e);
    if (name) this.play(name, 1, map.scoreRate(e));
  }

  onLap(e: LapEvent): void {
    this.play('lap', 1, map.lapRate(e));
  }

  onPickup(e: PickupEvent): void {
    this.play(map.pickupSound(e), 1, 1);
  }

  impact(normalSpeed: number): void {
    const g = this.graph;
    const volume = map.crashVolume(normalSpeed);
    if (!g || volume <= 0 || g.ctx.currentTime - this.lastCrash < AUDIO.sfx.crashCooldown) return;
    if (this.play('crash', volume, 1)) this.lastCrash = g.ctx.currentTime;
  }

  dispose(): void {
    this.stopListening();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.suspendTimer) clearTimeout(this.suspendTimer);
    this.suspendTimer = 0;
    const g = this.graph;
    this.graph = null;
    if (g) {
      g.ctx.removeEventListener('statechange', this.onState);
      g.ctx.close().catch(ignore);
    }
  }
}

/**
 * Create the game's audio. Safe to call before any user gesture and in browsers without Web Audio.
 *
 * Tuning from the console, with `debug` exposed (for example as `__game.audio`):
 *   audio.solo('engine')            hear one source; several names allowed; solo() restores
 *   audio.mute('wind')              mute('wind', false) to bring it back
 *   audio.trim.screech = 0.5        scale a source
 *   audio.config.engine.gain = 0.3  edit the live config (src/config/audio.ts says which values are static)
 *   audio.retune()                  re-apply static values: wavetables, filter shapes, one-shot recipes
 *   audio.play('crash', 0.8)        audition a one-shot
 *   audio.nodes                     every Web Audio node by name
 */
export function createAudio(): AudioSystem {
  return new WebAudio();
}
