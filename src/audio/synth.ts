// Sample synthesis: the noise loop, the tunnel impulse, the engine wavetables and the one-shot buffers.
// Pure number crunching into Float32Arrays, no Web Audio, so it runs headless in tests. All of it runs once
// when the audio graph is built; nothing here is called per frame.

import { AUDIO, type EngineLayer, type NoiseSpec, type SfxRecipe, type ToneSpec } from '../config/audio';
import { CAR } from '../config/car';
import type { Rng } from '../core/rng';

const TAU = Math.PI * 2;
/** Envelope level below which a decaying voice is considered finished. */
const SILENCE = 1e-4;

/** Uniform white noise in [−1, 1). */
export function whiteNoise(samples: number, rng: Rng): Float32Array {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = rng.next() * 2 - 1;
  return out;
}

/** Gain of the fixed engine resonances at frequency `hz` (ENGINE.formants between the two envelope corners). */
export function engineEnvelope(hz: number): number {
  const E = AUDIO.engine;
  let e = 1;
  for (const [centre, gain, octaves] of E.formants) {
    const d = Math.log2(hz / centre) / octaves;
    e += gain * Math.exp(-d * d);
  }
  const top = hz / E.highCut;
  return (e * hz) / Math.hypot(hz, E.lowCut) / (1 + top * top);
}

/**
 * Fourier coefficients of one engine wavetable, for `createPeriodicWave(real, imag, { disableNormalization:
 * true })`. The fundamental is the engine cycle (two crank turns), so harmonic 10 is the firing frequency
 * of the V10 and harmonic 5 the 2.5th order. Scaled so the waveform's RMS is ENGINE.layerRms.
 */
export function engineWave(layer: EngineLayer, rng: Rng): { real: Float32Array; imag: Float32Array } {
  const E = AUDIO.engine;
  const cycleHz = (layer.ref * CAR.rpmRedline) / 120;
  const count = Math.max(E.firingHarmonic, Math.min(E.maxHarmonics, Math.floor(E.spectrumTop / cycleHz)));
  const real = new Float32Array(count + 1);
  const imag = new Float32Array(count + 1);
  const half = E.firingHarmonic / 2;
  let power = 0;
  for (let h = 1; h <= count; h++) {
    const series = h % E.firingHarmonic === 0 ? layer.firing : h % half === 0 ? layer.bank : layer.rough;
    const amp = series * Math.pow(Math.max(1, h / E.firingHarmonic), -layer.tilt) * engineEnvelope(h * cycleHz);
    const phase = (rng.next() * 2 - 1) * Math.PI * layer.phaseSpread;
    real[h] = amp * Math.cos(phase);
    imag[h] = amp * Math.sin(phase);
    power += (amp * amp) / 2;
  }
  const scale = power > 0 ? E.layerRms / Math.sqrt(power) : 0;
  for (let h = 1; h <= count; h++) {
    real[h] *= scale;
    imag[h] *= scale;
  }
  return { real, imag };
}

/** Soft-clipper transfer curve tanh(k·x) / tanh(k) over x = −1…1, for a WaveShaperNode. */
export function shaperCurve(k: number, points = 1025): Float32Array<ArrayBuffer> {
  const out = new Float32Array(points);
  const norm = Math.tanh(k);
  for (let i = 0; i < points; i++) out[i] = Math.tanh(k * ((i / (points - 1)) * 2 - 1)) / norm;
  return out;
}

/** One-pole low-pass coefficient for a corner at `hz`. */
const onePole = (hz: number, sampleRate: number): number => 1 - Math.exp((-TAU * hz) / sampleRate);

/** Gliding filters recompute their coefficient every this many samples (the glides are slow). */
const COEF_STEP = 32;

/**
 * Stereo impulse response of the snow gallery: decaying noise (−60 dB at TUNNEL.reverbTime) that gets
 * darker as it decays, independent per channel for width.
 */
export function tunnelImpulse(sampleRate: number, rng: Rng): [Float32Array, Float32Array] {
  const T = AUDIO.tunnel;
  const n = Math.max(1, Math.round(T.reverbTime * sampleRate));
  const decay = Math.exp(-6.9 / n);
  const channel = (): Float32Array => {
    const out = new Float32Array(n);
    let lp = 0;
    let env = 1;
    let coef = 0;
    for (let i = 0; i < n; i++) {
      if (i % COEF_STEP === 0) coef = onePole(T.brightHz * Math.pow(T.darkHz / T.brightHz, i / n), sampleRate);
      lp += coef * (rng.next() * 2 - 1 - lp);
      out[i] = lp * env;
      env *= decay;
    }
    return out;
  };
  return [channel(), channel()];
}

