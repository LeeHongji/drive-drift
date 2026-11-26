// Pure input maths shared by the gamepad, the touch controls and the input manager. No DOM and no engine
// imports: everything here runs headless (tests/input.test.ts).

import { INPUT } from '../config/input';
import { clamp } from '../core/math';
import type { CarInput } from '../vehicle/car';

/** Stick axis (−1…1) → steering (−1…1): dead zone, rescale so the response starts at 0, then the curve. */
export function stickSteer(axis: number, deadZone = INPUT.pad.deadZone, exponent = INPUT.pad.steerExponent): number {
  const a = Math.abs(axis);
  if (!(a > deadZone)) return 0; // also catches NaN
  const t = Math.min(1, (a - deadZone) / (1 - deadZone));
  return axis < 0 ? -(t ** exponent) : t ** exponent;
}

/** Analog trigger (0…1) → pedal (0…1) with a small dead zone at rest. */
export function triggerPedal(value: number, deadZone = INPUT.pad.triggerDeadZone): number {
  if (!(value > deadZone)) return 0;
  return Math.min(1, (value - deadZone) / (1 - deadZone));
}

/** How much more thumb travel full lock needs at `speed` (m/s) than at low speed: 1 … travelScaleFast. */
export function touchTravelScale(speed: number): number {
  const { speedLow, speedHigh, travelScaleFast } = INPUT.touch;
  const t = clamp((Math.abs(speed) - speedLow) / (speedHigh - speedLow), 0, 1);
  return 1 + (travelScaleFast - 1) * t;
}

/**
 * Angle of the virtual wheel (radians, + = clockwise = steer right) for a thumb that went down at
 * `anchorX` and is now at `x`. `travel` is the sideways distance (px) that gives full lock.
 * Steering is this angle divided by INPUT.touch.wheelMaxAngle.
 */
export function wheelAngle(anchorX: number, x: number, travel: number, deadZone = INPUT.touch.deadZone): number {
  const dx = x - anchorX;
  const t = Math.abs(dx) / travel;
  if (!(t > deadZone)) return 0;
  const turn = Math.min(1, (t - deadZone) / (1 - deadZone)) * INPUT.touch.wheelMaxAngle;
  return dx < 0 ? -turn : turn;
}

/**
 * Where the wheel's centre is after the thumb moved to `x`: unchanged while the thumb is within `travel`
 * of it, otherwise pulled along so it stays exactly `travel` behind. Without this a thumb that overshoots
 * full lock would have to come all the way back before the wheel starts to unwind.
 */
export function followAnchor(anchorX: number, x: number, travel: number): number {
  return clamp(anchorX, x - travel, x + travel);
}

/** A round button on screen: centre and radius in CSS px. */
export interface HitCircle {
  x: number;
  y: number;
  r: number;
}

/** Index of the button under the point, or −1. Buttons respond `pad` px outside their circle; where two
 *  padded circles overlap, the one whose edge is nearer wins. */
export function hitButton(x: number, y: number, buttons: readonly HitCircle[], pad = INPUT.touch.hitPad): number {
  let best = -1;
  let bestGap = pad;
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    const gap = Math.hypot(x - b.x, y - b.y) - b.r;
    if (gap <= bestGap) {
      bestGap = gap;
      best = i;
    }
  }
  return best;
}

/** Combine the devices into `out`: steering adds up (clamped), pedals take the larger, buttons are OR-ed. */
export function mergeInputs(out: CarInput, a: Readonly<CarInput>, b: Readonly<CarInput>, c: Readonly<CarInput>): CarInput {
  out.steer = clamp(a.steer + b.steer + c.steer, -1, 1);
  out.throttle = Math.max(a.throttle, b.throttle, c.throttle);
  out.brake = Math.max(a.brake, b.brake, c.brake);
  out.handbrake = a.handbrake || b.handbrake || c.handbrake;
  out.nitro = a.nitro || b.nitro || c.nitro;
  return out;
}

/** Zero an input in place. */
export function clearInput(out: CarInput): CarInput {
  out.steer = 0;
  out.throttle = 0;
  out.brake = 0;
  out.handbrake = false;
  out.nitro = false;
  return out;
}
