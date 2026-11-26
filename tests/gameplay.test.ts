import { describe, expect, it } from 'vitest';
import { CAR } from '../src/config/car';
import { DRIFT } from '../src/config/drift';
import { SCORING } from '../src/config/scoring';
import { MAX_STEPS_PER_FRAME, SIM_DT } from '../src/config/sim';
import { KMH } from '../src/core/math';
import { FixedStepper } from '../src/core/loop';
import { autopilotInput } from '../src/debug/autopilot';
import { BOT, DriftBot, driftSpeedFor, fullLockDriftRadius } from '../src/debug/drift-bot';
import { arcDelta, findCorners } from '../src/track/track';
import { makeLaps, stepLaps } from '../src/gameplay/laps';
import { makeScore, stepScore } from '../src/gameplay/scoring';
import { Session } from '../src/gameplay/session';
import { makeCar, maxYawRate, wallLimit, type CarInput } from '../src/vehicle/car';
import { mainTrack, ovalTrack, padTrack } from './helpers';

const input = (o: Partial<CarInput> = {}): CarInput => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false, ...o });
const run = (s: Session, seconds: number, i: CarInput): void => {
  for (let k = 0; k < Math.round(seconds / SIM_DT); k++) s.step(i);
};

describe('car model', () => {
  it('interpolates the yaw-rate table', () => {
    expect((maxYawRate(0) * 180) / Math.PI).toBeCloseTo(130, 5);
    expect((maxYawRate(70 * KMH) * 180) / Math.PI).toBeCloseTo(120, 5);
    expect((maxYawRate(500 * KMH) * 180) / Math.PI).toBeCloseTo(47, 5);
    expect(maxYawRate(100 * KMH)).toBeLessThan(maxYawRate(70 * KMH));
  });

  it('reaches top speed and no more', () => {
    const s = new Session(padTrack());
    s.place(100, 0, 80); // start near the top so the 2 km straight is long enough
    run(s, 15, input({ throttle: 1 }));
    expect(s.car.speed).toBeGreaterThan(CAR.topSpeed * 0.98);
    expect(s.car.speed).toBeLessThanOrEqual(CAR.topSpeed);
  });

  it('brakes to a stop, then reverses up to the reverse cap', () => {
    const s = new Session(padTrack());
    s.place(100, 0, 100 * KMH);
    let t = 0;
    while (s.car.speed > 0.5 && t < 10) {
      s.step(input({ brake: 1 }));
      t += SIM_DT;
    }
    expect(t).toBeGreaterThan(0.72); // 27.8 m/s at 34 m/s²
    expect(t).toBeLessThan(0.9);
    run(s, 4, input({ brake: 1 }));
    expect(s.car.speed).toBeLessThan(-CAR.reverseSpeed * 0.9);
    expect(s.car.speed).toBeGreaterThanOrEqual(-CAR.reverseSpeed - 0.2);
    expect(s.car.gear).toBe(0);
  });

  it('turns right for positive steer and holds its speed in grip mode', () => {
    const s = new Session(padTrack());
    s.place(100, 0, 80 * KMH);
    const yaw0 = s.car.yaw;
    const d0 = s.car.loc.d;
    run(s, 0.5, input({ steer: 1, throttle: 0.5 }));
    expect(s.car.yaw).toBeLessThan(yaw0); // yaw decreases in a right turn
    expect(s.car.loc.d).toBeLessThan(d0); // moved to the right of the centreline
    expect(s.car.drift).toBe(false);
    expect(Math.abs(s.car.slip)).toBeLessThan(0.2); // full lock in grip leaves a little slip, far from a drift
    expect(s.car.speed).toBeGreaterThan(70 * KMH);
  });

  it('needs speed, steering and the button together to start a drift', () => {
    const cases: [number, Partial<CarInput>, boolean][] = [
      [100, { steer: 1, handbrake: true, throttle: 1 }, true],
      [100, { steer: -1, handbrake: true, throttle: 1 }, true],
      [40, { steer: 1, handbrake: true, throttle: 1 }, false], // too slow
      [100, { steer: 0, handbrake: true, throttle: 1 }, false], // no steering
      [100, { steer: 1, handbrake: false, throttle: 1 }, false], // no button
    ];
    for (const [kmh, i, expected] of cases) {
      const s = new Session(padTrack());
      s.place(100, 0, kmh * KMH);
      run(s, 0.3, input(i));
      expect(s.car.drift, JSON.stringify([kmh, i])).toBe(expected);
    }
  });

  it('keeps a tap of the drift button armed for a moment, but not for long', () => {
    const tapThenSteer = (gap: number): boolean => {
      const s = new Session(padTrack());
      s.place(100, 0, 100 * KMH);
      run(s, 0.03, input({ throttle: 1, handbrake: true })); // tap Space while going straight
      run(s, gap, input({ throttle: 1 }));
      run(s, 0.2, input({ throttle: 1, steer: 1 })); // then steer
      return s.car.drift;
    };
    expect(tapThenSteer(0.1)).toBe(true);
    expect(tapThenSteer(DRIFT.entryBuffer + 0.2)).toBe(false);
  });

  it('drifts toward the steered side with the nose inside the turn', () => {
    const s = new Session(padTrack());
    s.place(100, 0, 110 * KMH);
    run(s, 1.2, input({ steer: -1, handbrake: true, throttle: 1 })); // steer left
    expect(s.car.drift).toBe(true);
    expect(s.car.way).toBe(1);
    expect(s.car.beta).toBeGreaterThan(0.6); // nose points left of the travel direction
    expect(s.car.loc.d).toBeGreaterThan(1); // path curves left
    expect(Math.abs(s.car.beta)).toBeLessThanOrEqual(DRIFT.angle * 1.06);
  });

  it('ends the drift when the speed falls below the exit speed', () => {
    const s = new Session(padTrack());
    s.place(100, 0, 60 * KMH);
    run(s, 0.3, input({ steer: 1, handbrake: true }));
    expect(s.car.drift).toBe(true);
    run(s, 6, input({ steer: 1, handbrake: true }));
    expect(s.car.drift).toBe(false);
  });

  it('keeps the car inside the walls and flags the kerb', () => {
    const track = ovalTrack();
    const s = new Session(track);
    s.place(100, 0, 90 * KMH);
    run(s, 3, input({ steer: -0.4, throttle: 1 }));
    expect(Math.abs(s.car.loc.d)).toBeLessThanOrEqual(wallLimit(track) + 1e-6);
    expect(s.car.onKerb).toBe(true);
    expect(s.car.scrape).toBeGreaterThan(0);
  });

  it('is deterministic: the same inputs give the same state', () => {
    const drive = (): string => {
      const s = new Session(mainTrack());
      for (let k = 0; k < 3000; k++) {
        s.step(input({ steer: Math.sin(k * 0.013), throttle: 1, handbrake: k % 700 > 500 }));
      }
      return JSON.stringify([s.car.x, s.car.z, s.car.yaw, s.score.total, s.score.chain]);
    };
    expect(drive()).toBe(drive());
  });
});