/** Samples a voice glides for, and its frequency `k` samples after its start. */
function glideSamples(spec: ToneSpec | NoiseSpec, sampleRate: number): number {
  return spec.to !== undefined && spec.glide ? spec.glide * sampleRate : 0;
}
function glideHz(spec: ToneSpec | NoiseSpec, k: number, samples: number): number {
  return samples > 0 ? spec.hz * Math.pow(spec.to! / spec.hz, Math.min(1, k / samples)) : spec.hz;
}

function addTone(out: Float32Array, sampleRate: number, spec: ToneSpec): void {
  const attack = Math.max(1, (spec.attack ?? AUDIO.sfx.attack) * sampleRate);
  const decay = Math.exp(-1 / (spec.decay * sampleRate));
  const glide = glideSamples(spec, sampleRate);
  const glideStep = glide > 0 ? Math.pow(spec.to! / spec.hz, 1 / glide) : 1;
  let step = (TAU * spec.hz) / sampleRate;
  let phase = 0;
  let env = spec.level;
  for (let i = Math.floor(spec.at * sampleRate), k = 0; i < out.length; i++, k++) {
    if (k >= attack && env < SILENCE) break;
    phase += step;
    out[i] += Math.sin(phase) * env * Math.min(1, k / attack);
    env *= decay;
    if (k < glide) step *= glideStep;
  }
}

function addNoise(out: Float32Array, sampleRate: number, spec: NoiseSpec, rng: Rng): void {
  const attack = Math.max(1, (spec.attack ?? AUDIO.sfx.attack) * sampleRate);
  const decay = Math.exp(-1 / (spec.decay * sampleRate));
  const glide = glideSamples(spec, sampleRate);
  const top = sampleRate * 0.45;
  let coef = 0;
  let bandCoef = 0;
  let lp = 0;
  let floor = 0;
  let env = spec.level;
  for (let i = Math.floor(spec.at * sampleRate), k = 0; i < out.length; i++, k++) {
    if (k >= attack && env < SILENCE) break;
    if (k === 0 || (k <= glide && k % COEF_STEP === 0)) {
      const cutoff = Math.min(glideHz(spec, k, glide), top);
      coef = onePole(cutoff, sampleRate);
      bandCoef = spec.band ? onePole(cutoff * spec.band, sampleRate) : 0;
    }
    lp += coef * (rng.next() * 2 - 1 - lp);
    floor += bandCoef * (lp - floor);
    out[i] += (lp - floor) * env * Math.min(1, k / attack);
    env *= decay;
  }
}

/** Render a one-shot recipe: mono, peak-normalised to SFX.peak, starting and ending at zero. */
export function renderSfx(recipe: SfxRecipe, sampleRate: number, rng: Rng): Float32Array {
  const S = AUDIO.sfx;
  const n = Math.max(2, Math.round(recipe.duration * sampleRate));
  const out = new Float32Array(n);
  for (const tone of recipe.tones) addTone(out, sampleRate, tone);
  for (const noise of recipe.noises) addNoise(out, sampleRate, noise, rng);
  const fade = Math.min(n - 1, Math.max(1, Math.round(S.fadeOut * sampleRate)));
  let peak = 0;
  for (let i = 0; i < n; i++) {
    if (i >= n - fade) out[i] *= (n - 1 - i) / fade;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  if (peak > 0) {
    const scale = S.peak / peak;
    for (let i = 0; i < n; i++) out[i] *= scale;
  }
  return out;
}

/** RMS of a buffer (tests and level estimates). */
export function rms(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / Math.max(1, buffer.length));
}

/**
 * Expected RMS of uniform white noise (±1) after a second-order Butterworth low-pass at `hz`: used to turn
 * "cents of pitch jitter" into the gain of the jitter path.
 */
export function lowpassNoiseRms(hz: number, sampleRate: number): number {
  // 1/√3 is the RMS of uniform noise; 1.1107 the noise bandwidth of a 2nd-order Butterworth over its corner.
  return Math.sqrt((1.1107 * hz) / (sampleRate / 2) / 3);
}
