import { describe, expect, it } from 'vitest';
import { TRACK } from '../src/config/track';
import { arcDelta, buildTrack, closeLayout, frameAt, makeLocation, project } from '../src/track/track';
import { mainTrack } from './helpers';

describe('track generation', () => {
  const t = mainTrack();

  it('closes and has the designed size', () => {
    expect(t.length).toBeGreaterThan(3000);
    expect(t.length).toBeLessThan(4000);
    expect(t.spacing).toBeCloseTo(2, 2);
    // Every gap between neighbouring samples, including the wrap-around, equals the spacing.
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      expect(Math.hypot(t.x[j] - t.x[i], t.z[j] - t.z[i])).toBeCloseTo(t.spacing, 1);
    }
  });

  it('keeps grade, bank and radius inside the design limits', () => {
    let minR = Infinity;
    for (let i = 0; i < t.n; i++) {
      expect(Math.abs(t.grade[i])).toBeLessThan(0.08);
      expect(Math.abs(t.bank[i])).toBeLessThanOrEqual(TRACK.bankMax + 1e-9);
      minR = Math.min(minR, 1 / Math.max(1e-9, Math.abs(t.curv[i])));
    }
    expect(minR).toBeGreaterThan(32); // tightest hairpin is designed at R 36 m
    expect(minR).toBeLessThan(40);
  });

  it('is clockwise: right turns dominate and the total turn is −360°', () => {
    let turn = 0;
    for (let i = 0; i < t.n; i++) turn += t.curv[i] * t.spacing;
    expect(turn).toBeCloseTo(-2 * Math.PI, 1);
  });

  it('never brings two different road sections closer than their walls', () => {
    let minGap = Infinity;
    for (let i = 0; i < t.n; i += 3) {
      for (let j = i + 60; j < t.n; j += 3) {
        if (t.n - j + i < 60) continue;
        minGap = Math.min(minGap, Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]));
      }
    }
    expect(minGap).toBeGreaterThan(2 * t.wallOffset + 10);
  });

  it('rejects layouts that cannot close', () => {
    const open = TRACK.segments.map((s) => (s.kind === 'arc' && s.name === '下山长右弯' ? { ...s, angle: 100 } : s));
    expect(() => closeLayout(open)).toThrow(/need ±360/);
    expect(() => buildTrack({ ...TRACK, segments: TRACK.segments.map((s) => ({ ...s, solve: false })) })).toThrow(/solve/);
  });
});

describe('track queries', () => {
  const t = mainTrack();

  it('round-trips frameAt → project for points on and beside the road', () => {
    const loc = makeLocation();
    for (const s of [0, 137.3, 900, 1950, 2900, t.length - 1.5]) {
      for (const d of [0, 5, -7.5]) {
        const f = frameAt(t, s, d);
        project(t, f.x, f.z, loc, true);
        // Offsetting sideways on a 28 m hairpin shifts the nearest polyline point by up to d·spacing/2R ≈ 0.27 m.
        expect(Math.abs(arcDelta(t, loc.s, s))).toBeLessThan(0.35);
        expect(loc.d).toBeCloseTo(d, 1);
        expect(loc.y).toBeCloseTo(f.y, 1);
      }
    }
  });

  it('measures d positive to the left of the driving direction', () => {
    const f = frameAt(t, 300);
    const loc = makeLocation();
    // Left of forward (tx, tz) is (tz, −tx).
    project(t, f.x + f.tz * 3, f.z - f.tx * 3, loc, true);
    expect(loc.d).toBeCloseTo(3, 1);
  });

  it('banks toward the inside: the inner edge of a corner is lower', () => {
    const hairpin = t.spans.find((s) => s.name === '山口发卡弯 1')!;
    const s = (hairpin.s0 + hairpin.s1) / 2;
    const centre = frameAt(t, s);
    expect(centre.curv).toBeLessThan(0); // right-hander
    expect(frameAt(t, s, -6).y).toBeLessThan(centre.y); // right side (inside) is lower
    expect(frameAt(t, s, 6).y).toBeGreaterThan(centre.y);
  });

  it('follows a moving point with the local window and recovers after a teleport', () => {
    const loc = makeLocation();
    project(t, t.x[0], t.z[0], loc, true);
    for (let s = 0; s < t.length; s += 1.7) {
      const f = frameAt(t, s, 2);
      project(t, f.x, f.z, loc);
      expect(Math.abs(arcDelta(t, loc.s, s))).toBeLessThan(0.3);
    }
    const far = frameAt(t, 1800, -1);
    project(t, far.x, far.z, loc); // hint is a full lap away: falls back to the global search
    expect(Math.abs(arcDelta(t, loc.s, 1800))).toBeLessThan(0.3);
  });
});