describe('fixed-step loop (F12)', () => {
  it('runs the same number of steps at 20 fps and 60 fps', () => {
    const count = (fps: number): number => {
      const st = new FixedStepper();
      let n = 0;
      for (let f = 0; f < fps * 10; f++) n += st.advance(1 / fps);
      return n;
    };
    expect(Math.abs(count(20) - 1200)).toBeLessThanOrEqual(1);
    expect(Math.abs(count(60) - 1200)).toBeLessThanOrEqual(1);
    expect(Math.abs(count(144) - 1200)).toBeLessThanOrEqual(1);
  });

  it('never runs more than the per-frame cap and drops the backlog', () => {
    const st = new FixedStepper();
    expect(st.advance(0.5)).toBe(MAX_STEPS_PER_FRAME);
    expect(st.advance(0)).toBe(0);
    expect(st.advance(1 / 60)).toBe(2);
  });
});

describe('scoring', () => {
  const drifting = (speed: number) => Object.assign(makeCar(), { drift: true, speed, vz: -speed });
  const gripping = () => makeCar();

  it('accumulates forward metres while drifting', () => {
    const s = makeScore();
    for (let k = 0; k < 120; k++) stepScore(s, drifting(30), SIM_DT);
    expect(s.chain).toBeCloseTo(30, 3);
    expect(s.mult).toBe(1);
    expect(s.window).toBe(SCORING.linkWindow);
  });

  it('links drifts inside the window (F5) up to the maximum multiplier', () => {
    const s = makeScore();
    for (let n = 0; n < 8; n++) {
      for (let k = 0; k < 60; k++) stepScore(s, drifting(30), SIM_DT);
      for (let k = 0; k < 60; k++) stepScore(s, gripping(), SIM_DT); // 0.5 s gap
    }
    expect(s.mult).toBe(SCORING.maxMultiplier);
    expect(s.events.filter((e) => e.type === 'link').length).toBe(7); // every re-entry links, the multiplier just stops at the cap
    expect(s.total).toBe(0); // nothing banked while the chain is alive
  });

  it('banks chain × multiplier once the window runs out (F6)', () => {
    const s = makeScore();
    for (let k = 0; k < 120; k++) stepScore(s, drifting(30), SIM_DT);
    for (let k = 0; k < 30; k++) stepScore(s, gripping(), SIM_DT);
    for (let k = 0; k < 120; k++) stepScore(s, drifting(30), SIM_DT);
    for (let k = 0; k < 120 * 1.5 - 1; k++) stepScore(s, gripping(), SIM_DT);
    expect(s.total).toBe(0);
    for (let k = 0; k < 3; k++) stepScore(s, gripping(), SIM_DT);
    expect(s.total).toBe(120); // 60 m × 2
    expect(s.lapPoints).toBe(120);
    expect(s.active).toBe(false);
    expect(s.events.at(-1)).toMatchObject({ type: 'banked', points: 120, mult: 2 });
  });

  it('drops chains shorter than the minimum', () => {
    const s = makeScore();
    for (let k = 0; k < 10; k++) stepScore(s, drifting(30), SIM_DT); // 2.5 m
    for (let k = 0; k < 200; k++) stepScore(s, gripping(), SIM_DT);
    expect(s.total).toBe(0);
    expect(s.events.at(-1)).toEqual({ type: 'dropped' });
  });

  it('wipes the chain on a crash, also inside the link window (F7), but not on a scrape (F8)', () => {
    const s = makeScore();
    for (let k = 0; k < 120; k++) stepScore(s, drifting(30), SIM_DT);
    stepScore(s, Object.assign(gripping(), { hit: CAR.crashSpeed - 0.5 }), SIM_DT);
    expect(s.active).toBe(true);
    for (let k = 0; k < 60; k++) stepScore(s, gripping(), SIM_DT);
    stepScore(s, Object.assign(gripping(), { hit: CAR.crashSpeed + 0.5 }), SIM_DT);
    expect(s.active).toBe(false);
    expect(s.total).toBe(0);
    expect(s.events.at(-1)).toMatchObject({ type: 'wiped' });
  });
});

