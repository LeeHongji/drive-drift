// Nitro shards: where they sit on the track, collecting them, respawning. Pure logic.
//
// Placement is a rule over the centreline, so it follows any change to the circuit (track-and-world.md §5):
//   1. drift corners: just past the exit, on the outside — a drift carried wide all the way out sweeps it up;
//   2. sweepers: mid-corner on the outside, off the fast inside line;
//   3. straights, longest first: mid-way, on the inside of the next corner, which costs the ideal approach;
//   4. if that is still short of SHARDS.count (test ovals), the widest gaps are halved, alternating sides.
// Every shard is offset from the centreline by more than the lateral reach: driving down the middle of the
// road collects nothing.

import { NITRO, SHARDS } from '../config/nitro';
import { clamp, mod } from '../core/math';
import { arcDelta, findCorners, type Track } from '../track/track';
import type { CarState } from '../vehicle/car';

export interface Shard {
  /** Arc length on the centreline, metres. */
  s: number;
  /** Lateral offset, metres, + = left. */
  d: number;
  /** Seconds until it is back; ≤ 0 = on the track and collectable. */
  timer: number;
}

export type PickupEvent =
  /** The car took shard `index`; `nitro` is the tank level afterwards. */
  | { type: 'collected'; index: number; nitro: number }
  /** The tank just became full (above NITRO.full), by a shard or by refilling. */
  | { type: 'full' };

export interface PickupState {
  /** In track order. */
  shards: Shard[];
  /** Whether the tank was full after the previous step (edge detector for the `full` event). */
  wasFull: boolean;
  events: PickupEvent[];
}

/** Shard positions for a track, in track order. Deterministic: the same track always gives the same list. */
export function placeShards(track: Track): { s: number; d: number }[] {
  const P = SHARDS;
  const len = track.length;
  const maxD = track.config.halfWidth - P.edgeMargin;
  const spots: { s: number; d: number }[] = [];
  const add = (s: number, d: number): void => {
    if (spots.length >= P.count) return;
    const at = mod(s, len);
    if (spots.some((o) => Math.abs(arcDelta(track, at, o.s)) < P.minSpacing)) return;
    spots.push({ s: at, d: clamp(d, -maxD, maxD) });
  };

  // Corner direction is + for a left turn and d is + to the left, so −dir points to the outside.
  const corners = findCorners(track);
  for (const c of corners) if (c.radius <= P.driftRadius) add(c.s1 + P.exitAhead, -c.dir * P.exitOffset);
  for (const c of corners) if (c.radius > P.driftRadius) add((c.s0 + c.s1) / 2, -c.dir * P.sweeperOffset);

  const straights = corners
    .map((c, k) => {
      const next = corners[(k + 1) % corners.length];
      return { s0: c.s1, length: mod(next.s0 - c.s1, len), dir: next.dir };
    })
    .sort((a, b) => b.length - a.length);
  for (const st of straights) add(st.s0 + st.length * P.straightAt, st.dir * P.straightOffset);

  let side = 1;
  while (spots.length < P.count) {
    if (spots.length === 0) {
      spots.push({ s: mod(track.config.finishS + P.fillStart, len), d: side * P.straightOffset });
    } else {
      spots.sort((a, b) => a.s - b.s);
      let from = 0;
      let widest = 0;
      spots.forEach((o, k) => {
        const gap = mod(spots[(k + 1) % spots.length].s - o.s, len) || len;
        if (gap > widest) {
          widest = gap;
          from = o.s;
        }
      });
      spots.push({ s: mod(from + widest / 2, len), d: side * P.straightOffset });
    }
    side = -side;
  }
  return spots.sort((a, b) => a.s - b.s);
}

export function makePickups(track: Track): PickupState {
  return { shards: placeShards(track).map((p) => ({ ...p, timer: 0 })), wasFull: false, events: [] };
}

/** Every shard back on the track, events cleared (restart, teleport). `nitro` is the tank level to start from. */
export function resetPickups(p: PickupState, nitro: number): void {
  for (const sh of p.shards) sh.timer = 0;
  p.wasFull = nitro > NITRO.full;
  p.events.length = 0;
}

/**
 * Advance the shards by one fixed step, after the car has been stepped: respawn timers, collection (adds to
 * `car.nitro`), and the `full` event. Events are appended to `p.events`.
 */
export function stepPickups(p: PickupState, car: CarState, track: Track, dt: number): void {
  for (let i = 0; i < p.shards.length; i++) {
    const sh = p.shards[i];
    if (sh.timer > 0) {
      sh.timer -= dt;
      continue;
    }
    // The box is in track coordinates (along × across), not a 3D distance.
    const ahead = arcDelta(track, sh.s, car.loc.s);
    if (ahead < -SHARDS.reachBehind || ahead > SHARDS.reachAhead) continue;
    if (Math.abs(car.loc.d - sh.d) > SHARDS.reachLateral) continue;
    sh.timer = SHARDS.respawn;
    car.nitro = Math.min(1, car.nitro + SHARDS.gain);
    p.events.push({ type: 'collected', index: i, nitro: car.nitro });
  }
  const full = car.nitro > NITRO.full;
  if (full && !p.wasFull) p.events.push({ type: 'full' });
  p.wasFull = full;
}
