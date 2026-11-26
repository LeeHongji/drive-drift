// Nitro tank, boost, surge (drift-gameplay.md §3.3, scenarios F9 and F10) and nitro shards.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CAR } from '../src/config/car';
import { NITRO, SHARDS } from '../src/config/nitro';
import { SIM_DT } from '../src/config/sim';
import { KMH } from '../src/core/math';
import { makePickups, placeShards, resetPickups, stepPickups, type PickupState } from '../src/gameplay/pickups';
import { Session } from '../src/gameplay/session';
import { Keyboard } from '../src/input/keyboard';
import { arcDelta } from '../src/track/track';
import { makeCar, placeCar, type CarInput } from '../src/vehicle/car';
import { mainTrack, ovalTrack, padTrack } from './helpers';

const input = (o: Partial<CarInput> = {}): CarInput => ({ steer: 0, throttle: 0, brake: 0, handbrake: false, nitro: false, ...o });
const run = (s: Session, seconds: number, i: CarInput): void => {
  for (let k = 0; k < Math.round(seconds / SIM_DT); k++) s.step(i);
};
/** A session on the open skidpad with no shards, so only the tank rules act on the nitro level. */
const padSession = (kmh: number, tank: number): Session => {
  const s = new Session(padTrack());
  s.place(100, 0, kmh * KMH);
  s.pickups.shards.length = 0;
  s.car.nitro = tank;
  return s;
};
/** Hold nitro (and throttle) until the boost stops; returns how long it ran and the peak speed. */
const burn = (s: Session): { time: number; peak: number } => {
  let time = 0;
  let peak = 0;
  for (let k = 0; k < 120 * 10; k++) {
    s.step(input({ throttle: 1, nitro: true }));
    if (!s.car.boost) break;
    time += SIM_DT;
    peak = Math.max(peak, s.car.speed);
  }
  return { time, peak };
};

describe('nitro tank', () => {
  it('starts at 0.6 and is restored by a reset', () => {
    expect(makeCar().nitro).toBe(NITRO.start);
    expect(NITRO.start).toBe(0.6);
    const s = padSession(100, 0.2);
    s.reset();
    expect(s.car.nitro).toBe(0.6);
    expect(s.car.boost).toBe(false);
  });

  it('only starts above 8 % but then runs down to empty', () => {
    const low = padSession(100, 0.079);
    low.step(input({ nitro: true }));
    expect(low.car.boost).toBe(false);

    const s = padSession(100, 0.09);
    s.step(input({ nitro: true }));
    expect(s.car.boost).toBe(true);
    run(s, 0.2, input({ nitro: true })); // 0.09 − 0.05: now well under the threshold
    expect(s.car.nitro).toBeLessThan(0.05);
    expect(s.car.boost).toBe(true);
    run(s, 0.3, input({ nitro: true }));
    expect(s.car.boost).toBe(false); // ran dry
    expect(s.car.nitro).toBeLessThan(0.01);
  });

  it('cannot restart under the threshold after the button was released', () => {
    const s = padSession(100, 0.2);
    run(s, 0.6, input({ nitro: true })); // 0.2 → 0.05
    expect(s.car.boost).toBe(true);
    s.step(input());
    expect(s.car.boost).toBe(false);
    s.step(input({ nitro: true }));
    expect(s.car.boost).toBe(false);
    expect(s.car.nitro).toBeLessThan(NITRO.minStart);
  });

  it('empties a full tank in 4 s (F9)', () => {
    const { time } = burn(padSession(200, 1));
    expect(time).toBeGreaterThan(4 - 2 * SIM_DT);
    expect(time).toBeLessThan(4 + 2 * SIM_DT);
  });

  it('refills at 0.015/s on its own and not at all while boosting', () => {
    const s = padSession(0, 0);
    run(s, 10, input());
    expect(s.car.nitro).toBeCloseTo(0.15, 3);

    const b = padSession(150, 0.5);
    let last = b.car.nitro;
    for (let k = 0; k < 120; k++) {
      b.step(input({ nitro: true, throttle: 1 }));
      expect(b.car.nitro).toBeLessThan(last);
      last = b.car.nitro;
    }
    expect(b.car.nitro).toBeCloseTo(0.5 - NITRO.drain, 3);
  });

  it('refills from empty to full in about 4.65 s of drifting (F10)', () => {
    const s = padSession(100, 0);
    let driftFrom = NaN;
    let fullAt = NaN;
    for (let k = 0; k < 120 * 6 && Number.isNaN(fullAt); k++) {
      s.step(input({ steer: 1, throttle: 1, handbrake: k < 24 }));
      if (Number.isNaN(driftFrom) && s.car.drift) driftFrom = s.time;
      if (Number.isNaN(driftFrom)) continue;
      expect(s.car.drift).toBe(true); // the whole refill happens in one unbroken drift
      if (s.car.nitro >= 1) fullAt = s.time;
    }
    expect(fullAt - driftFrom).toBeGreaterThan(4.6);
    expect(fullAt - driftFrom).toBeLessThan(4.7);
    console.log(`F10: drift from ${driftFrom.toFixed(3)} s, tank full at ${fullAt.toFixed(3)} s (${(fullAt - driftFrom).toFixed(3)} s of drifting)`);
  });
});

