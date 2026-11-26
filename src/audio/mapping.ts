// Game state → sound parameters. Pure functions, no Web Audio: unit-tested in tests/audio.test.ts and used
// by audio.ts every frame (nothing here allocates). Rules: docs/design/drift-gameplay.md §7.
//
// "Level" results are 0…1 and get multiplied by the source's gain in src/config/audio.ts; "rate" results are
// multipliers on a source's base frequency.

import { AUDIO, type SfxName } from '../config/audio';
import { CAR } from '../config/car';
import { clamp } from '../core/math';
import type { LapEvent } from '../gameplay/laps';
import type { PickupEvent } from '../gameplay/pickups';
import type { ScoreEvent } from '../gameplay/scoring';

const HALF_PI = Math.PI / 2;

/** Engine cycles (two crank turns) per second at rpm = 1: the fundamental of the engine wavetables. */
export const CYCLE_HZ_AT_REDLINE = CAR.rpmRedline / 120;

/** How hard the engine is working, 0…1: throttle, nitro, or the brake pedal while it acts as reverse throttle. */
export function engineLoad(throttle: number, brake: number, gear: number, boosting: boolean): number {
  if (boosting) return 1;
  return clamp(gear === 0 ? Math.max(throttle, brake) : throttle, 0, 1);
}

/** Wavetable fundamental, Hz, for rpm 0…1 and the smoothed nitro level 0…1. Strictly rising above minRpm. */
export function engineHz(rpm: number, boost: number): number {
  const E = AUDIO.engine;
  return Math.max(E.minRpm, rpm) * CYCLE_HZ_AT_REDLINE * (1 + (E.nitroPitch - 1) * clamp(boost, 0, 1));
}

/** Share of the idle voice, 0…1: full at rest, gone by idleFadeSpeed, reduced with the throttle down. */
export function idleWeight(pace: number, load: number): number {
  const E = AUDIO.engine;
  return clamp(1 - pace / E.idleFadeSpeed, 0, 1) * (1 - (1 - E.idleOnThrottle) * clamp(load, 0, 1));
}

/**
 * Crossfade weights of the engine wavetables: out[0] is the idle voice, out[1…] the rpm layers. The two
 * layers around `rpm` share the non-idle power with an equal-power crossfade in the log-rpm domain, so the
 * squares of all weights always sum to 1. Layer gains are not included.
 */
export function engineLayerGains(rpm: number, idle: number, out: Float32Array): void {
  const layers = AUDIO.engine.layers;
  const last = layers.length - 1;
  const i = clamp(idle, 0, 1);
  const rest = Math.sqrt(1 - i);
  out[0] = Math.sqrt(i);
  let k = 1;
  while (k < last - 1 && rpm >= layers[k + 1].ref) k++;
  const lo = layers[k].ref;
  const hi = layers[k + 1].ref;
  const x = clamp(Math.log(Math.max(rpm, 1e-4) / lo) / Math.log(hi / lo), 0, 1);
  for (let j = 1; j <= last; j++) out[j] = 0;
  out[k] = rest * Math.cos(x * HALF_PI);
  out[k + 1] = rest * Math.sin(x * HALF_PI);
}

/** Engine bus level: louder with rpm, quieter off the throttle. Includes ENGINE.gain. */
export function engineBusGain(rpm: number, load: number): number {
  const E = AUDIO.engine;
  const r = clamp(rpm, 0, 1);
  return E.gain * (E.levelIdle + (1 - E.levelIdle) * r) * (E.levelOff + (1 - E.levelOff) * clamp(load, 0, 1));
}

/** Engine bus low-pass cutoff, Hz: exponential between the closed- and open-throttle corners. */
export function engineCutoff(load: number): number {
  const E = AUDIO.engine;
  return E.cutoffOff * Math.pow(E.cutoffOn / E.cutoffOff, clamp(load, 0, 1));
}

/** Gain into the soft-clipper. */
export function engineDrive(load: number): number {
  const E = AUDIO.engine;
  return E.driveOff + (E.driveOn - E.driveOff) * clamp(load, 0, 1);
}

/** Intake rasp level 0…1 (before ENGINE.rasp) and its band centre, Hz. */
export function raspLevel(rpm: number, load: number): number {
  return clamp(rpm, 0, 1) * clamp(load, 0, 1);
}
export function raspHz(rpm: number): number {
  return AUDIO.engine.raspHz + AUDIO.engine.raspHzRange * clamp(rpm, 0, 1);
}

/** An upshift under power (the only shift that makes a sound: the benchmark's rule). */
export function isUpshift(prevGear: number, gear: number, load: number): boolean {
  return prevGear > 0 && gear > prevGear && load > 0;
}

