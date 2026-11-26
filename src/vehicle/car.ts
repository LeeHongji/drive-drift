// Arcade car model. Two kinematic modes share one state: grip (yaw-rate table, velocity follows the nose) and
// drift (a spring on the drift angle β, the path steered separately). No tyre forces, no mass.
// Pure logic: no engine imports. Advances only in fixed steps of SIM_DT.
//
// Conventions: yaw ψ about +Y, forward = (−sin ψ, −cos ψ), right = (cos ψ, −sin ψ). A left turn increases ψ.
// Inputs use the driver's view: steer +1 = right. Internally the model works in "left-positive" terms so that
// steering, yaw rate, drift side and β all share the sign of ψ.

import { CAR } from '../config/car';
import { DRIFT } from '../config/drift';
import { NITRO } from '../config/nitro';
import { approach, clamp, DEG, KMH, sign, wrapAngle } from '../core/math';
import { makeLocation, project, type Track, type TrackLocation } from '../track/track';

export interface CarInput {
  /** −1 (full left) … +1 (full right). */
  steer: number;
  /** 0 … 1. */
  throttle: number;
  /** 0 … 1. Brakes while rolling forward, reverses once stopped. */
  brake: number;
  /** Drift button. */
  handbrake: boolean;
  /** Nitro button (held). */
  nitro: boolean;
}

export const NEUTRAL_INPUT: Readonly<CarInput> = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false };

export interface CarState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  yawRate: number;
  /** Slew-limited steering, driver's view (+ = right). */
  steer: number;
  /** Signed forward speed, m/s. */
  speed: number;
  /** Lateral speed toward the car's right, m/s. */
  lat: number;
  /** Body slip angle atan2(lat, |speed|), radians. */
  slip: number;
  /** Longitudinal acceleration over the last step, m/s² (drives the cosmetic dive/squat). */
  accel: number;

  drift: boolean;
  /** Drift side in yaw terms: +1 = the car is turning left. */
  way: number;
  /** Filtered "how hard the driver steers into the drift", −1 … 1. */
  bend: number;
  /** Drift angle: nose direction minus travel direction, radians (same sign as `way` in a normal drift). */
  beta: number;
  betaV: number;
  /** Accumulated slack time; the drift ends when it reaches DRIFT.settle. */
  lull: number;
  /** Seconds the last drift-button press stays armed for (see DRIFT.entryBuffer). */
  armed: number;

  /** Nitro tank, 0 … 1. */
  nitro: number;
  /** True while the nitro is firing. */
  boost: boolean;
  /** Full-tank surge: 1 when boost is fired from a full tank, falling to 0 over NITRO.surgeTime. */
  surge: number;

  /** Normal impact speed against a wall during the last step, m/s (0 = no contact with closing speed). */
  hit: number;
  /** 1 while touching a wall, decaying afterwards. */
  scrape: number;
  /** Side of the last wall contact: +1 left, −1 right. */
  wallSide: number;
  /** True while a wheel is on the kerb. */
  onKerb: boolean;

  gear: number;
  /** 0 … 1. */
  rpm: number;

  loc: TrackLocation;
}

export function makeCar(): CarState {
  return {
    x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, steer: 0, speed: 0, lat: 0, slip: 0, accel: 0,
    drift: false, way: 1, bend: 0, beta: 0, betaV: 0, lull: 0, armed: 0,
    nitro: NITRO.start, boost: false, surge: 0,
    hit: 0, scrape: 0, wallSide: 0, onKerb: false,
    gear: 1, rpm: CAR.idleRpm,
    loc: makeLocation(),
  };
}

/** Put the car on the track at arc length `s`, lateral offset `d`, facing along the road at `speed`. */
export function placeCar(car: CarState, track: Track, s: number, d = 0, speed = 0): void {
  const i = Math.floor(s / track.spacing) % track.n;
  const f = s / track.spacing - Math.floor(s / track.spacing);
  const j = (i + 1) % track.n;
  const tx = track.tx[i] + (track.tx[j] - track.tx[i]) * f;
  const tz = track.tz[i] + (track.tz[j] - track.tz[i]) * f;
  const tl = Math.sqrt(tx * tx + tz * tz);
  const cx = track.x[i] + (track.x[j] - track.x[i]) * f;
  const cz = track.z[i] + (track.z[j] - track.z[i]) * f;
  Object.assign(car, makeCar());
  car.x = cx + (tz / tl) * d;
  car.z = cz - (tx / tl) * d;
  car.yaw = Math.atan2(-tx, -tz);
  car.vx = (tx / tl) * speed;
  car.vz = (tz / tl) * speed;
  car.speed = speed;
  project(track, car.x, car.z, car.loc, true);
  car.y = car.loc.y;
  updateGearbox(car, 1);
}

