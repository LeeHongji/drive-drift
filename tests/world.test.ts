import { describe, expect, it } from 'vitest';
import { TRACK } from '../src/config/track';
import { WORLD } from '../src/config/world';
import { buildTrack, frameAt, makeLocation, project } from '../src/track/track';
import { buildHeightfield, getHeightfield, sampleGrid } from '../src/world/heightfield';
import { bannerRanges, galleryDepth, galleryRange, gallerySpec, placeChevrons, placeLamps, placePosts, tunnelFactor, wallTopOffset } from '../src/world/layout';
import { placePiers, placeTrees } from '../src/world/placement';
import { mainTrack, ovalTrack } from './helpers';

const track = mainTrack();
const hf = getHeightfield(track);
/** Outer face of the walls: the terrain must stay under the road at least this far out. */
const wallOuter = track.wallOffset + track.config.wallThickness;

describe('terrain', () => {
  it('stays below the road surface everywhere between the walls', () => {
    let worst = -Infinity;
    for (let s = 0; s < track.length; s += 2) {
      for (let d = -wallOuter; d <= wallOuter + 1e-9; d += 0.75) {
        const f = frameAt(track, s, d);
        worst = Math.max(worst, hf.heightAt(f.x, f.z) - f.y);
      }
    }
    // Nominally `drop` below; the grid's straight triangles cut slightly into that on banked curves.
    expect(worst).toBeLessThan(-0.25);
  });

  it('has every grid vertex inside the corridor below the banked road plane', () => {
    const { fine } = hf;
    const loc = makeLocation();
    let checked = 0;
    for (let iz = 0; iz < fine.nz; iz++) {
      for (let ix = 0; ix < fine.nx; ix++) {
        const k = iz * fine.nx + ix;
        if (hf.dist[k] > wallOuter) continue;
        project(track, fine.x0 + ix * fine.cell, fine.z0 + iz * fine.cell, loc, true);
        expect(fine.h[k]).toBeLessThan(loc.y - WORLD.terrain.drop * 0.6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });

  it('is flat beside the road where the ground was filled or cut', () => {
    // On the lake straight the infield side is plain ground: `drop` below the road out to flatDist.
    const s = (track.spans[0].s0 + track.spans[0].s1) / 2;
    for (const d of [12, 15, 18]) {
      const f = frameAt(track, s, -hf.lake.side * d);
      expect(hf.heightAt(f.x, f.z)).toBeCloseTo(frameAt(track, s).y - WORLD.terrain.drop, 1);
    }
  });

  it('joins the fine and far grids without a step', () => {
    const { fine, far } = hf;
    let worst = 0;
    for (let ix = 0; ix < fine.nx; ix++) {
      for (const iz of [0, fine.nz - 1]) {
        const x = fine.x0 + ix * fine.cell;
        const z = fine.z0 + iz * fine.cell;
        worst = Math.max(worst, Math.abs(fine.h[iz * fine.nx + ix] - sampleGrid(far, far.h, x, z)));
      }
    }
    for (let iz = 0; iz < fine.nz; iz++) {
      for (const ix of [0, fine.nx - 1]) {
        const x = fine.x0 + ix * fine.cell;
        const z = fine.z0 + iz * fine.cell;
        worst = Math.max(worst, Math.abs(fine.h[iz * fine.nx + ix] - sampleGrid(far, far.h, x, z)));
      }
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('stays within the triangle budget', () => {
    const { fine, far } = hf;
    const triangles = 2 * ((fine.nx - 1) * (fine.nz - 1) + (far.nx - 1) * (far.nz - 1));
    expect(triangles).toBeLessThan(500_000);
  });

  it('rings the valley with peaks but leaves the sun side open', () => {
    let peak = -Infinity;
    for (let i = 0; i < hf.far.h.length; i++) peak = Math.max(peak, hf.far.h[i]);
    expect(peak).toBeGreaterThan(300);
    expect(hf.ringAt(track.x[0], track.z[0])).toBe(0);
  });

  it('is the same every time for a given seed and changes with the seed', () => {
    const again = buildHeightfield(track);
    expect(Array.from(again.fine.h.subarray(0, 4000))).toEqual(Array.from(hf.fine.h.subarray(0, 4000)));
    let sumA = 0;
    let sumB = 0;
    for (let i = 0; i < hf.far.h.length; i++) {
      sumA += hf.far.h[i];
      sumB += again.far.h[i];
    }
    expect(sumB).toBe(sumA);
    const other = buildHeightfield(buildTrack({ ...TRACK, seed: TRACK.seed + 1 }));
    let sumC = 0;
    for (let i = 0; i < other.far.h.length; i++) sumC += other.far.h[i];
    expect(sumC).not.toBe(sumA);
  });
});

describe('lake', () => {
  const span = track.spans.find((sp) => sp.name === WORLD.lake.segment)!;
  const mid = (span.s0 + span.s1) / 2;

  it('lies below the road on the outside of the lake straight', () => {
    expect(hf.lake.present).toBe(true);
    for (let s = span.s0 + 20; s < span.s1 - 20; s += 20) expect(frameAt(track, s).y - hf.lake.level).toBeGreaterThan(1.5);
    const wet = frameAt(track, mid, hf.lake.side * 70);
    expect(hf.heightAt(wet.x, wet.z)).toBeLessThan(hf.lake.level - 1);
    expect(hf.lakeAt(wet.x, wet.z)).toBeGreaterThan(0);
  });

  it('keeps the shore close to the lake straight', () => {
    // Walk outward from the wall until the ground goes under water.
    let shore = Infinity;
    for (let d = wallOuter; d < 80; d += 0.5) {
      const f = frameAt(track, mid, hf.lake.side * d);
      if (hf.heightAt(f.x, f.z) < hf.lake.level) {
        shore = d;
        break;
      }
    }
    expect(shore).toBeGreaterThan(wallOuter + 2);
    expect(shore).toBeLessThan(40);
  });

  it('never floods the infield or the road', () => {
    const dry = frameAt(track, mid, -hf.lake.side * 70);
    expect(hf.lakeAt(dry.x, dry.z)).toBe(0);
    for (let s = 0; s < track.length; s += 4) {
      for (const d of [-wallOuter, 0, wallOuter]) {
        const f = frameAt(track, s, d);
        expect(hf.heightAt(f.x, f.z)).toBeGreaterThan(hf.lake.level);
      }
    }
  });
});

describe('placement', () => {
  const trees = placeTrees(track, hf);

  it('keeps every tree off the road, out of the walls and out of the lake', () => {
    expect(trees.length).toBeGreaterThan(150);
    expect(trees.length).toBeLessThanOrEqual(WORLD.trees.maxCount);
    const loc = makeLocation();
    for (const t of trees) {
      project(track, t.x, t.z, loc, true);
      // A crown is up to 5 m wide at the largest scale; the trunk must be well clear of the wall.
      expect(Math.abs(loc.d)).toBeGreaterThan(wallOuter + 6);
      expect(t.y).toBeGreaterThan(hf.lake.level);
      expect(hf.lakeAt(t.x, t.z) < 1 || hf.heightAt(t.x, t.z) > hf.lake.level).toBe(true);
    }
  });

  it('keeps trees apart', () => {
    let closest = Infinity;
    for (let i = 0; i < trees.length; i++) {
      for (let j = i + 1; j < trees.length; j++) closest = Math.min(closest, Math.hypot(trees[i].x - trees[j].x, trees[i].z - trees[j].z));
    }
    expect(closest).toBeGreaterThanOrEqual(WORLD.trees.minSpacing);
  });

  it('is deterministic for a given seed', () => {
    expect(placeTrees(track, hf)).toEqual(trees);
    const fresh = buildTrack(TRACK);
    expect(placeTrees(fresh, buildHeightfield(fresh))).toEqual(trees);
    expect(placeChevrons(fresh)).toEqual(placeChevrons(track));
    expect(placeLamps(fresh)).toEqual(placeLamps(track));
    const other = buildTrack({ ...TRACK, seed: TRACK.seed + 1 });
    expect(placeTrees(other, buildHeightfield(other))).not.toEqual(trees);
  });

  it('stands every board, lamp and post on a wall, never between the walls', () => {
    const chevrons = placeChevrons(track);
    const lamps = placeLamps(track);
    const posts = placePosts(track, chevrons, lamps);
    expect(chevrons.length).toBeGreaterThan(20);
    expect(lamps.length).toBeGreaterThan(40);
    expect(posts.length).toBeGreaterThan(40);
    const lateral = wallTopOffset(track);
    expect(lateral).toBeGreaterThanOrEqual(track.wallOffset);
    expect(lateral).toBeLessThanOrEqual(wallOuter);
    const loc = makeLocation();
    for (const p of [...chevrons, ...lamps, ...posts]) {
      const f = frameAt(track, p.s, p.side * lateral);
      project(track, f.x, f.z, loc, true);
      expect(Math.abs(loc.d)).toBeGreaterThanOrEqual(track.wallOffset);
    }
  });

  it('puts chevrons only on the outside of tight corners and none under the gallery', () => {
    for (const c of placeChevrons(track)) {
      const curv = frameAt(track, c.s).curv;
      expect(Math.abs(curv)).toBeGreaterThan(1 / TRACK.chevronRadius);
      // Left turn (curv > 0): the outside is the right wall.
      expect(c.side).toBe(curv > 0 ? -1 : 1);
      expect(galleryDepth(track, c.s)).toBeLessThan(0);
    }
    for (const l of placeLamps(track)) expect(galleryDepth(track, l.s)).toBeLessThan(0);
  });

  it('keeps posts clear of boards and lamps on the same wall', () => {
    const chevrons = placeChevrons(track);
    const lamps = placeLamps(track);
    for (const p of placePosts(track, chevrons, lamps)) {
      for (const c of chevrons) if (c.side === p.side) expect(Math.abs(c.s - p.s)).toBeGreaterThan(WORLD.chevrons.width / 2);
      for (const l of lamps) if (l.side === p.side) expect(Math.abs(l.s - p.s)).toBeGreaterThan(1);
    }
  });

  it('builds piers only under the road, where it is well above the ground', () => {
    const piers = placePiers(track, hf);
    expect(piers.length).toBeGreaterThan(0);
    for (const p of piers) {
      const f = frameAt(track, p.s);
      expect(f.y - hf.heightAt(f.x, f.z)).toBeGreaterThan(WORLD.piers.minGap);
      // Columns reach from under the deck and cap down into the ground.
      expect(p.foot).toBeGreaterThan(TRACK.deckDepth + WORLD.piers.capDepth);
      expect(galleryDepth(track, p.s)).toBeLessThan(0);
    }
  });

  it('covers corners with whole banner boards', () => {
    const ranges = bannerRanges(track);
    expect(ranges.length).toBeGreaterThan(3);
    for (const r of ranges) {
      expect(r.s1).toBeGreaterThan(r.s0);
      expect(r.s1 - r.s0).toBeLessThanOrEqual(track.length);
      expect((r.s1 - r.s0) / WORLD.banners.boardLength).toBeCloseTo(Math.round((r.s1 - r.s0) / WORLD.banners.boardLength), 6);
    }
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].s0).toBeGreaterThan(ranges[i - 1].s1);
  });
});

describe('snow gallery', () => {
  const range = galleryRange(track)!;

  it('covers the gallery segment with whole bays', () => {
    const span = track.spans.find((sp) => sp.name === WORLD.gallery.segment)!;
    const spec = gallerySpec(track)!;
    expect(range.s0).toBeCloseTo(span.s0, 6);
    expect(range.s1).toBeCloseTo(span.s1, 6);
    expect(spec.bays * spec.bayLength).toBeCloseTo(range.s1 - range.s0, 6);
    expect(spec.bayLength).toBeGreaterThan(WORLD.gallery.pierWidth + 2);
    expect(Math.abs(spec.openSide)).toBe(1);
  });

  it('tunnelFactor is 1 inside, 0 outside and blends across each portal', () => {
    const mid = (range.s0 + range.s1) / 2;
    const half = WORLD.gallery.portalBlend / 2;
    expect(tunnelFactor(track, mid)).toBe(1);
    expect(tunnelFactor(track, range.s0 + half + 1)).toBe(1);
    expect(tunnelFactor(track, range.s1 - half - 1)).toBe(1);
    expect(tunnelFactor(track, range.s0)).toBeCloseTo(0.5, 6);
    expect(tunnelFactor(track, range.s1)).toBeCloseTo(0.5, 6);
    expect(tunnelFactor(track, range.s0 - half - 1)).toBe(0);
    expect(tunnelFactor(track, range.s1 + half + 1)).toBe(0);
    expect(tunnelFactor(track, 0)).toBe(0);
    expect(tunnelFactor(track, mid + track.length / 2)).toBe(0);
    // Arc length wraps.
    expect(tunnelFactor(track, mid + track.length)).toBe(1);
    expect(tunnelFactor(track, mid - track.length)).toBe(1);
    let last = 0;
    for (let s = range.s0 - half; s <= range.s0 + half; s += 1) {
      const v = tunnelFactor(track, s);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('never leaves the gallery on a viaduct', () => {
    for (let s = range.s0; s <= range.s1; s += 4) {
      const f = frameAt(track, s);
      expect(f.y - hf.heightAt(f.x, f.z)).toBeLessThan(1.5);
    }
  });

  it('is absent on a track without the gallery segment', () => {
    const oval = ovalTrack();
    expect(galleryRange(oval)).toBeNull();
    expect(tunnelFactor(oval, 100)).toBe(0);
  });
});
