// Drift scoring: metres drifted × chain multiplier. Pure logic.

import { SCORING } from '../config/scoring';
import { CAR } from '../config/car';
import { clamp } from '../core/math';
import type { CarState } from '../vehicle/car';

export type ScoreEvent =
  /** A new drift linked into the running chain; `mult` is the new multiplier. */
  | { type: 'link'; mult: number }
  /** The chain was paid out. */
  | { type: 'banked'; points: number; metres: number; mult: number }
  /** The chain ended too short to count. */
  | { type: 'dropped' }
  /** The chain was lost to a wall. */
  | { type: 'wiped'; metres: number; mult: number };

export interface ScoreState {
  /** True from the first drift of a chain until it is banked, dropped or wiped. */
  active: boolean;
  /** Metres in the running chain. */
  chain: number;
  mult: number;
  /** Seconds left to link another drift (full while drifting). */
  window: number;
  drifting: boolean;
  /** Points banked this session. */
  total: number;
  /** Points banked since the last lap line (reset by the session on each lap). */
  lapPoints: number;
  bestChain: number;
  events: ScoreEvent[];
}

export function makeScore(): ScoreState {
  return { active: false, chain: 0, mult: 1, window: 0, drifting: false, total: 0, lapPoints: 0, bestChain: 0, events: [] };
}

function angleFactor(beta: number): number {
  if (!SCORING.angleBonus) return 1;
  const t = clamp((Math.abs(beta) - SCORING.angleLow) / (SCORING.angleHigh - SCORING.angleLow), 0, 1);
  return SCORING.angleFactorLow + (SCORING.angleFactorHigh - SCORING.angleFactorLow) * t;
}

function endChain(s: ScoreState): void {
  s.active = false;
  s.chain = 0;
  s.mult = 1;
  s.window = 0;
}

/** Advance scoring by one fixed step, after the car has been stepped. Events are appended to `s.events`. */
export function stepScore(s: ScoreState, car: CarState, dt: number): void {
  // A crash is checked first: the car model has already ended the drift on this step.
  if (s.active && car.hit > CAR.crashSpeed) {
    s.events.push({ type: 'wiped', metres: s.chain, mult: s.mult });
    endChain(s);
    s.drifting = false;
    return;
  }
  if (car.drift) {
    if (!s.drifting) {
      if (s.active) {
        s.mult = Math.min(SCORING.maxMultiplier, s.mult + 1);
        s.events.push({ type: 'link', mult: s.mult });
      } else {
        s.active = true;
        s.chain = 0;
        s.mult = 1;
      }
    }
    // With the angle bonus off this is the forward component of the motion (benchmark rule);
    // with it on, path length × a factor that grows with the angle.
    s.chain += SCORING.angleBonus
      ? Math.sqrt(car.vx * car.vx + car.vz * car.vz) * dt * angleFactor(car.beta)
      : Math.abs(car.speed) * dt;
    s.window = SCORING.linkWindow;
  } else if (s.active) {
    s.window -= dt;
    if (s.window <= 0) {
      if (s.chain >= SCORING.minChain) {
        const points = Math.round(s.chain * s.mult);
        s.total += points;
        s.lapPoints += points;
        s.bestChain = Math.max(s.bestChain, points);
        s.events.push({ type: 'banked', points, metres: s.chain, mult: s.mult });
      } else {
        s.events.push({ type: 'dropped' });
      }
      endChain(s);
    }
  }
  s.drifting = car.drift;
}
