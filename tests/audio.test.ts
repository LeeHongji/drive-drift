import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudio } from '../src/audio/audio';
import * as map from '../src/audio/mapping';
import { engineWave, renderSfx, rms, shaperCurve, tunnelImpulse, whiteNoise } from '../src/audio/synth';
import { AUDIO, type SfxName } from '../src/config/audio';
import { CAR } from '../src/config/car';
import { SIM_DT } from '../src/config/sim';
import type { FrameState } from '../src/core/frame';
import { Rng } from '../src/core/rng';
import { autopilotInput } from '../src/debug/autopilot';
import { Session } from '../src/gameplay/session';
import { makeCar, type CarInput, type CarState } from '../src/vehicle/car';
import { mainTrack } from './helpers';

const SAMPLE_RATE = 48000;
const LAYERS = AUDIO.engine.layers;
const input = (o: Partial<CarInput> = {}): CarInput => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false, ...o });

describe('engine mapping', () => {
  const weights = new Float32Array(LAYERS.length);
  const power = (): number => weights.reduce((sum, w) => sum + w * w, 0);

  it('keeps the layer power constant over the rpm range, for any idle share', () => {
    for (const idle of [0, 0.3, 0.7, 1]) {
      for (let rpm = 0.02; rpm <= 1.2; rpm += 0.001) {
        map.engineLayerGains(rpm, idle, weights);
        expect(power()).toBeCloseTo(1, 5);
        for (const w of weights) {
          expect(w).toBeGreaterThanOrEqual(0);
          expect(w).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('crossfades continuously in rpm and in the idle share', () => {
    const prev = new Float32Array(LAYERS.length);
    map.engineLayerGains(0.02, 0, prev);
    for (let rpm = 0.021; rpm <= 1.2; rpm += 0.001) {
      map.engineLayerGains(rpm, 0, weights);
      for (let i = 0; i < weights.length; i++) expect(Math.abs(weights[i] - prev[i])).toBeLessThan(0.02);
      prev.set(weights);
    }
    map.engineLayerGains(0.5, 0, prev);
    for (let idle = 0.01; idle <= 1; idle += 0.01) {
      map.engineLayerGains(0.5, idle, weights);
      for (let i = 0; i < weights.length; i++) expect(Math.abs(weights[i] - prev[i])).toBeLessThan(0.11);
      prev.set(weights);
    }
  });

  it('plays each layer alone at its reference rpm, and at most two rpm layers at once', () => {
    for (let k = 1; k < LAYERS.length; k++) {
      map.engineLayerGains(LAYERS[k].ref, 0, weights);
      expect(weights[k]).toBeCloseTo(1, 6);
    }
    for (let rpm = 0.05; rpm <= 1; rpm += 0.01) {
      map.engineLayerGains(rpm, 0, weights);
      expect(weights[0]).toBe(0);
      expect(weights.filter((w) => w > 1e-6).length).toBeLessThanOrEqual(2);
    }
    // Reference rpms rise, so the pair search is valid.
    for (let k = 2; k < LAYERS.length; k++) expect(LAYERS[k].ref).toBeGreaterThan(LAYERS[k - 1].ref);
  });

  it('raises the pitch monotonically with rpm, to the V10 firing frequency at the redline', () => {
    let prev = map.engineHz(0, 0);
    for (let rpm = 0.001; rpm <= 1.0001; rpm += 0.001) {
      const hz = map.engineHz(rpm, 0);
      expect(hz).toBeGreaterThanOrEqual(prev);
      if (rpm > AUDIO.engine.minRpm + 0.001) expect(hz).toBeGreaterThan(prev);
      prev = hz;
    }
    // 8500 rpm, 5 firings per crank turn: 708 Hz.
    expect(map.engineHz(1, 0) * AUDIO.engine.firingHarmonic).toBeCloseTo((CAR.rpmRedline / 60) * 5, 6);
    expect(map.engineHz(CAR.idleRpm, 0)).toBeGreaterThan(0);
    expect(map.engineHz(0.8, 1) / map.engineHz(0.8, 0)).toBeCloseTo(AUDIO.engine.nitroPitch, 6);
    expect(map.engineHz(0.8, 0.5)).toBeGreaterThan(map.engineHz(0.8, 0));
  });

  it('is brighter, harder driven and louder on the throttle', () => {
    expect(map.engineCutoff(0)).toBeCloseTo(AUDIO.engine.cutoffOff, 6);
    expect(map.engineCutoff(1)).toBeCloseTo(AUDIO.engine.cutoffOn, 6);
    expect(map.engineCutoff(0.5)).toBeGreaterThan(map.engineCutoff(0));
    expect(map.engineCutoff(0.5)).toBeLessThan(map.engineCutoff(1));
    expect(map.engineDrive(1)).toBeGreaterThan(map.engineDrive(0));
    expect(map.engineBusGain(0.8, 1)).toBeGreaterThan(map.engineBusGain(0.8, 0));
    expect(map.engineBusGain(1, 1)).toBeGreaterThan(map.engineBusGain(0.3, 1));
    expect(map.engineBusGain(1, 1)).toBeCloseTo(AUDIO.engine.gain, 6);
    expect(map.engineBusGain(CAR.idleRpm, 0)).toBeGreaterThan(0);
  });

  it('reads the load from throttle, nitro and the reverse pedal', () => {
    expect(map.engineLoad(0.7, 0, 3, false)).toBeCloseTo(0.7, 6);
    expect(map.engineLoad(0, 0, 3, true)).toBe(1);
    expect(map.engineLoad(0, 1, 3, false)).toBe(0); // braking is not load
    expect(map.engineLoad(0, 1, 0, false)).toBe(1); // reversing is
  });

  it('fades the idle voice out with road speed and under throttle', () => {
    expect(map.idleWeight(0, 0)).toBe(1);
    expect(map.idleWeight(0, 1)).toBeCloseTo(AUDIO.engine.idleOnThrottle, 6);
    expect(map.idleWeight(AUDIO.engine.idleFadeSpeed, 0)).toBe(0);
    expect(map.idleWeight(50, 1)).toBe(0);
  });

  it('detects upshifts under power and lift-off burbles', () => {
    expect(map.isUpshift(2, 3, 1)).toBe(true);
    expect(map.isUpshift(3, 2, 1)).toBe(false);
    expect(map.isUpshift(2, 3, 0)).toBe(false); // coasting
    expect(map.isUpshift(0, 1, 1)).toBe(false); // out of reverse
    expect(map.shouldBurble(1, 0, false, 0.8, 40)).toBe(true);
    expect(map.shouldBurble(1, 1, false, 0.8, 40)).toBe(false); // still on it
    expect(map.shouldBurble(0, 0, false, 0.8, 40)).toBe(false); // was already off
    expect(map.shouldBurble(1, 0, true, 0.8, 40)).toBe(false); // nitro
    expect(map.shouldBurble(1, 0, false, 0.4, 40)).toBe(false); // low rpm
    expect(map.shouldBurble(1, 0, false, 0.8, 10)).toBe(false); // slow
  });
});

describe('loop mapping', () => {
  it('keeps every level in 0…1 for any input, in or out of range', () => {
    const rng = new Rng(7);
    const wild = (): number => rng.range(-0.5, 1.5);
    for (let k = 0; k < 4000; k++) {
      const pace = rng.range(-10, 140);
      const levels = [
        map.squealLevel(wild()),
        map.scrapeLevel(wild(), pace),
        map.roadLevel(pace, wild()),
        map.windLevel(wild()),
        map.kerbLevel(rng.next() < 0.5, pace),
        map.roarLevel(wild(), wild()),
        map.ambienceLevel(pace, wild(), wild()),
        map.tunnelWet(wild(), wild()),
        map.raspLevel(wild(), wild()),
        map.crashVolume(rng.range(-5, 60)),
        map.idleWeight(pace, wild()),
        map.engineLoad(wild(), wild(), Math.floor(rng.range(0, 8)), rng.next() < 0.2),
        map.gust(rng.range(0, 5000)),
      ];
      for (const level of levels) {
        expect(level).toBeGreaterThanOrEqual(0);
        expect(level).toBeLessThanOrEqual(1);
      }
      for (const rate of [map.squealRate(wild()), map.scrapeRate(wild()), map.roadRate(wild()), map.windRate(wild())]) {
        expect(rate).toBeGreaterThan(0.5);
        expect(rate).toBeLessThan(1.5);
      }
      const hz = map.kerbHz(pace);
      expect(hz).toBeGreaterThanOrEqual(AUDIO.kerb.minHz);
      expect(hz).toBeLessThanOrEqual(AUDIO.kerb.maxHz);
    }
  });

  it('follows the game state it is meant to', () => {
    expect(map.squealLevel(0)).toBe(0);
    expect(map.squealLevel(0.6)).toBeCloseTo(0.6, 6);
    expect(map.squealRate(1)).toBeGreaterThan(map.squealRate(0));
    expect(map.scrapeLevel(1, 0)).toBe(0); // leaning on a wall at rest is silent
    expect(map.scrapeLevel(1, AUDIO.scrape.fullSpeed)).toBe(1);
    expect(map.roadLevel(0, 0)).toBe(0);
    expect(map.roadLevel(60, 0.6)).toBeGreaterThan(map.roadLevel(20, 0.2));
    expect(map.windLevel(0.5)).toBeCloseTo(0.25, 6); // ∝ speed²
    expect(map.kerbLevel(false, 40)).toBe(0);
    expect(map.kerbLevel(true, 0)).toBe(0);
    expect(map.kerbLevel(true, 40)).toBe(1);
    expect(map.kerbHz(60)).toBeGreaterThan(map.kerbHz(20));
    expect(map.roarLevel(0, 1)).toBe(0);
    expect(map.roarLevel(1, 1)).toBe(1);
    expect(map.roarLevel(1, 0)).toBeCloseTo(1 - AUDIO.nitro.surgeShare, 6);
    expect(map.ambienceLevel(0, 1, 1)).toBe(0); // silent in the tunnel
    expect(map.ambienceLevel(0, 0, 1)).toBe(1);
    expect(map.ambienceLevel(80, 0, 1)).toBeLessThan(map.ambienceLevel(0, 0, 1));
    expect(map.tunnelWet(0, 1)).toBe(0);
    expect(map.tunnelWet(1, 0)).toBeCloseTo(AUDIO.tunnel.wetFloor, 6);
    expect(map.tunnelWet(1, 1)).toBe(1);
  });
});

describe('event sounds', () => {
  it('maps score events: link pitch rises with the multiplier, dropped is silent', () => {
    expect(map.scoreSound({ type: 'link', mult: 2 })).toBe('link');
    expect(map.scoreSound({ type: 'banked', points: 100, metres: 50, mult: 2 })).toBe('bank');
    expect(map.scoreSound({ type: 'wiped', metres: 50, mult: 2 })).toBe('wipe');
    expect(map.scoreSound({ type: 'dropped' })).toBeNull();
    expect(map.scoreRate({ type: 'link', mult: 2 })).toBe(1);
    let prev = 1;
    for (let mult = 3; mult <= 5; mult++) {
      const rate = map.scoreRate({ type: 'link', mult });
      expect(rate).toBeGreaterThan(prev);
      prev = rate;
    }
    expect(map.scoreRate({ type: 'link', mult: 5 })).toBeCloseTo(Math.SQRT2, 6);
    expect(map.scoreRate({ type: 'banked', points: 100, metres: 50, mult: 4 })).toBe(1);
  });

  it('pitches a best lap up and tells a shard from a full tank', () => {
    expect(map.lapRate({ lap: 1, time: 80, best: false })).toBe(1);
    expect(map.lapRate({ lap: 2, time: 75, best: true })).toBeCloseTo(1.26, 6);
    expect(map.pickupSound({ type: 'collected', index: 0, nitro: 0.5 })).toBe('pickup');
    expect(map.pickupSound({ type: 'full' })).toBe('full');
  });

  it('scales the crash with the impact speed', () => {
    expect(map.crashVolume(AUDIO.sfx.crashMin)).toBe(0);
    expect(map.crashVolume(6)).toBeCloseTo(6 / AUDIO.sfx.crashFull, 6);
    expect(map.crashVolume(12)).toBeCloseTo(2 * map.crashVolume(6), 6);
    expect(map.crashVolume(50)).toBe(1);
  });
});

describe('synthesis', () => {
  it('renders every one-shot click-free, peak-normalised and repeatable', () => {
    for (const [name, recipe] of Object.entries(AUDIO.sfx.sounds)) {
      const buffer = renderSfx(recipe, SAMPLE_RATE, new Rng(1));
      expect(buffer.length, name).toBe(Math.round(recipe.duration * SAMPLE_RATE));
      let peak = 0;
      for (const v of buffer) {
        expect(Number.isFinite(v)).toBe(true);
        peak = Math.max(peak, Math.abs(v));
      }
      expect(peak, name).toBeCloseTo(AUDIO.sfx.peak, 5);
      expect(Math.abs(buffer[0]), name).toBeLessThan(1e-3);
      expect(Math.abs(buffer[buffer.length - 1]), name).toBeLessThan(1e-6);
      // Audible, and conservative once the playback volume is applied.
      expect(rms(buffer), name).toBeGreaterThan(0.05);
      expect(recipe.volume * AUDIO.sfx.peak, name).toBeLessThanOrEqual(0.8);
      expect(recipe.rate[0]).toBeLessThanOrEqual(recipe.rate[1]);
      for (const voice of [...recipe.tones, ...recipe.noises]) expect(voice.at, name).toBeLessThan(recipe.duration);
      expect(renderSfx(recipe, SAMPLE_RATE, new Rng(1)), name).toEqual(buffer);
    }
  });

  it('builds engine wavetables with the set RMS and a V10 harmonic structure', () => {
    const firing = AUDIO.engine.firingHarmonic;
    for (const layer of LAYERS) {
      const { real, imag } = engineWave(layer, new Rng(3));
      expect(real.length).toBe(imag.length);
      expect(real.length - 1).toBeLessThanOrEqual(AUDIO.engine.maxHarmonics);
      expect(real[0]).toBe(0);
      expect(imag[0]).toBe(0);
      const amp = (h: number): number => Math.hypot(real[h], imag[h]);
      let power = 0;
      for (let h = 1; h < real.length; h++) power += (amp(h) * amp(h)) / 2;
      expect(Math.sqrt(power)).toBeCloseTo(AUDIO.engine.layerRms, 5);
      // The firing note and the per-bank half order stand clear of their neighbours.
      expect(amp(firing)).toBeGreaterThan(2 * amp(firing + 1));
      expect(amp(firing)).toBeGreaterThan(2 * amp(firing - 1));
      expect(amp(firing / 2)).toBeGreaterThan(amp(firing / 2 + 1));
      // No energy above the audible top the table was built for.
      const cycleHz = (layer.ref * CAR.rpmRedline) / 120;
      expect((real.length - 1) * cycleHz).toBeLessThanOrEqual(Math.max(AUDIO.engine.spectrumTop, firing * cycleHz));
    }
    // Same seed, same table; layers do not share phases (they are crossfaded with equal power).
    expect(engineWave(LAYERS[1], new Rng(3)).real).toEqual(engineWave(LAYERS[1], new Rng(3)).real);
    expect(engineWave(LAYERS[1], new Rng(3)).real).not.toEqual(engineWave(LAYERS[1], new Rng(4)).real);
  });

  it('makes an odd, monotonic soft-clip curve that ends at ±1', () => {
    const curve = shaperCurve(AUDIO.engine.shaperK);
    const n = curve.length;
    expect(curve[0]).toBeCloseTo(-1, 6);
    expect(curve[n - 1]).toBeCloseTo(1, 6);
    expect(curve[(n - 1) / 2]).toBeCloseTo(0, 6);
    for (let i = 1; i < n; i++) {
      expect(curve[i]).toBeGreaterThan(curve[i - 1]);
      expect(curve[i]).toBeCloseTo(-curve[n - 1 - i], 6);
    }
  });

  it('makes bounded noise and a decaying, darkening stereo tunnel impulse', () => {
    const noise = whiteNoise(SAMPLE_RATE, new Rng(5));
    let mean = 0;
    for (const v of noise) {
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThan(1);
      mean += v / noise.length;
    }
    expect(Math.abs(mean)).toBeLessThan(0.01);
    expect(rms(noise)).toBeCloseTo(1 / Math.sqrt(3), 2);

    const [left, right] = tunnelImpulse(SAMPLE_RATE, new Rng(5));
    const n = left.length;
    expect(n).toBe(Math.round(AUDIO.tunnel.reverbTime * SAMPLE_RATE));
    expect(right.length).toBe(n);
    expect(left).not.toEqual(right);
    const tenth = Math.floor(n / 10);
    expect(rms(left.subarray(n - tenth))).toBeLessThan(0.01 * rms(left.subarray(0, tenth)));
    for (const v of left) expect(Number.isFinite(v)).toBe(true);
    // Darker tail: fewer sign changes per sample at the end than at the start.
    const crossings = (a: Float32Array): number => {
      let c = 0;
      for (let i = 1; i < a.length; i++) if (a[i] > 0 !== a[i - 1] > 0) c++;
      return c;
    };
    expect(crossings(left.subarray(n - tenth))).toBeLessThan(crossings(left.subarray(0, tenth)));
  });
});

describe('mapping on a real lap', () => {
  it('stays finite and in range on the autopilot, and hears every upshift', () => {
    const session = new Session(mainTrack());
    const drive = input();
    const weights = new Float32Array(LAYERS.length);
    let prevGear = -1;
    let upshifts = 0;
    let topGear = 1;
    for (let k = 0; k < Math.round(40 / SIM_DT); k++) {
      autopilotInput(session.car, session.track, drive);
      session.step(drive);
      const car = session.car;
      const pace = Math.hypot(car.vx, car.vz);
      const load = map.engineLoad(drive.throttle, drive.brake, car.gear, car.boost);
      map.engineLayerGains(car.rpm, map.idleWeight(pace, load), weights);
      const values = [map.engineHz(car.rpm, 0), map.engineBusGain(car.rpm, load), map.engineCutoff(load), map.kerbHz(pace), ...weights];
      for (const v of values) expect(Number.isFinite(v)).toBe(true);
      expect(weights.reduce((sum, w) => sum + w * w, 0)).toBeCloseTo(1, 5);
      if (prevGear >= 0 && map.isUpshift(prevGear, car.gear, load)) upshifts++;
      prevGear = car.gear;
      topGear = Math.max(topGear, car.gear);
    }
    expect(topGear).toBeGreaterThanOrEqual(4);
    expect(upshifts).toBeGreaterThanOrEqual(topGear - 1);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The Web Audio graph against a recording fake: no sound, but it proves the graph builds, every scheduled
// value is finite, steady frames schedule nothing, and the gesture / pause / mute / event rules hold.
// ---------------------------------------------------------------------------------------------------------

class FakeParam {
  value = 0;
  calls = 0;
  targets: number[] = [];
  setTargetAtTime(value: number, time: number, constant: number): this {
    if (![value, time, constant].every(Number.isFinite) || constant <= 0) throw new Error(`bad automation ${value} ${time} ${constant}`);
    this.calls++;
    this.targets.push(value);
    this.value = value;
    return this;
  }
  cancelScheduledValues(): this {
    return this;
  }
}

class FakeNode {
  static readonly PARAMS = ['gain', 'frequency', 'detune', 'Q', 'delayTime', 'pan', 'playbackRate', 'threshold', 'knee', 'ratio', 'attack', 'release'] as const;
  readonly outputs: unknown[] = [];
  started = false;
  buffer: unknown = null;
  [key: string]: unknown;
  constructor(readonly kind: string) {
    for (const name of FakeNode.PARAMS) this[name] = new FakeParam();
  }
  connect(target: unknown): unknown {
    this.outputs.push(target);
    return target;
  }
  disconnect(target: unknown): void {
    const i = this.outputs.indexOf(target);
    if (i < 0) throw new Error('disconnect of a node that is not connected');
    this.outputs.splice(i, 1);
  }
  start(): void {
    this.started = true;
  }
  setPeriodicWave(): void {}
}

class FakeContext {
  static last: FakeContext;
  /** State a new context starts in: 'suspended' = no user gesture yet. */
  static initial: 'suspended' | 'running' = 'running';
  sampleRate = SAMPLE_RATE;
  currentTime = 0;
  state: string = FakeContext.initial;
  destination = new FakeNode('destination');
  nodes: FakeNode[] = [];
  resumes = 0;
  suspends = 0;
  private listeners: (() => void)[] = [];
  constructor() {
    FakeContext.last = this;
  }
  private make(kind: string): FakeNode {
    const node = new FakeNode(kind);
    this.nodes.push(node);
    return node;
  }
  createGain = (): FakeNode => this.make('gain');
  createBiquadFilter = (): FakeNode => this.make('biquad');
  createDynamicsCompressor = (): FakeNode => this.make('compressor');
  createConvolver = (): FakeNode => this.make('convolver');
  createDelay = (): FakeNode => this.make('delay');
  createWaveShaper = (): FakeNode => this.make('shaper');
  createOscillator = (): FakeNode => this.make('oscillator');
  createStereoPanner = (): FakeNode => this.make('panner');
  createBufferSource = (): FakeNode => this.make('source');
  createPeriodicWave = (): object => ({});
  createBuffer(channels: number, length: number): object {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { getChannelData: (c: number) => data[c] };
  }
  addEventListener(_type: string, fn: () => void): void {
    this.listeners.push(fn);
  }
  removeEventListener(): void {}
  private setState(state: string): Promise<void> {
    this.state = state;
    for (const fn of this.listeners) fn();
    return Promise.resolve();
  }
  resume(): Promise<void> {
    this.resumes++;
    return this.setState('running');
  }
  suspend(): Promise<void> {
    this.suspends++;
    return this.setState('suspended');
  }
  close = (): Promise<void> => this.setState('closed');
  sources(): FakeNode[] {
    return this.nodes.filter((n) => n.kind === 'source' && !(n as { loop?: boolean }).loop);
  }
  params(): FakeParam[] {
    return this.nodes.flatMap((n) => FakeNode.PARAMS.map((p) => n[p] as FakeParam));
  }
  scheduled(): number {
    return this.params().reduce((sum, p) => sum + p.calls, 0);
  }
}

/** Minimal window / document: just the listeners and timers audio.ts uses. */
function fakeBrowser(initial: 'suspended' | 'running') {
  FakeContext.initial = initial;
  const handlers = new Map<string, () => void>();
  const page = { hidden: false, handlers: new Map<string, () => void>() };
  vi.stubGlobal('AudioContext', FakeContext);
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: () => void) => handlers.set(type, fn),
    removeEventListener: (type: string) => handlers.delete(type),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  });
  vi.stubGlobal('document', {
    get hidden() {
      return page.hidden;
    },
    addEventListener: (type: string, fn: () => void) => page.handlers.set(type, fn),
    removeEventListener: (type: string) => page.handlers.delete(type),
  });
  return { handlers, page };
}

function frameOf(car: CarState, drive: CarInput, o: Partial<FrameState> = {}): FrameState {
  const pace = Math.hypot(car.vx, car.vz);
  return {
    dt: 1 / 60, time: 0, car, input: drive, x: car.x, y: car.y, z: car.z, yaw: car.yaw,
    speedRatio: Math.min(1, pace / 100), boost: 0, surge: 0, screech: 0, tunnel: 0,
    ...o,
  } as FrameState;
}

/** A car at `pace` m/s in `gear`. */
function carAt(pace: number, gear: number, o: Partial<CarState> = {}): CarState {
  return { ...makeCar(), vz: -pace, speed: pace, gear, rpm: Math.min(1, pace / CAR.gearTop[gear - 1]), ...o };
}

describe('audio system', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('is a safe no-op without Web Audio', () => {
    const audio = createAudio();
    const car = carAt(40, 3);
    expect(() => {
      audio.update(frameOf(car, input({ throttle: 1 })));
      audio.onScore({ type: 'link', mult: 2 });
      audio.onLap({ lap: 1, time: 80, best: true });
      audio.onPickup({ type: 'full' });
      audio.impact(12);
      audio.setPaused(true);
      audio.setPaused(false);
      audio.setMuted(true);
      audio.debug.solo('engine');
      audio.debug.retune();
      audio.debug.play('crash');
      audio.dispose();
    }).not.toThrow();
    expect(audio.muted).toBe(true);
    expect(audio.debug.status().state).toBe('unavailable');
    expect(audio.debug.nodes).toBeNull();
  });

  it('waits for the first gesture, then removes its listeners', () => {
    const { handlers } = fakeBrowser('suspended');
    const audio = createAudio();
    const ctx = FakeContext.last;
    expect([...handlers.keys()].sort()).toEqual(['keydown', 'pointerdown', 'pointerup', 'touchend']);
    const before = ctx.scheduled();
    audio.update(frameOf(carAt(40, 3), input({ throttle: 1 })));
    audio.onScore({ type: 'link', mult: 2 });
    audio.impact(12);
    expect(ctx.scheduled()).toBe(before);
    expect(ctx.sources()).toHaveLength(0);
    expect(ctx.resumes).toBe(0);

    handlers.get('keydown')!();
    expect(ctx.resumes).toBe(1);
    expect(ctx.state).toBe('running');
    expect(handlers.size).toBe(0);
    audio.update(frameOf(carAt(40, 3), input({ throttle: 1 })));
    expect(ctx.scheduled()).toBeGreaterThan(before);
  });

  it('builds a modest graph and schedules only finite values, and nothing at all in a steady state', () => {
    fakeBrowser('running');
    const audio = createAudio();
    const ctx = FakeContext.last;
    const built = ctx.nodes.length;
    expect(audio.debug.status().nodes).toBe(built);
    expect(built).toBeLessThanOrEqual(80);
    expect(ctx.nodes.filter((n) => n.kind === 'oscillator' || (n.kind === 'source' && n.buffer)).every((n) => n.started)).toBe(true);
    for (const p of ctx.params()) expect(Number.isFinite(p.value)).toBe(true);

    // A real drive: every automation call is validated by FakeParam.
    const session = new Session(mainTrack());
    const drive = input();
    for (let f = 0; f < 60 * 30; f++) {
      for (let k = 0; k < 2; k++) {
        autopilotInput(session.car, session.track, drive);
        session.step(drive);
        if (session.car.hit > 0) audio.impact(session.car.hit);
      }
      ctx.currentTime += 1 / 60;
      const car = session.car;
      audio.update(frameOf(car, drive, { time: f / 60, screech: (f % 200) / 200, tunnel: f > 600 && f < 900 ? 1 : 0, boost: car.boost ? 1 : 0 }));
    }
    for (const p of ctx.params()) expect(Number.isFinite(p.value)).toBe(true);
    const nodes = audio.debug.nodes!;
    expect((nodes.engine.gain as unknown as FakeParam).value).toBeGreaterThan(0);
    expect((nodes.master.gain as unknown as FakeParam).value).toBeCloseTo(AUDIO.master.volume, 6);
    // Only one-shot sources are ever added after the build.
    expect(ctx.nodes.slice(built).every((n) => n.kind === 'source')).toBe(true);
    expect(ctx.sources().length).toBeGreaterThan(0); // upshifts on the way up

    // The same frame again and again: the first settles the targets, the rest schedule nothing.
    const car = carAt(50, 5);
    const steady = frameOf(car, input({ throttle: 1 }), { time: 3 });
    audio.update(steady);
    const settled = ctx.scheduled();
    for (let f = 0; f < 10; f++) {
      ctx.currentTime += 1 / 60;
      audio.update(steady);
    }
    expect(ctx.scheduled()).toBe(settled);
  });

  it('plays the shift blip with an engine duck, the burble, and one crash per cooldown', () => {
    fakeBrowser('running');
    const audio = createAudio();
    const ctx = FakeContext.last;
    const nodes = audio.debug.nodes!;
    const duck = nodes.duck.gain as unknown as FakeParam;
    const gas = input({ throttle: 1 });
    const step = (car: CarState, drive: CarInput): void => {
      ctx.currentTime += 1 / 60;
      audio.update(frameOf(car, drive));
    };

    const count = (name: SfxName): number => ctx.sources().filter((n) => n.outputs[0] === nodes.sfxGains[name]).length;

    step(carAt(26, 2), gas);
    expect(ctx.sources()).toHaveLength(0);
    step(carAt(28, 3), gas); // upshift
    expect(count('shift')).toBe(1);
    expect(ctx.sources()).toHaveLength(1);
    expect(duck.targets).toEqual([AUDIO.engine.shiftDuck, 1]);
    step(carAt(20, 2), gas); // downshift: silent
    step(carAt(20, 3), input()); // upshift while coasting: silent
    expect(ctx.sources()).toHaveLength(1);

    step(carAt(45, 3, { rpm: 0.9 }), gas);
    expect(count('burble')).toBe(0);
    step(carAt(45, 3, { rpm: 0.9 }), input()); // lift-off at high rpm
    expect(count('burble')).toBe(1);
    step(carAt(45, 3, { rpm: 0.9 }), gas);
    step(carAt(45, 3, { rpm: 0.9 }), input()); // again inside the cooldown
    expect(count('burble')).toBe(1);

    audio.impact(2); // too soft
    expect(count('crash')).toBe(0);
    audio.impact(9);
    audio.impact(9); // inside the cooldown
    expect(count('crash')).toBe(1);
    expect((nodes.sfxGains.crash.gain as unknown as FakeParam).value).toBeCloseTo(AUDIO.sfx.sounds.crash.volume * (9 / AUDIO.sfx.crashFull), 6);
    ctx.currentTime += AUDIO.sfx.crashCooldown + 0.01;
    audio.impact(9);
    expect(count('crash')).toBe(2);
    expect(count('shift')).toBe(1);
  });

  it('pitches event sounds: link by multiplier, lap by best', () => {
    fakeBrowser('running');
    const audio = createAudio();
    const ctx = FakeContext.last;
    const rate = (i: number): number => (ctx.sources()[i].playbackRate as FakeParam).value;
    audio.onScore({ type: 'link', mult: 2 });
    audio.onScore({ type: 'link', mult: 5 });
    audio.onScore({ type: 'dropped' });
    audio.onLap({ lap: 1, time: 80, best: false });
    audio.onLap({ lap: 2, time: 75, best: true });
    audio.onPickup({ type: 'collected', index: 3, nitro: 0.8 });
    expect(ctx.sources()).toHaveLength(5);
    expect(rate(1) / rate(0)).toBeCloseTo(Math.SQRT2, 6);
    expect(rate(3) / rate(2)).toBeCloseTo(AUDIO.sfx.bestLapRate, 6);
    const names: SfxName[] = ['link', 'link', 'lap', 'lap', 'pickup'];
    names.forEach((name, i) => expect(ctx.sources()[i].outputs[0]).toBe(audio.debug.nodes!.sfxGains[name]));
  });

  it('ducks and suspends on pause and mute, and comes back', () => {
    vi.useFakeTimers();
    fakeBrowser('running');
    const audio = createAudio();
    const ctx = FakeContext.last;
    const master = audio.debug.nodes!.master.gain as unknown as FakeParam;
    const frame = frameOf(carAt(40, 3), input({ throttle: 1 }));
    audio.update(frame);
    expect(master.value).toBeCloseTo(AUDIO.master.volume, 6);

    audio.setPaused(true);
    expect(master.value).toBe(0);
    expect(ctx.suspends).toBe(0); // the duck comes first
    const quiet = ctx.scheduled();
    audio.update(frame);
    audio.onScore({ type: 'link', mult: 2 });
    expect(ctx.scheduled()).toBe(quiet);
    expect(ctx.sources()).toHaveLength(0);
    vi.advanceTimersByTime(AUDIO.master.suspendDelay * 1000 + 10);
    expect(ctx.state).toBe('suspended');

    audio.setPaused(false);
    expect(ctx.state).toBe('running');
    audio.update(frame);
    expect(master.value).toBeCloseTo(AUDIO.master.volume, 6);

    audio.setMuted(true);
    expect(audio.muted).toBe(true);
    expect(master.value).toBe(0);
    audio.setMuted(false); // before the suspend timer fires: it must be cancelled
    vi.advanceTimersByTime(AUDIO.master.suspendDelay * 1000 + 10);
    expect(ctx.state).toBe('running');
    audio.update(frame);
    expect(master.value).toBeCloseTo(AUDIO.master.volume, 6);
  });

  it('connects the tunnel reverb only while it is needed, and solo silences the other sources', () => {
    fakeBrowser('running');
    const audio = createAudio();
    const ctx = FakeContext.last;
    const nodes = audio.debug.nodes!;
    const mix = nodes.mix as unknown as FakeNode;
    const car = carAt(50, 5);
    const gas = input({ throttle: 1 });
    const step = (o: Partial<FrameState>): void => {
      ctx.currentTime += 0.5;
      audio.update(frameOf(car, gas, { dt: 0.5, ...o }));
    };
    step({ tunnel: 0 });
    expect(mix.outputs).not.toContain(nodes.send);
    step({ tunnel: 1 });
    expect(mix.outputs).toContain(nodes.send);
    expect((nodes.send.gain as unknown as FakeParam).value).toBeGreaterThan(0);
    step({ tunnel: 0 });
    expect(mix.outputs).toContain(nodes.send); // the tail is still ringing
    for (let k = 0; k < AUDIO.tunnel.release / 0.5 + 1; k++) step({ tunnel: 0 });
    expect(mix.outputs).not.toContain(nodes.send);

    step({ screech: 1 });
    expect((nodes.screech.gain as unknown as FakeParam).value).toBeGreaterThan(0);
    audio.debug.solo('engine');
    step({ screech: 1 });
    expect((nodes.screech.gain as unknown as FakeParam).value).toBe(0);
    expect((nodes.road.gain as unknown as FakeParam).value).toBe(0);
    expect((nodes.engine.gain as unknown as FakeParam).value).toBeGreaterThan(0);
    audio.debug.solo();
    step({ screech: 1 });
    expect((nodes.screech.gain as unknown as FakeParam).value).toBeGreaterThan(0);
  });
});