/** Max yaw rate (rad/s) the grip model allows at speed v (m/s), before the low-speed radius cap. */
export function maxYawRate(v: number): number {
  const kmh = v / KMH;
  const table = CAR.yawRateTable;
  let k = 0;
  while (k < table.length - 2 && kmh > table[k + 1][0]) k++;
  const [k0, y0] = table[k];
  const [k1, y1] = table[k + 1];
  const t = clamp((kmh - k0) / (k1 - k0), 0, 1);
  return (y0 + (y1 - y0) * t * t * (3 - 2 * t)) * DEG;
}

/**
 * Lateral limit of the car centre: wall face minus the body's reach toward the wall minus a small margin.
 * `angle` is the nose direction relative to the road direction; a car sideways to the wall reaches further
 * (oriented box), so its centre is held further in and the nose or tail never sinks into the wall.
 */
export function wallLimit(track: Track, angle = 0): number {
  const box = CAR.halfWidth * Math.abs(Math.cos(angle)) + CAR.halfLength * Math.abs(Math.sin(angle));
  const reach = CAR.halfWidth + (box - CAR.halfWidth) * CAR.wallAngleReach;
  return track.wallOffset - reach - CAR.wallMargin;
}

function updateGearbox(car: CarState, dt: number): void {
  const pace = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
  const tops = CAR.gearTop;
  let g = Math.max(1, car.gear);
  while (g < tops.length && pace >= tops[g - 1]) g++;
  while (g > 1 && pace < tops[g - 2] * CAR.downshiftRatio) g--;
  const target = clamp(pace / tops[g - 1], CAR.idleRpm, 1);
  car.rpm += (target - car.rpm) * Math.min(1, CAR.rpmSmooth * dt);
  car.gear = car.speed < -0.5 ? 0 : g; // 0 shows as "R"
}

function driftStep(car: CarState, input: CarInput, dt: number): void {
  const steerL = -car.steer;
  const spd0 = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
  let velHead = Math.atan2(-car.vx, -car.vz);
  const u = steerL * car.way; // + = steering into the drift, − = counter-steer
  const power = input.throttle > 0;
  const engaged = power || Math.abs(u) > DRIFT.deadband;
  const omega = engaged ? DRIFT.snap : DRIFT.grip;

  const rate = u * car.bend < 0 || Math.abs(u) < Math.abs(car.bend) ? DRIFT.unwind : DRIFT.ease;
  car.bend = approach(car.bend, u, rate * dt);

  // Target angle as a fraction of DRIFT.angle.
  let frac: number;
  if (Math.abs(u) <= DRIFT.deadband) frac = Math.max(0, car.bend);
  else if (car.bend >= 0) frac = DRIFT.hold + (1 - DRIFT.hold) * car.bend;
  else frac = DRIFT.hold + (1 + DRIFT.hold) * car.bend; // counter-steer: hold → −1, zero at bend = −1/3
  const targetBeta = engaged ? car.way * frac * (power ? 1 : DRIFT.lift) * DRIFT.angle : 0;

  let beta = wrapAngle(car.yaw - velHead);
  const wasIn = beta * car.way;
  car.betaV += (omega * omega * (targetBeta - beta) - 2 * DRIFT.damping * omega * car.betaV) * dt;
  beta += car.betaV * dt;

  // The path curves toward the drift side, independently of the angle.
  const turn = Math.min(Math.max(0, car.bend) * DRIFT.path * maxYawRate(spd0), spd0 / DRIFT.radius);
  velHead += car.way * turn * dt;
  const spd = Math.max(0, spd0 - DRIFT.drag * Math.abs(Math.sin(beta)) * dt);
  car.vx = -Math.sin(velHead) * spd;
  car.vz = -Math.cos(velHead) * spd;

  const newYaw = velHead + beta;
  car.yawRate = wrapAngle(newYaw - car.yaw) / dt;
  car.yaw = newYaw;
  car.beta = beta;

  // Flick: a hard counter-steer as the angle crosses zero carries the drift to the other side.
  if (wasIn > 0 && beta * car.way <= 0 && u < -DRIFT.flickSteer) {
    car.way = -car.way;
    car.bend = 0;
  }

  const slack =
    beta * car.way <= 0 || (Math.abs(beta) < DRIFT.exitAngle && Math.abs(targetBeta) < DRIFT.exitAngle);
  car.lull = slack && steerL * car.way < DRIFT.holdSteer ? car.lull + dt : 0;
  if (car.lull >= DRIFT.settle || spd < DRIFT.exitSpeed) car.drift = false;
}

