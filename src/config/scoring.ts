// Drift scoring. Baseline rules match the benchmark game; S1–S4 are our switches (drift-gameplay.md §3.2).

import { DEG } from '../core/math';

export const SCORING = {
  /** Seconds after a drift ends in which a new drift links into the same chain. */
  linkWindow: 1.5,
  /** Highest chain multiplier. */
  maxMultiplier: 5,
  /** Chains shorter than this are dropped without banking, metres. */
  minChain: 5,
  /** S2: reward angle. chain += distance × factor, factor rising from angleFactorLow at angleLow to
   *  angleFactorHigh at angleHigh. Off: chain counts the forward component only (benchmark behaviour). */
  angleBonus: false,
  angleLow: 15 * DEG,
  angleHigh: 45 * DEG,
  angleFactorLow: 0.6,
  angleFactorHigh: 1.2,
  /** S4: keep best lap and best chain in localStorage. Bump the key's version when the circuit changes. */
  persistBests: true,
  storageKey: 'drive.bests.v2',
};
