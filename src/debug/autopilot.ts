// Autopilot: follows the centreline and never drifts. A verification tool (full-lap tests, performance
// sampling, fixed-camera screenshots), not a game feature; the release build leaves it out.

import { CAR } from '../config/car';
import { clamp, wrapAngle } from '../core/math';
import { curvatureAt, frameAt, makeFrame, type Track } from '../track/track';

const scratch = makeFrame();
import { maxYawRate, type CarInput, type CarState } from '../vehicle/car';

const AUTOPILOT = {
  /** Look-ahead distance = base + perSpeed × v, metres. */
  lookBase: 7,
  lookPerSpeed: 0.32,
  /** Steering gain on the angle to the look-ahead point. */
  steerGain: 2.6,
  /** Fraction of the grip model's yaw-rate limit the autopilot plans to use in corners. */
  cornerUse: 0.62,
  /** Deceleration assumed when planning braking, m/s² (below CAR.brakeDecel for margin). */
  planDecel: 16,
  /** How far ahead corners are scanned, metres, and the scan step. */
  scanAhead: 320,
  scanStep: 6,
};

/** Highest speed at which the grip model can follow curvature `k` using `cornerUse` of its yaw limit. */
function cornerSpeed(k: number): number {
  const kk = Math.abs(k);
  if (kk < 1e-4) return CAR.topSpeed;
  let lo = 5;
  let hi = CAR.topSpeed;
  for (let i = 0; i < 18; i++) {
    const v = (lo + hi) / 2;
    const yaw = Math.min(v / CAR.minTurnRadius, maxYawRate(v)) * AUTOPILOT.cornerUse;
    if (v * kk <= yaw) lo = v;
    else hi = v;
  }
  return lo;
}

export function autopilotInput(car: CarState, track: Track, out: CarInput): CarInput {
  const v = Math.max(0, car.speed);
  const look = AUTOPILOT.lookBase + AUTOPILOT.lookPerSpeed * v;
  const target = frameAt(track, car.loc.s + look, 0, scratch);
  const want = Math.atan2(-(target.x - car.x), -(target.z - car.z));
  const err = wrapAngle(want - car.yaw); // + = target is to the left
  out.steer = clamp(-err * AUTOPILOT.steerGain, -1, 1);

  // Speed plan: for every point ahead, the speed we may carry now and still slow down in time.
  let allowed = CAR.topSpeed;
  for (let dist = 0; dist <= AUTOPILOT.scanAhead; dist += AUTOPILOT.scanStep) {
    const vc = cornerSpeed(curvatureAt(track, car.loc.s + dist));
    allowed = Math.min(allowed, Math.sqrt(vc * vc + 2 * AUTOPILOT.planDecel * dist));
  }
  if (v > allowed + 1) {
    out.throttle = 0;
    out.brake = clamp((v - allowed) / 6, 0.2, 1);
  } else {
    out.throttle = v < allowed - 0.5 ? 1 : 0.35;
    out.brake = 0;
  }
  out.handbrake = false;
  out.nitro = false;
  return out;
}