/** Lift-off burble: the throttle was down last frame and is released now, at high rpm and speed, off nitro. */
export function shouldBurble(prevLoad: number, load: number, boosting: boolean, rpm: number, pace: number): boolean {
  const E = AUDIO.engine;
  return prevLoad > E.burbleFrom && load < E.burbleTo && !boosting && rpm > E.burbleRpm && pace > E.burbleSpeed;
}

export function squealLevel(screech: number): number {
  return clamp(screech, 0, 1);
}
export function squealRate(screech: number): number {
  return AUDIO.screech.rateBase + AUDIO.screech.rateRange * clamp(screech, 0, 1);
}

export function scrapeLevel(scrape: number, pace: number): number {
  return clamp(scrape, 0, 1) * clamp(pace / AUDIO.scrape.fullSpeed, 0, 1);
}
export function scrapeRate(speedRatio: number): number {
  return 1 + AUDIO.scrape.rateRange * clamp(speedRatio, 0, 1);
}

export function roadLevel(pace: number, speedRatio: number): number {
  return clamp(pace / AUDIO.road.fullSpeed, 0, 1) * (0.5 + 0.5 * clamp(speedRatio, 0, 1));
}
export function roadRate(speedRatio: number): number {
  return AUDIO.road.rateBase + AUDIO.road.rateRange * clamp(speedRatio, 0, 1);
}

export function windLevel(speedRatio: number): number {
  const s = clamp(speedRatio, 0, 1);
  return s * s;
}
export function windRate(speedRatio: number): number {
  return AUDIO.wind.rateBase + AUDIO.wind.rateRange * clamp(speedRatio, 0, 1);
}

export function kerbLevel(onKerb: boolean, pace: number): number {
  return onKerb ? clamp(pace / AUDIO.kerb.fullSpeed, 0, 1) : 0;
}
/** Rumble frequency, Hz: the rate the tyre meets the kerb ribs. */
export function kerbHz(pace: number): number {
  return clamp(pace / AUDIO.kerb.pitch, AUDIO.kerb.minHz, AUDIO.kerb.maxHz);
}

/** Nitro roar level from the smoothed boost level and the full-tank surge. */
export function roarLevel(boost: number, surge: number): number {
  return clamp(boost, 0, 1) * (1 - AUDIO.nitro.surgeShare * (1 - clamp(surge, 0, 1)));
}

/** Outdoor ambience level; `gust` is a slow 0…1 noise. */
export function ambienceLevel(pace: number, tunnel: number, gust: number): number {
  const A = AUDIO.ambience;
  const open = 1 - clamp(tunnel, 0, 1);
  const calm = 1 - A.speedDuck * clamp(pace / A.duckSpeed, 0, 1);
  return open * calm * (A.gustFloor + (1 - A.gustFloor) * clamp(gust, 0, 1));
}

/** Tunnel wet amount 0…1 (before TUNNEL.wet): more reverb the faster the car goes. */
export function tunnelWet(tunnel: number, speedRatio: number): number {
  const T = AUDIO.tunnel;
  return clamp(tunnel, 0, 1) * (T.wetFloor + (1 - T.wetFloor) * clamp(speedRatio, 0, 1));
}

/** Crash volume 0…1 for a wall impact at `normalSpeed` m/s; 0 = too soft to make a sound. */
export function crashVolume(normalSpeed: number): number {
  const S = AUDIO.sfx;
  return normalSpeed > S.crashMin ? Math.min(1, normalSpeed / S.crashFull) : 0;
}

/** Which one-shot a score event plays (null = silent) and at what playback rate. */
export function scoreSound(e: ScoreEvent): SfxName | null {
  if (e.type === 'link') return 'link';
  if (e.type === 'banked') return 'bank';
  if (e.type === 'wiped') return 'wipe';
  return null;
}
export function scoreRate(e: ScoreEvent): number {
  return e.type === 'link' ? Math.pow(2, Math.max(0, e.mult - 2) / AUDIO.sfx.linkStep) : 1;
}

export function lapRate(e: LapEvent): number {
  return e.best ? AUDIO.sfx.bestLapRate : 1;
}

export function pickupSound(e: PickupEvent): SfxName {
  return e.type === 'full' ? 'full' : 'pickup';
}

/** Slow wind-gust curve 0…1 at render time `time` s: two incommensurate sines, nothing to seed or allocate. */
export function gust(time: number): number {
  const w = Math.PI * 2 * AUDIO.ambience.gustRate * time;
  return 0.5 + 0.25 * (Math.sin(w) + Math.sin(w * 1.618 + 1));
}