/** Advance the car by one fixed step. */
export function stepCar(car: CarState, input: CarInput, track: Track, dt: number): void {
  let sin = Math.sin(car.yaw);
  let cos = Math.cos(car.yaw);
  let fwd = -car.vx * sin - car.vz * cos;
  let lat = car.vx * cos - car.vz * sin;
  const fwd0 = fwd;

  // ---- steering slew ----
  const steerIn = clamp(input.steer, -1, 1);
  const steerRate = steerIn === 0 || steerIn * car.steer < 0 ? CAR.steerRateOut : CAR.steerRateIn;
  car.steer = approach(car.steer, steerIn, steerRate * dt);

  // ---- nitro: starts only above the threshold, then runs until the button is released or the tank is empty ----
  const wasBoost = car.boost;
  car.boost = input.nitro && car.nitro > 0 && (wasBoost || car.nitro > NITRO.minStart);
  if (car.boost && !wasBoost && car.nitro > NITRO.full) car.surge = 1;
  car.surge = car.boost ? Math.max(0, car.surge - dt / NITRO.surgeTime) : 0;

  // ---- longitudinal ----
  if (car.boost) {
    // Boost thrust replaces the throttle. Above the cap (the surge cap falls back) it turns into drag.
    const cap = NITRO.topSpeed + NITRO.surgeSpeed * car.surge;
    car.nitro = Math.max(0, car.nitro - NITRO.drain * dt);
    fwd += NITRO.accel * (1 + NITRO.surgeThrust * car.surge) * (1 - fwd / cap) * dt;
  } else if (input.throttle > 0) {
    fwd += CAR.engineAccel * input.throttle * Math.max(0, 1 - fwd / CAR.topSpeed) * dt;
  } else {
    fwd -= sign(fwd) * (CAR.rollingDrag + CAR.aeroDrag * fwd * fwd) * dt;
  }
  if (input.brake > 0) {
    const a = fwd > 0.5 ? CAR.brakeDecel : fwd > -CAR.reverseSpeed ? CAR.reverseAccel : 0;
    fwd -= a * input.brake * dt;
  }
  if (input.handbrake && fwd > 0) fwd = Math.max(0, fwd - DRIFT.bleed * dt);
  // Speed gained from nitro bleeds back to the normal top speed once the boost is off.
  if (!car.boost && fwd > CAR.topSpeed) fwd = Math.max(CAR.topSpeed, fwd - NITRO.bleed * dt);
  const kerbStart = track.config.halfWidth - CAR.trackWidth / 2;
  car.onKerb = Math.abs(car.loc.d) > kerbStart;
  if (fwd > CAR.scrubMinSpeed) {
    fwd -= (Math.abs(car.yawRate * fwd) * CAR.cornerScrub + (car.onKerb ? CAR.kerbDrag : 0)) * dt;
  }
  if (input.throttle <= 0 && input.brake <= 0 && Math.abs(fwd) < CAR.restSpeed) fwd = 0;

  // ---- yaw-rate target (grip model; in a drift the integrator overwrites yawRate) ----
  const v = Math.abs(fwd);
  const yawTarget = -car.steer * sign(fwd) * Math.min(v / CAR.minTurnRadius, maxYawRate(v));
  car.yawRate += (yawTarget - car.yawRate) * Math.min(1, CAR.yawResponse * dt);

  // ---- drift entry: drift button (held, or tapped a moment ago) + steering + speed ----
  car.armed = input.handbrake ? DRIFT.entryBuffer : Math.max(0, car.armed - dt);
  if (!car.drift && car.armed > 0 && Math.abs(car.steer) > DRIFT.entrySteer && fwd > DRIFT.entrySpeed) {
    car.drift = true;
    car.armed = 0;
    car.way = -sign(car.steer);
    car.betaV = 0;
    car.bend = 0;
    car.lull = 0;
  }

  // ---- nitro refill: slow on its own, fast while drifting, none while boosting ----
  if (!car.boost) car.nitro = Math.min(1, car.nitro + (NITRO.refill + (car.drift ? NITRO.driftRefill : 0)) * dt);

  car.vx = -sin * fwd + cos * lat;
  car.vz = -cos * fwd - sin * lat;

  if (car.drift) {
    driftStep(car, input, dt);
  } else {
    car.yaw = wrapAngle(car.yaw + car.yawRate * dt);
    sin = Math.sin(car.yaw);
    cos = Math.cos(car.yaw);
    fwd = -car.vx * sin - car.vz * cos;
    lat = car.vx * cos - car.vz * sin;
    // Grip: sideways velocity dies quickly and its energy is handed back as forward speed.
    const total = Math.hypot(fwd, lat);
    lat *= Math.exp(-CAR.gripLateralDecay * dt);
    if (fwd > CAR.gripKeepSpeed) {
      const k = total / Math.hypot(fwd, lat);
      fwd *= k;
      lat *= k;
    }
    car.vx = -sin * fwd + cos * lat;
    car.vz = -cos * fwd - sin * lat;
    car.beta = 0;
  }

  car.x += car.vx * dt;
  car.z += car.vz * dt;

  // ---- walls ----
  const loc = project(track, car.x, car.z, car.loc);
  car.scrape = Math.max(0, car.scrape - CAR.scrapeDecay * dt);
  car.hit = 0;
  const limit = wallLimit(track, car.yaw - Math.atan2(-loc.tx, -loc.tz));
  if (Math.abs(loc.d) > limit) {
    const side = sign(loc.d);
    const nx = loc.lx * side; // outward wall normal
    const nz = loc.lz * side;
    const pen = Math.abs(loc.d) - limit;
    car.x -= nx * pen;
    car.z -= nz * pen;
    const vn = car.vx * nx + car.vz * nz;
    if (vn > 0) {
      const keep = 1 - Math.min(CAR.wallLossMax, vn * CAR.wallLossPerSpeed) - CAR.wallSlideLoss * dt;
      car.vx = (car.vx - nx * vn * (1 + CAR.wallRestitution)) * keep;
      car.vz = (car.vz - nz * vn * (1 + CAR.wallRestitution)) * keep;
      // Twist the car parallel to the wall, facing the way it is still travelling.
      const along = car.vx * loc.tx + car.vz * loc.tz;
      const tangentYaw = Math.atan2(-loc.tx, -loc.tz) + (along < 0 ? Math.PI : 0);
      const pull = Math.min(CAR.wallAlignMax, vn * CAR.wallAlignPerSpeed + CAR.wallAlignPerSecond * dt);
      car.yaw = wrapAngle(car.yaw + wrapAngle(tangentYaw - car.yaw) * pull);
      car.hit = vn;
      if (vn > CAR.crashSpeed) car.drift = false;
    }
    car.wallSide = side;
    car.scrape = 1;
    project(track, car.x, car.z, car.loc);
  }

  // ---- derived state ----
  car.yaw = wrapAngle(car.yaw);
  sin = Math.sin(car.yaw);
  cos = Math.cos(car.yaw);
  car.speed = -car.vx * sin - car.vz * cos;
  car.lat = car.vx * cos - car.vz * sin;
  car.slip = Math.abs(car.speed) > 2 ? Math.atan2(car.lat, Math.abs(car.speed)) : 0;
  car.accel = (car.speed - fwd0) / dt;
  car.y = car.loc.y;
  if (!car.drift) {
    car.beta = 0;
    car.betaV = 0;
  }
  updateGearbox(car, dt);
}
