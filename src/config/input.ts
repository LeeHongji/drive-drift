// Input devices: gamepad response, touch steering and the size of the touch controls.
// Mapping: docs/design/drift-gameplay.md §5. Stick and trigger values are the browser's normalised numbers
// (axes −1…1, buttons 0…1); touch distances are CSS pixels; speeds in m/s; angles in radians.

import { DEG, KMH } from '../core/math';

/** A CSS length that follows the short side of the viewport between two pixel limits. */
export interface FluidSize {
  /** Preferred size, percent of the viewport's short side (CSS vmin). */
  vmin: number;
  /** Lower and upper limit, CSS px. */
  min: number;
  max: number;
}

export const INPUT = {
  /** The gamepad is sampled at most once per this many milliseconds, however many simulation steps ask. */
  pollInterval: 4,

  pad: {
    /** Stick deflection below this reads as centred (0…1). Benchmark: 0.12. */
    deadZone: 0.12,
    /** Steering = (deflection past the dead zone, rescaled to 0…1) ^ this. 1 = linear; above 1 gives finer
     *  control near the centre while full deflection is still full lock. */
    steerExponent: 1.4,
    /** Trigger travel below this reads as released (0…1): worn triggers do not rest at exactly 0. */
    triggerDeadZone: 0.05,
    /** A face button counts as pressed above this value. */
    press: 0.5,
    /** Stick deflection or trigger travel that makes the pad the active device (glyphs switch to pad). */
    wake: 0.5,
    /** Indices in the W3C "standard" gamepad mapping. */
    steerAxis: 0,
    buttons: { nitro: 0, drift: 2, reset: 3, brake: 6, throttle: 7, select: 8, start: 9, up: 12, down: 13 },
    /** Left stick up/down deflection that counts as a menu step (0…1). */
    menuStick: 0.6,
    /** Left stick vertical axis in the standard mapping (down is positive). */
    menuAxis: 1,
    /** Wall impact (normal speed, m/s) that gives full-strength rumble; weaker hits scale down linearly. */
    rumbleFullHit: 12,
    /** Rumbles weaker than this are skipped (0…1). */
    rumbleMin: 0.12,
    /** Length of one impact rumble, milliseconds. */
    rumbleMs: 140,
    /** Strength of the light (high-frequency) motor as a fraction of the heavy one. */
    rumbleWeak: 0.6,
  },

  touch: {
    /** Touches that land left of this fraction of the screen width steer; the rest belong to the buttons. */
    steerZone: 0.5,
    /** The virtual wheel turns at most this far either way; steering = wheel angle / this. */
    wheelMaxAngle: 90 * DEG,
    /** Sideways thumb travel that turns the wheel to full lock at low speed: this fraction of the
     *  viewport's short side, kept between travelMin and travelMax (CSS px). */
    travel: 0.17,
    travelMin: 56,
    travelMax: 110,
    /** Fraction of the travel around the touch-down point that reads as centred. */
    deadZone: 0.06,
    /** Steering sensitivity falls with speed: up to speedLow the travel above gives full lock; from there
     *  the travel needed grows linearly, reaching travelScaleFast × at speedHigh and beyond. Full lock is
     *  always reachable. (The benchmark does the opposite: its sensitivity doubles from 80 to 240 km/h.) */
    speedLow: 80 * KMH,
    speedHigh: 240 * KMH,
    travelScaleFast: 1.5,
    /** A button also responds this far outside its circle, CSS px. Benchmark: 14. */
    hitPad: 14,
    /** Simultaneous touches tracked; more are ignored. */
    maxPointers: 6,
    /** Where the idle wheel rests, as fractions of the viewport width and height. */
    wheelHome: [0.17, 0.66] as [number, number],
    /** Diameters. */
    wheelSize: { vmin: 36, min: 120, max: 190 } as FluidSize,
    driftSize: { vmin: 27, min: 84, max: 136 } as FluidSize,
    nitroSize: { vmin: 20, min: 64, max: 104 } as FluidSize,
    brakeSize: { vmin: 19, min: 60, max: 98 } as FluidSize,
    pauseSize: { vmin: 9, min: 34, max: 46 } as FluidSize,
    /** Space between buttons, and between the buttons and the screen edge (added to the safe-area inset). */
    gap: { vmin: 3, min: 10, max: 18 } as FluidSize,
    edge: { vmin: 3.5, min: 12, max: 24 } as FluidSize,
  },
};