describe('laps', () => {
  const track = ovalTrack();
  const L = track.length;
  const F = track.config.finishS;
  /** Drive from arc length a to b (b may be < a for reversing) in 5 m steps. */
  const drive = (l: ReturnType<typeof makeLaps>, a: number, b: number): void => {
    const step = a < b ? 5 : -5;
    for (let s = a; step > 0 ? s <= b : s >= b; s += step) stepLaps(l, track, ((s % L) + L) % L, 0.1);
  };

  it('starts the clock on the first crossing and counts a full lap', () => {
    const l = makeLaps();
    drive(l, F - 24, F + 10);
    expect(l.started).toBe(true);
    expect(l.count).toBe(0);
    drive(l, F + 10, F + L + 10);
    expect(l.count).toBe(1);
    expect(l.last).toBeGreaterThan(0);
    expect(l.best).toBe(l.last);
    expect(l.events[0]).toMatchObject({ lap: 1, best: true });
  });

  it('does not count a lap after reversing over the line (F11)', () => {
    const l = makeLaps();
    drive(l, F - 24, F + 30);
    drive(l, F + 30, F - 30); // reverse back over the line
    drive(l, F - 30, F + 30); // forward again
    expect(l.count).toBe(0);
  });

  it('does not count a lap without the half-lap checkpoint', () => {
    const l = makeLaps();
    drive(l, F - 24, F + 30);
    // Teleport-style shortcut: jump to just before the line without passing the half-lap window.
    stepLaps(l, track, (F - 20 + L) % L, 0.1);
    drive(l, F - 20, F + 20);
    expect(l.count).toBe(0);
  });

  it('keeps the best lap', () => {
    const l = makeLaps();
    drive(l, F - 24, F + 10);
    drive(l, F + 10, F + L + 10);
    const first = l.last!;
    for (let s = F + 10; s <= F + L + 10; s += 10) stepLaps(l, track, s % L, 0.1); // twice as fast
    expect(l.count).toBe(2);
    expect(l.last!).toBeLessThan(first);
    expect(l.best).toBe(l.last);
  });
});

