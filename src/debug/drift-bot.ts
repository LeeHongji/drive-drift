// Keyboard-style drift driver. It only ever outputs what a keyboard can: steer −1/0/+1, pedals on/off, and
// it changes its mind at a human rate. Two uses: (1) a playability check — if this simple driver can drift
// the circuit cleanly with digital keys, so can a player; (2) the in-game demo that shows the technique.
//
// The technique it uses is the one the game teaches:
//   1. Approach on the outside, brake down to the corner's drift speed.
//   2. Just before turn-in: hold the steering key toward the corner and tap Space.
//   3. In the drift: hold the steering key to tighten the line, let go to widen it. Stay on the throttle;
//      lift only when the car runs wide.
//   4. Let go of steering before the exit; the car straightens by itself.

import { CAR } from '../config/car';
import { DRIFT } from '../config/drift';
import { clamp, wrapAngle } from '../core/math';
import { arcDelta, curvatureAt, findCorners, frameAt, makeFrame, type Corner, type Track } from '../track/track';

const scratch = makeFrame();
import { maxYawRate, type CarInput, type CarState } from '../vehicle/car';

export const BOT = {
  /** Seconds between steering decisions in a drift (a quick player re-decides about this often). */
  decision: 0.09,
  /** Tapping rate for steering corrections in grip, Hz. */
  tapRate: 9,
  /** Corners wider than this radius or turning less than this angle are taken in grip, metres / radians. */
  driftMaxRadius: 210,
  driftMinAngle: 0.6,
  /** Drift entry speed: the speed whose full-lock drift radius is this fraction of the corner radius. */
  entryRadiusFraction: 0.78,
  /** In the drift the car brakes when its full-lock radius exceeds this fraction of the radius ahead. */
  driftRadiusFraction: 0.8,
  /** The entry speed must be reached this many metres before the corner. */
  entryMargin: 30,
  /** Turn-in starts this many seconds before the corner. */
  entryLead: 0.32,
  /** Space is held this long at turn-in, seconds. */
  handbrakeHold: 0.14,
  /** Lateral position before turn-in and through the corner, metres from the centreline (+ = outside). */
  approachOffset: 4.5,
  apexOffset: -3.5,
  /** Unwinding a drift takes about this long, seconds; steering stops once the car's travel direction
   *  is within exitAim radians of the road direction that far ahead. */
  exitTime: 0.7,
  exitAim: 0.04,
  /** Feedback on travel-direction error (1/s) and lateral error (rad/s per metre) in a drift. */
  headingGain: 2.4,
  lateralGain: 0.22,
  /** Feed-forward looks this many seconds ahead. */
  lookTime: 0.3,
  /** Braking assumed when planning corner entry speed, m/s². */
  planDecel: 15,
  /** Grip steering: look-ahead base (m) and per speed (s), and gain. */
  lookBase: 7,
  lookPerSpeed: 0.3,
  steerGain: 2.8,
  /** Grip corners use this fraction of the yaw-rate limit. */
  gripUse: 0.6,
};

/** Radius of the drift path at full steering lock, metres. */
export function fullLockDriftRadius(v: number): number {
  return Math.max(DRIFT.radius, v / (DRIFT.path * maxYawRate(v)));
}

/** Highest speed whose full-lock drift radius is still ≤ `radius`. */
export function driftSpeedFor(radius: number): number {
  let lo = DRIFT.entrySpeed;
  let hi = CAR.topSpeed;
  for (let i = 0; i < 20; i++) {
    const v = (lo + hi) / 2;
    if (fullLockDriftRadius(v) <= radius) lo = v;
    else hi = v;
  }
  return lo;
}

function gripSpeedFor(curv: number): number {
  const k = Math.abs(curv);
  if (k < 1e-4) return CAR.topSpeed;
  let lo = 5;
  let hi = CAR.topSpeed;
  for (let i = 0; i < 18; i++) {
    const v = (lo + hi) / 2;
    if (v * k <= Math.min(v / CAR.minTurnRadius, maxYawRate(v)) * BOT.gripUse) lo = v;
    else hi = v;
  }
  return lo;
}

export class DriftBot {
  private readonly corners: Corner[];
  /** Per-sample speed limit from corners (drift speed inside drift corners, grip speed elsewhere). */
  private readonly limit: Float64Array;
  private clock = 0;
  private nextDecision = 0;
  private holdSteer = 0;
  private spaceUntil = -1;
  /** Corner being drifted, or null. */
  private active: Corner | null = null;
  private exiting = false;

  constructor(private readonly track: Track) {
    this.corners = findCorners(track).filter((c) => c.radius <= BOT.driftMaxRadius && c.angle >= BOT.driftMinAngle);
    this.limit = new Float64Array(track.n);
    for (let i = 0; i < track.n; i++) this.limit[i] = gripSpeedFor(track.curv[i]);
    for (const c of this.corners) {
      const v = driftSpeedFor(c.radius * BOT.entryRadiusFraction);
      // The limit starts a little before the corner: turn-in happens ahead of it.
      const i0 = Math.round((c.s0 - BOT.entryMargin) / track.spacing);
      const i1 = Math.round(c.s1 / track.spacing);
      for (let i = i0; i <= i1; i++) this.limit[((i % track.n) + track.n) % track.n] = v;
    }
  }

