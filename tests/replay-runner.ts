// Runs an input replay (tests/replays/*.json) through a headless Session and measures the handling.
// A replay is a start state, a timeline of held inputs, and expected ranges for the measured values.

import { CAR } from '../src/config/car';
import { NITRO } from '../src/config/nitro';
import { SIM_DT } from '../src/config/sim';
import { DEG, KMH, wrapAngle } from '../src/core/math';
import { resetPickups } from '../src/gameplay/pickups';
import { Session } from '../src/gameplay/session';
import type { CarInput } from '../src/vehicle/car';
import { mainTrack, ovalTrack, padTrack } from './helpers';

export interface Replay {
  name: string;
  /** Acceptance scenario id from docs/design/drift-gameplay.md §6. */
  scenario: string;
  /** `pad` = open skidpad, `oval` = normal-width test oval, `main` = the real circuit. */
  track: 'pad' | 'oval' | 'main';
  /** Start state: arc length, lateral offset (+ left), speed, heading offset from the road (+ left), and
   *  the nitro tank level 0…1 (default: the normal starting level). */
  start: { s: number; d?: number; kmh?: number; headingDeg?: number; nitro?: number };
  /** Inputs held until time `until` (seconds), in order. After the last entry the inputs are neutral. */
  timeline: (Partial<CarInput> & { until: number })[];
  /** Total simulated time, seconds. */
  duration: number;
  /** Values sampled at a given time: `[metric, time, lo, hi]`. */
  probes?: [string, number, number, number][];
  /** Whole-run values: metric → [lo, hi]. */
  expect: Record<string, [number, number]>;
}

export interface ReplayResult {
  metrics: Record<string, number>;
  probes: number[];
}

type Sample = Record<string, number>;

function sample(s: Session): Sample {
  const c = s.car;
  return {
    kmh: c.speed / KMH,
    betaDeg: Math.abs(c.beta) / DEG,
    drift: c.drift ? 1 : 0,
    way: c.way,
    d: c.loc.d,
    mult: s.score.mult,
    chain: s.score.chain,
    total: s.score.total,
    laps: s.laps.count,
    yawRateDeg: c.yawRate / DEG,
    nitro: c.nitro,
    boost: c.boost ? 1 : 0,
    surge: c.surge,
  };
}

export function runReplay(r: Replay): ReplayResult {
  const session = new Session(r.track === 'pad' ? padTrack() : r.track === 'oval' ? ovalTrack() : mainTrack());
  session.place(r.start.s, r.start.d ?? 0, (r.start.kmh ?? 0) * KMH);
  if (r.start.headingDeg) {
    // Rotate nose and velocity together.
    const a = r.start.headingDeg * DEG;
    const c = session.car;
    c.yaw = wrapAngle(c.yaw + a);
    const v = Math.hypot(c.vx, c.vz);
    c.vx = -Math.sin(c.yaw) * v;
    c.vz = -Math.cos(c.yaw) * v;
  }
  if (r.start.nitro !== undefined) {
    session.car.nitro = r.start.nitro;
    resetPickups(session.pickups, session.car.nitro); // a tank that starts full is not a "became full" event
  }

  const m: Record<string, number> = {
    t100: NaN, t200: NaN, maxBetaDeg: 0, maxKmh: 0, minDriftRadius: Infinity,
    driftTime: 0, driftStarts: 0, firstDriftEnd: NaN, wayFlips: 0, maxHit: 0, crashes: 0,
    banked: 0, wiped: 0, links: 0, dropped: 0, maxMult: 1, maxAbsD: 0,
    // Nitro: seconds spent boosting, time the tank first counted as full, lowest tank level, shards taken.
    boostTime: 0, nitroFullAt: NaN, minNitro: 1, shards: 0, tankFull: 0,
  };
  const probes = (r.probes ?? []).map(() => NaN);
  const input: CarInput = { steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false };
  const steps = Math.round(r.duration / SIM_DT);
  let wasDrift = false;
  let prevWay = session.car.way;
  let prevHead = Math.atan2(-session.car.vx, -session.car.vz);

  for (let k = 0; k < steps; k++) {
    const t = k * SIM_DT;
    const seg = r.timeline.find((e) => t < e.until);
    input.steer = seg?.steer ?? 0;
    input.throttle = seg?.throttle ?? 0;
    input.brake = seg?.brake ?? 0;
    input.handbrake = seg?.handbrake ?? false;
    input.nitro = seg?.nitro ?? false;
    session.step(input);

    const c = session.car;
    const now = session.time;
    const kmh = c.speed / KMH;
    if (Number.isNaN(m.t100) && kmh >= 100) m.t100 = now;
    if (Number.isNaN(m.t200) && kmh >= 200) m.t200 = now;
    m.maxKmh = Math.max(m.maxKmh, kmh);
    m.maxAbsD = Math.max(m.maxAbsD, Math.abs(c.loc.d));
    m.maxHit = Math.max(m.maxHit, c.hit);
    if (c.hit > CAR.crashSpeed) m.crashes++;
    m.maxMult = Math.max(m.maxMult, session.score.mult);
    if (c.boost) m.boostTime += SIM_DT;
    m.minNitro = Math.min(m.minNitro, c.nitro);
    if (Number.isNaN(m.nitroFullAt) && c.nitro > NITRO.full) m.nitroFullAt = now;

    const head = Math.atan2(-c.vx, -c.vz);
    if (c.drift) {
      m.driftTime += SIM_DT;
      m.maxBetaDeg = Math.max(m.maxBetaDeg, Math.abs(c.beta) / DEG);
      const turn = Math.abs(wrapAngle(head - prevHead)) / SIM_DT;
      if (wasDrift && turn > 1e-4) m.minDriftRadius = Math.min(m.minDriftRadius, Math.hypot(c.vx, c.vz) / turn);
      if (!wasDrift) m.driftStarts++;
      else if (c.way !== prevWay) m.wayFlips++;
    } else if (wasDrift && Number.isNaN(m.firstDriftEnd)) {
      m.firstDriftEnd = now;
    }
    wasDrift = c.drift;
    prevWay = c.way;
    prevHead = head;

    (r.probes ?? []).forEach(([metric, at], i) => {
      if (Number.isNaN(probes[i]) && now >= at) probes[i] = sample(session)[metric];
    });
  }

  for (const e of session.score.events) {
    if (e.type === 'banked') m.banked++;
    if (e.type === 'wiped') m.wiped++;
    if (e.type === 'link') m.links++;
    if (e.type === 'dropped') m.dropped++;
  }
  for (const e of session.pickups.events) {
    if (e.type === 'collected') m.shards++;
    if (e.type === 'full') m.tankFull++;
  }
  Object.assign(m, Object.fromEntries(Object.entries(sample(session)).map(([k, v]) => [`final_${k}`, v])));
  return { metrics: m, probes };
}