describe('nitro boost', () => {
  it('replaces the throttle and never passes its cap', () => {
    const s = padSession(0, 0.6);
    run(s, 1, input({ nitro: true })); // no throttle at all
    expect(s.car.speed).toBeGreaterThan(30); // 46 m/s² at standstill, tapering

    const top = padSession(310, 0.98);
    const { peak } = burn(top);
    expect(peak).toBeGreaterThan(CAR.topSpeed);
    expect(peak).toBeLessThan(NITRO.topSpeed);
  });

  it('surges from a full tank: higher peak speed than from a 0.98 tank (F9)', () => {
    const full = padSession(310, 1);
    full.step(input({ throttle: 1, nitro: true }));
    expect(full.car.surge).toBeGreaterThan(0.99);
    const a = burn(full);

    const partial = padSession(310, 0.98);
    partial.step(input({ throttle: 1, nitro: true }));
    expect(partial.car.surge).toBe(0);
    const b = burn(partial);

    expect(a.peak).toBeGreaterThan(NITRO.topSpeed); // the surge lifts the cap for a while
    expect(a.peak).toBeLessThan(NITRO.topSpeed + NITRO.surgeSpeed);
    expect(a.peak).toBeGreaterThan(b.peak + 3);
    console.log(`F9: peak ${(a.peak / KMH).toFixed(1)} km/h from a full tank, ${(b.peak / KMH).toFixed(1)} km/h from 0.98`);
  });

  it('lets the surge fall to zero over 3 s and clears it when the boost stops', () => {
    const s = padSession(250, 1);
    run(s, 1.5, input({ nitro: true }));
    expect(s.car.surge).toBeCloseTo(0.5, 2);
    run(s, 1.6, input({ nitro: true }));
    expect(s.car.surge).toBe(0);
    expect(s.car.boost).toBe(true);

    const t = padSession(250, 1);
    run(t, 0.5, input({ nitro: true }));
    expect(t.car.surge).toBeGreaterThan(0.8);
    t.step(input());
    expect(t.car.surge).toBe(0);
    // The tank is no longer full, so firing again gives a plain boost.
    t.step(input({ nitro: true }));
    expect(t.car.boost).toBe(true);
    expect(t.car.surge).toBe(0);
  });

  it('bleeds back to the normal top speed at 7 m/s² once the boost is off', () => {
    const s = padSession(310, 0.6);
    burn(s);
    const v0 = s.car.speed;
    expect(v0).toBeGreaterThan(CAR.topSpeed + 6);
    run(s, 0.5, input({ throttle: 1 }));
    expect(v0 - s.car.speed).toBeCloseTo(NITRO.bleed * 0.5, 1);
    run(s, 3, input({ throttle: 1 }));
    expect(s.car.speed).toBeLessThan(CAR.topSpeed + 1e-6);
    expect(s.car.speed).toBeGreaterThan(CAR.topSpeed - 0.1);
  });
});

