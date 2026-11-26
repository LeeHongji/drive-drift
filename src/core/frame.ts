// Per-frame snapshot handed to every visual system's `update`. Built once per rendered frame in game.ts
// after the simulation has stepped, so all systems see the same car pose and the same derived values.

import type * as pc from 'playcanvas';
import type { Track } from '../track/track';
import type { CarInput, CarState } from '../vehicle/car';

export interface FrameState {
  /** Seconds since the previous rendered frame, and since the game started (render clock). */
  dt: number;
  time: number;
  track: Track;
  /** Latest simulation state and the input that produced it. */
  car: CarState;
  input: CarInput;
  /** Render-interpolated car pose: position on the road and yaw (radians, see CLAUDE.md conventions). */
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Ground speed over the nitro top speed, 0…1. */
  speedRatio: number;
  /** Nitro: smoothed boost level 0…1, and the full-tank surge 0…1 (both 0 until nitro exists). */
  boost: number;
  surge: number;
  /** Tyre screech 0…1 (src/vfx/tyres.ts). */
  screech: number;
  /** How far inside the snow gallery the car is: 0 outside, 1 well inside, blended over the portals. */
  tunnel: number;
  /** The main camera entity (already posed for this frame). */
  camera: pc.Entity;
}

/** What game.ts expects from a visual system. */
export interface FrameSystem {
  update(frame: FrameState): void;
}