describe('autopilot on the real circuit', () => {
  it('completes a clean lap', () => {
    const s = new Session(mainTrack());
    const i = input();
    let maxAbsD = 0;
    let crashes = 0;
    let guard = 0;
    while (s.laps.count < 1 && guard++ < 120 * 240) {
      autopilotInput(s.car, s.track, i);
      s.step(i);
      maxAbsD = Math.max(maxAbsD, Math.abs(s.car.loc.d));
      if (s.car.hit > CAR.crashSpeed) crashes++;
    }
    expect(s.laps.count).toBe(1);
    expect(crashes).toBe(0);
    expect(maxAbsD).toBeLessThan(s.track.config.halfWidth); // stays on the asphalt
    expect(s.laps.last!).toBeGreaterThan(60);
    expect(s.laps.last!).toBeLessThan(140);
    console.log(`autopilot lap ${s.laps.last!.toFixed(2)} s, max |d| ${maxAbsD.toFixed(2)} m`);
  });
});

describe('playability: a keyboard-style driver on the real circuit', () => {
  // The bot only outputs what a keyboard can (steer −1/0/+1, pedals on/off) and re-decides at a human
  // rate. If it can drift every corner without touching a wall, the circuit and the drift model fit.
  it('drifts every drift corner for three laps without touching a wall', () => {
    const track = mainTrack();
    const s = new Session(track);
    const bot = new DriftBot(track);
    const corners = findCorners(track).filter((c) => c.radius <= BOT.driftMaxRadius && c.angle >= BOT.driftMinAngle);
    const inCorner = corners.map(() => 0);
    const drifting = corners.map(() => 0);
    const i = input();
    let crashes = 0;
    let wallSteps = 0;
    let driftSteps = 0;
    let maxMult = 1;
    let steps = 0;
    while (s.laps.count < 3 && steps < 120 * 300) {
      bot.update(s.car, i, SIM_DT);
      // Digital outputs only.
      expect([-1, 0, 1]).toContain(i.steer);
      expect([0, 1]).toContain(i.throttle);
      expect([0, 1]).toContain(i.brake);
      s.step(i);
      steps++;
      if (s.car.hit > CAR.crashSpeed) crashes++;
      if (s.car.scrape > 0.9) wallSteps++;
      if (s.car.drift) driftSteps++;
      maxMult = Math.max(maxMult, s.score.mult);
      corners.forEach((c, k) => {
        const into = arcDelta(track, s.car.loc.s, c.s0);
        if (into >= 0 && into <= c.s1 - c.s0) {
          inCorner[k]++;
          if (s.car.drift) drifting[k]++;
        }
      });
    }
    expect(s.laps.count).toBe(3);
    expect(crashes).toBe(0);
    expect(wallSteps).toBe(0);
    expect(corners.length).toBeGreaterThanOrEqual(8);
    corners.forEach((c, k) => {
      expect(drifting[k] / inCorner[k], `drift share in the corner at s=${c.s0.toFixed(0)}`).toBeGreaterThan(0.9);
    });
    expect(driftSteps / steps).toBeGreaterThan(0.45); // about half the lap is spent sideways
    expect(maxMult).toBeGreaterThanOrEqual(2); // the S-bend links two drifts
    expect(s.score.total).toBeGreaterThan(3000);
    for (const e of s.laps.events) expect(e.time).toBeLessThan(75);
    console.log(`drift bot laps ${s.laps.events.map((e) => e.time.toFixed(1)).join(' / ')}  score ${s.score.total}`);
  });

  it('gives every drift corner a reachable drift speed', () => {
    const track = mainTrack();
    for (const c of findCorners(track)) {
      if (c.radius > BOT.driftMaxRadius || c.angle < BOT.driftMinAngle) continue;
      // Full lock must be able to turn tighter than the corner at a speed above the drift entry speed.
      const v = driftSpeedFor(c.radius * 0.92);
      expect(v).toBeGreaterThan(DRIFT.entrySpeed + 5);
      expect(fullLockDriftRadius(v)).toBeLessThanOrEqual(c.radius);
    }
  });
});