describe('nitro shards: placement', () => {
  it('puts exactly 11 shards on the circuit, all on the asphalt and apart from each other', () => {
    const track = mainTrack();
    const spots = placeShards(track);
    expect(spots.length).toBe(11);
    expect(SHARDS.count).toBe(11);
    spots.forEach((p, k) => {
      expect(p.s).toBeGreaterThanOrEqual(0);
      expect(p.s).toBeLessThan(track.length);
      expect(Math.abs(p.d)).toBeLessThanOrEqual(track.config.halfWidth - SHARDS.edgeMargin);
      // Off the centreline by more than the reach: each one asks for a deliberate line.
      expect(Math.abs(p.d)).toBeGreaterThan(SHARDS.reachLateral);
      const next = spots[(k + 1) % spots.length];
      expect(Math.abs(arcDelta(track, next.s, p.s))).toBeGreaterThanOrEqual(SHARDS.minSpacing);
      if (k > 0) expect(p.s).toBeGreaterThan(spots[k - 1].s);
    });
    console.log(`shards: ${spots.map((p) => `${p.s.toFixed(0)} m ${p.d > 0 ? 'L' : 'R'}${Math.abs(p.d)}`).join(' · ')}`);
  });

  it('is deterministic and also fills tracks without corners', () => {
    expect(placeShards(mainTrack())).toEqual(placeShards(mainTrack()));
    for (const track of [ovalTrack(), padTrack()]) {
      const spots = placeShards(track);
      expect(spots.length).toBe(11);
      for (const p of spots) expect(Math.abs(p.d)).toBeLessThan(track.config.halfWidth);
    }
  });
});