  /** The drift corner the car is in or approaching, and the distance to its start (≤ 0 once inside). */
  private nextCorner(s: number): { corner: Corner; dist: number } | null {
    let best: { corner: Corner; dist: number } | null = null;
    for (const corner of this.corners) {
      const toEnd = arcDelta(this.track, corner.s1, s);
      if (toEnd < 0) continue; // already past it (or it is more than half a lap away)
      const dist = arcDelta(this.track, corner.s0, s);
      if (!best || dist < best.dist) best = { corner, dist };
    }
    return best;
  }

  update(car: CarState, out: CarInput, dt: number): CarInput {
    const track = this.track;
    this.clock += dt;
    out.nitro = false; // the bot shows the drift technique only
    const v = Math.max(0, Math.hypot(car.vx, car.vz));
    const s = car.loc.s;
    const next = this.nextCorner(s);

    // ---- speed plan: slow down in time for whatever is ahead ----
    let allowed = CAR.topSpeed;
    for (let dist = 0; dist <= 340; dist += 6) {
      const i = Math.floor(((s + dist) / track.spacing) % track.n);
      allowed = Math.min(allowed, Math.sqrt(this.limit[i] ** 2 + 2 * BOT.planDecel * dist));
    }

    // ---- drift bookkeeping ----
    if (!car.drift) {
      this.active = null;
      this.exiting = false;
    }
    const lead = BOT.entryLead * v;
    if (!car.drift && next && next.dist < lead && next.dist > -next.corner.angle * next.corner.radius * 0.6 && v > DRIFT.entrySpeed + 2) {
      // Turn-in: steering key toward the corner + a tap of Space.
      this.active = next.corner;
      this.holdSteer = -next.corner.dir; // driver's view: + = right, corners use + = left
      this.spaceUntil = this.clock + BOT.handbrakeHold;
      this.nextDecision = this.clock + BOT.handbrakeHold + 0.1;
    }

    if (car.drift && this.active) {
      const c = this.active;
      const remaining = arcDelta(track, c.s1, s);
      if (this.clock >= this.nextDecision) {
        this.nextDecision = this.clock + BOT.decision;
        const aheadCurv = curvatureAt(track, s + BOT.lookTime * v);
        const hereYaw = frameAt(track, s, 0, scratch).yaw;
        const headingError = wrapAngle(Math.atan2(-car.vx, -car.vz) - hereYaw);
        const frac = clamp(arcDelta(track, s, c.s0) / Math.max(1, arcDelta(track, c.s1, c.s0)), 0, 1);
        // Outside on entry, inside from mid-corner on (a late apex leaves room to run wide on the exit).
        const lane = c.dir * -(BOT.approachOffset + (BOT.apexOffset - BOT.approachOffset) * Math.min(1, frac / 0.55));
        const want = v * aheadCurv - BOT.headingGain * headingError - BOT.lateralGain * (car.loc.d - lane);
        let bend = clamp((car.way * want) / (DRIFT.path * maxYawRate(v)), 0, 1);
        // Let go once the car is already travelling the way the road points where the drift will have
        // ended: from there it runs straight while the angle unwinds.
        const exitYaw = frameAt(track, s + BOT.exitTime * v, 0, scratch).yaw;
        const aimed = car.way * wrapAngle(exitYaw - Math.atan2(-car.vx, -car.vz)) <= BOT.exitAim;
        const leaving = remaining < BOT.exitTime * v && aimed;
        if (leaving) this.exiting = true;
        if (!this.exiting) bend = Math.max(bend, 0.2); // keep the drift alive through the corner
        // Hold the key to tighten, let go to widen.
        // (At full demand keep holding: letting go even briefly unwinds the line faster than it builds.)
        this.holdSteer = !this.exiting && (car.bend < bend || bend > 0.97) ? -car.way : 0;
      }
      out.steer = this.holdSteer;
      // Speed in the drift: the tightest radius coming up in the next second must stay within reach of
      // full lock. Too fast → brake (it works in a drift); otherwise stay on the throttle.
      let tight = Infinity;
      for (let t = 0; t <= 1.0; t += 0.25) tight = Math.min(tight, 1 / Math.max(1e-4, Math.abs(curvatureAt(track, s + t * v))));
      const vMax = driftSpeedFor(tight * BOT.driftRadiusFraction);
      out.brake = v > vMax + 1.5 ? 1 : 0;
      out.throttle = out.brake ? 0 : 1;
      out.handbrake = this.clock < this.spaceUntil;
      return out;
    }

    if (this.clock < this.spaceUntil && this.active) {
      // Turn-in in progress (the drift starts on the next step).
      out.steer = this.holdSteer;
      out.throttle = 1;
      out.brake = 0;
      out.handbrake = true;
      return out;
    }

    // ---- grip driving: follow a lane, tapping the steering keys ----
    let lane = 0;
    if (next && next.dist < 160 && next.dist > 0) lane = -next.corner.dir * BOT.approachOffset * clamp((160 - next.dist) / 80, 0, 1);
    const target = frameAt(track, s + BOT.lookBase + BOT.lookPerSpeed * v, lane, scratch);
    const err = wrapAngle(Math.atan2(-(target.x - car.x), -(target.z - car.z)) - car.yaw);
    const demand = clamp(-err * BOT.steerGain, -1, 1);
    // Pulse-width "tapping": the key is down for a share of each tap period equal to the demand.
    const phase = (this.clock * BOT.tapRate) % 1;
    out.steer = Math.abs(demand) > phase ? Math.sign(demand) : 0;
    if (v > allowed + 1) {
      out.throttle = 0;
      out.brake = 1;
    } else {
      out.throttle = v < allowed - 0.5 || phase < 0.4 ? 1 : 0;
      out.brake = 0;
    }
    out.handbrake = false;
    return out;
  }
}