describe('nitro shards: collection', () => {
  // The oval's first shards lie on its 2 km front straight, where arc length and lateral offset are exact.
  const track = ovalTrack();
  const setup = (ahead: number, side: number, tank = 0.3): { p: PickupState; car: ReturnType<typeof makeCar> } => {
    const p = makePickups(track);
    const car = makeCar();
    // `ahead` is how far the shard is in front of the car; `side` is the car's offset from the shard's lane.
    placeCar(car, track, p.shards[0].s - ahead, p.shards[0].d + side);
    car.nitro = tank;
    resetPickups(p, car.nitro);
    return { p, car };
  };

  it('adds 0.2 to the tank and reports the shard', () => {
    const { p, car } = setup(0, 0);
    stepPickups(p, car, track, SIM_DT);
    expect(car.nitro).toBeCloseTo(0.5, 10);
    expect(p.events).toEqual([{ type: 'collected', index: 0, nitro: car.nitro }]);
    expect(p.shards[0].timer).toBe(SHARDS.respawn);
  });

  it('caps the tank at 1 and reports it as full once', () => {
    const { p, car } = setup(0, 0, 0.9);
    stepPickups(p, car, track, SIM_DT);
    expect(car.nitro).toBe(1);
    expect(p.events.map((e) => e.type)).toEqual(['collected', 'full']);
    stepPickups(p, car, track, SIM_DT);
    expect(p.events.length).toBe(2);
  });

  it('reports full when the tank fills up by itself', () => {
    const s = padSession(0, 0.985);
    run(s, 1, input());
    expect(s.pickups.events).toEqual([{ type: 'full' }]);
  });

  it('collects inside the box −2 … +2.8 m along the track and ±2.4 m across, and not outside it', () => {
    const cases: [number, number, boolean][] = [
      [2.75, 0, true], // shard just inside the reach ahead
      [2.85, 0, false],
      [-1.95, 0, true], // shard just behind the car centre
      [-2.05, 0, false],
      [0, 2.35, true],
      [0, 2.45, false],
      [0, -2.35, true],
      [0, -2.45, false],
      [2.75, 2.35, true], // corner of the box
    ];
    for (const [ahead, side, hit] of cases) {
      const { p, car } = setup(ahead, side);
      stepPickups(p, car, track, SIM_DT);
      expect(p.events.length, `shard ${ahead} m ahead, car ${side} m to the side`).toBe(hit ? 1 : 0);
    }
  });

  it('brings a shard back 8 s after it was collected', () => {
    const { p, car } = setup(0, 0, 0);
    let t = 0;
    const taken: number[] = [];
    while (t < 17) {
      const before = p.events.length;
      stepPickups(p, car, track, SIM_DT); // the car sits on the shard the whole time
      if (p.events.length > before) taken.push(t);
      if (t > 4 && t < 7.9) expect(p.shards[0].timer).toBeGreaterThan(0);
      t += SIM_DT;
    }
    expect(taken.length).toBe(3);
    expect(taken[1] - taken[0]).toBeGreaterThan(8 - SIM_DT);
    expect(taken[1] - taken[0]).toBeLessThan(8 + 3 * SIM_DT);
    expect(car.nitro).toBeCloseTo(0.6, 10);
  });

  it('works through a session: driving over a shard fills the tank, a reset puts everything back', () => {
    const s = new Session(mainTrack());
    const shard = s.pickups.shards[1];
    s.place(shard.s - 40, shard.d, 150 * KMH);
    const before = s.car.nitro;
    run(s, 1.5, input({ throttle: 1 }));
    expect(s.pickups.events).toEqual([{ type: 'collected', index: 1, nitro: expect.closeTo(before + SHARDS.gain + 0.015 * 1.5, 1) }]);
    expect(s.car.nitro).toBeGreaterThan(before + SHARDS.gain);
    expect(shard.timer).toBeGreaterThan(0);
    const same = s.pickups;
    s.reset();
    expect(s.pickups).toBe(same); // visuals hold on to this object
    expect(shard.timer).toBe(0);
    expect(s.pickups.events.length).toBe(0);
    expect(s.car.nitro).toBe(NITRO.start);
  });

  it('is missed by a car on the centreline', () => {
    const s = new Session(mainTrack());
    const shard = s.pickups.shards[1];
    s.place(shard.s - 40, 0, 150 * KMH);
    run(s, 1.5, input({ throttle: 1 }));
    expect(s.pickups.events.length).toBe(0);
  });
});

describe('keyboard nitro keys', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps Alt and N to nitro, and other keys still work while Alt is held', () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    vi.stubGlobal('window', { addEventListener: (type: string, h: (e: unknown) => void) => (handlers[type] = h) });
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    let resets = 0;
    const kb = new Keyboard({ KeyR: () => resets++ });
    const out = input();
    const key = (type: 'keydown' | 'keyup', code: string, altKey = false): boolean => {
      let prevented = false;
      handlers[type]({ code, altKey, metaKey: false, ctrlKey: false, repeat: false, target: null, preventDefault: () => (prevented = true) });
      return prevented;
    };

    expect(kb.read(out).nitro).toBe(false);
    expect(key('keydown', 'AltLeft', true)).toBe(true); // default prevented: no browser menu
    expect(kb.read(out).nitro).toBe(true);
    // With Alt down every later event carries altKey = true.
    key('keydown', 'KeyA', true);
    key('keydown', 'KeyW', true);
    key('keydown', 'Space', true);
    expect(kb.read(out)).toEqual({ steer: -1, throttle: 1, brake: 0, handbrake: true, nitro: true });
    key('keydown', 'KeyR', true);
    expect(resets).toBe(1);
    expect(key('keyup', 'AltLeft')).toBe(true);
    expect(kb.read(out).nitro).toBe(false);
    expect(kb.read(out).steer).toBe(-1);

    key('keydown', 'KeyN');
    expect(kb.read(out).nitro).toBe(true);
    key('keyup', 'KeyN');
    key('keydown', 'AltRight', true);
    expect(kb.read(out).nitro).toBe(true);
    handlers.blur({});
    expect(kb.read(out)).toEqual(input());
  });
});
