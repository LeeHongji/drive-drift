// The landscape as numbers: a seeded heightmap conformed to the track, the lake carved into it, and the
// queries the rest of the world needs (height, slope, distance to the track). Pure logic, no engine imports,
// so it runs in Node for tests and timing.
//
// Two grids share one surface: a fine grid around the circuit and a far grid for the mountains. The far grid's
// cell is a whole multiple of the fine one and the fine grid's rim eases onto the far surface, so the meshes
// built from them meet without cracks.

import { RENDER } from '../config/render';
import { WORLD } from '../config/world';
import { clamp, DEG, lerp, smoothstep } from '../core/math';
import { frameAt, type Track } from '../track/track';
import { galleryDepth, gallerySpec } from './layout';
import { fbm, ridged, vnoise } from './noise';

export interface Grid {
  /** World position of vertex (0, 0), cell size, and vertex counts. */
  x0: number;
  z0: number;
  cell: number;
  nx: number;
  nz: number;
  /** Height and its gradient (dh/dx, dh/dz) per vertex, row-major (index = iz · nx + ix). */
  h: Float32Array;
  gx: Float32Array;
  gz: Float32Array;
}

export interface LakeInfo {
  /** False when the track has no lake segment (test layouts); the other fields are then meaningless. */
  present: boolean;
  /** Water surface height, metres. */
  level: number;
  /** +1 = the lake is on the left of the driving direction along the lake segment, −1 = on the right. */
  side: 1 | -1;
  /** Bounding box of the basin, metres. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Heightfield {
  fine: Grid;
  far: Grid;
  /** Distance from each fine-grid vertex to the centreline, capped at WORLD.terrain.stampRadius. */
  dist: Float32Array;
  lake: LakeInfo;
  /** Ground height at a world position (matches the terrain mesh triangle for triangle). */
  heightAt(x: number, z: number): number;
  /** Ground gradient (dh/dx, dh/dz) at a world position, written to `out`. */
  gradientAt(x: number, z: number, out: [number, number]): [number, number];
  /** Horizontal distance to the centreline: exact to a few centimetres near the track, approximate far away. */
  trackDistAt(x: number, z: number): number;
  /** Mountain-ring weight 0…1 at a world position (0 in the valley, 1 among the peaks). */
  ringAt(x: number, z: number): number;
  /** Lake basin weight 0…1 at a world position: 0 on land and inside the circuit, 1 over open water. */
  lakeAt(x: number, z: number): number;
  /** Milliseconds the build took. */
  buildMs: number;
}

const cache = new WeakMap<Track, Heightfield>();

/** The heightfield for a track, built on first use and shared by the terrain, vegetation and props. */
export function getHeightfield(track: Track): Heightfield {
  let hf = cache.get(track);
  if (!hf) {
    hf = buildHeightfield(track);
    cache.set(track, hf);
  }
  return hf;
}

/** Height on a grid at (x, z), interpolated on the same two triangles per cell the mesh uses. */
export function sampleGrid(g: Grid, a: Float32Array, x: number, z: number): number {
  const fx = clamp((x - g.x0) / g.cell, 0, g.nx - 1.0001);
  const fz = clamp((z - g.z0) / g.cell, 0, g.nz - 1.0001);
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const u = fx - ix;
  const v = fz - iz;
  const i = iz * g.nx + ix;
  const h10 = a[i + 1];
  const h01 = a[i + g.nx];
  // The cell's diagonal runs from (1, 0) to (0, 1).
  if (u + v <= 1) {
    const h00 = a[i];
    return h00 + (h10 - h00) * u + (h01 - h00) * v;
  }
  const h11 = a[i + g.nx + 1];
  return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
}

function makeGrid(x0: number, z0: number, cell: number, nx: number, nz: number): Grid {
  return { x0, z0, cell, nx, nz, h: new Float32Array(nx * nz), gx: new Float32Array(nx * nz), gz: new Float32Array(nx * nz) };
}

function gradients(g: Grid): void {
  const { nx, nz, h, cell } = g;
  for (let iz = 0; iz < nz; iz++) {
    const zm = iz > 0 ? iz - 1 : iz;
    const zp = iz < nz - 1 ? iz + 1 : iz;
    for (let ix = 0; ix < nx; ix++) {
      const xm = ix > 0 ? ix - 1 : ix;
      const xp = ix < nx - 1 ? ix + 1 : ix;
      const i = iz * nx + ix;
      g.gx[i] = (h[iz * nx + xp] - h[iz * nx + xm]) / ((xp - xm) * cell);
      g.gz[i] = (h[zp * nx + ix] - h[zm * nx + ix]) / ((zp - zm) * cell);
    }
  }
}

/** Smooth maximum: like max(a, b) but rounded over about k metres. */
const smax = (a: number, b: number, k: number): number => 0.5 * (a + b + Math.sqrt((a - b) * (a - b) + k * k));

export function buildHeightfield(track: Track): Heightfield {
  const t0 = performance.now();
  const T = WORLD.terrain;
  const LK = WORLD.lake;
  const seed = track.config.seed | 0;
  const n = track.n;

  // ---- extents ----
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let bz0 = Infinity;
  let bz1 = -Infinity;
  for (let i = 0; i < n; i++) {
    bx0 = Math.min(bx0, track.x[i]);
    bx1 = Math.max(bx1, track.x[i]);
    bz0 = Math.min(bz0, track.z[i]);
    bz1 = Math.max(bz1, track.z[i]);
  }
  const cell = T.cell;
  const big = cell * T.coarseRatio;
  const ix0 = Math.floor((bx0 - T.innerMargin) / big) * big;
  const ix1 = Math.ceil((bx1 + T.innerMargin) / big) * big;
  const iz0 = Math.floor((bz0 - T.innerMargin) / big) * big;
  const iz1 = Math.ceil((bz1 + T.innerMargin) / big) * big;
  const outer = Math.ceil(T.outerMargin / big) * big;
  const ox0 = ix0 - outer;
  const ox1 = ix1 + outer;
  const oz0 = iz0 - outer;
  const oz1 = iz1 + outer;
  const fine = makeGrid(ix0, iz0, cell, (ix1 - ix0) / cell + 1, (iz1 - iz0) / cell + 1);
  const far = makeGrid(ox0, oz0, big, (ox1 - ox0) / big + 1, (oz1 - oz0) / big + 1);

  // ---- guide grid: a smooth surface that follows the road's height, and a far distance field ----
  const gc = T.guideCell;
  const gnx = Math.ceil((ox1 - ox0) / gc) + 1;
  const gnz = Math.ceil((oz1 - oz0) / gc) + 1;
  const gBase = new Float32Array(gnx * gnz);
  const gDist = new Float32Array(gnx * gnz);
  {
    const step = 3;
    const m = Math.ceil(n / step);
    const sx = new Float64Array(m);
    const sy = new Float64Array(m);
    const sz = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      sx[k] = track.x[k * step];
      sy[k] = track.y[k * step];
      sz[k] = track.z[k * step];
    }
    const soft2 = T.guideSoftness * T.guideSoftness;
    for (let jz = 0; jz < gnz; jz++) {
      for (let jx = 0; jx < gnx; jx++) {
        const x = ox0 + jx * gc;
        const z = oz0 + jz * gc;
        let wSum = 0;
        let hSum = 0;
        let near = Infinity;
        for (let k = 0; k < m; k++) {
          const dx = x - sx[k];
          const dz = z - sz[k];
          const d2 = dx * dx + dz * dz;
          if (d2 < near) near = d2;
          const q = d2 + soft2;
          const w = 1 / (q * q);
          wSum += w;
          hSum += w * sy[k];
        }
        gBase[jz * gnx + jx] = hSum / wSum;
        gDist[jz * gnx + jx] = Math.sqrt(near);
      }
    }
  }
  const guide = (a: Float32Array, x: number, z: number): number => {
    const fx = clamp((x - ox0) / gc, 0, gnx - 1.0001);
    const fz = clamp((z - oz0) / gc, 0, gnz - 1.0001);
    const jx = Math.floor(fx);
    const jz = Math.floor(fz);
    const u = fx - jx;
    const v = fz - jz;
    const i = jz * gnx + jx;
    return lerp(lerp(a[i], a[i + 1], u), lerp(a[i + gnx], a[i + gnx + 1], u), v);
  };

  // ---- mountain ring ----
  const midX = (bx0 + bx1) / 2;
  const midZ = (bz0 + bz1) / 2;
  const sunAz = RENDER.sunAzimuth * DEG;
  /** Ring weight: rises with distance from the track, lowered toward the sun so it stays in view. */
  const ringOf = (x: number, z: number, d: number): number => {
    const ring = smoothstep(T.ringStart, T.ringFull, d);
    if (ring <= 0) return 0;
    let da = Math.atan2(x - midX, -(z - midZ)) - sunAz;
    da = Math.abs(Math.atan2(Math.sin(da), Math.cos(da))) / DEG;
    return ring * lerp(T.sunGapHeight, 1, smoothstep(T.sunGapInner, T.sunGapOuter, da));
  };

  const ravines = T.ravines.map((rv) => {
    const f = frameAt(track, rv.s);
    return { ...rv, x: f.x, z: f.z, tx: f.tx, tz: f.tz, lx: f.lx, lz: f.lz };
  });

  /** Set once the lake is known: how much of the mountain ring's height stands at a point (the ring climbs
   *  away from the lake's far shores instead of dropping into the water as one wall). */
  let shoreRise: (x: number, z: number) => number = () => 1;

  /** Natural ground height before the road and the lake shape it. */
  const natural = (x: number, z: number): number => {
    const base = guide(gBase, x, z);
    const d = guide(gDist, x, z);
    const hillAmp = lerp(T.hillAmpNear, T.hillAmpFar, smoothstep(T.hillNear, T.hillFar, d));
    let h = base + (fbm(x / T.hillWavelength, z / T.hillWavelength, 4, seed + 11) - 0.5) * 2 * hillAmp;
    h += (vnoise(x / T.bumpWavelength, z / T.bumpWavelength, seed + 23) - 0.5) * 2 * T.bumpAmp;
    // Ravines: stream valleys cut straight down the fall line through chosen points of the track. The
    // conform step leaves them open under the road, which then spans them on piers.
    for (const rv of ravines) {
      const dx = x - rv.x;
      const dz = z - rv.z;
      const lat = dx * rv.lx + dz * rv.lz;
      const reach = 1 - smoothstep(rv.reach * 0.5, rv.reach, Math.abs(lat));
      if (reach <= 0) continue;
      const wander = (vnoise(lat / 90, rv.s, seed + 29) - 0.5) * 2 * T.ravineWander * smoothstep(15, 60, Math.abs(lat));
      const along = Math.abs(dx * rv.tx + dz * rv.tz + wander);
      h -= rv.depth * reach * (1 - smoothstep(rv.halfWidth * 0.3, rv.halfWidth, along));
    }
    const ring = ringOf(x, z, d);
    if (ring > 0) {
      const wx = x + (vnoise(x * 0.004 + 3.1, z * 0.004 + 8.3, seed + 31) - 0.5) * 2 * T.warp;
      const wz = z + (vnoise(x * 0.004 - 5.2, z * 0.004 + 1.7, seed + 37) - 0.5) * 2 * T.warp;
      const rid = ridged(wx / T.ridgeWavelength, wz / T.ridgeWavelength, 5, seed + 41);
      const roll = fbm(x / 900, z / 900, 3, seed + 43);
      let m = ring * (T.ringBase + T.ringRoll * roll) + ring * ring * T.peakHeight * rid;
      // Terraces: ledges and cliff bands, wandering in height so they do not read as contour lines.
      const off = (vnoise(x / 260 + 5, z / 260 + 9, seed + 47) - 0.5) * T.terraceStep;
      const q = (m + off) / T.terraceStep;
      const fl = Math.floor(q);
      const stepped = (fl + smoothstep(0.5, 0.95, q - fl)) * T.terraceStep - off;
      m = lerp(m, Math.max(0, stepped), T.terraceMix * smoothstep(0.1, 0.5, ring));
      h += m * shoreRise(x, z);
    }
    return h;
  };

  // ---- lake ----
  const lakeSpan = track.spans.find((sp) => sp.name === LK.segment);
  let level = -1e6;
  let lakeSide: 1 | -1 = 1;
  const lakeBox = { x0: 0, x1: 0, z0: 0, z1: 0 };
  // Coarse copy of the centreline as a polygon, to tell the outside of the circuit from the infield.
  const polyStep = 3;
  const pm = Math.ceil(n / polyStep);
  const px = new Float64Array(pm);
  const pz = new Float64Array(pm);
  for (let k = 0; k < pm; k++) {
    px[k] = track.x[k * polyStep];
    pz[k] = track.z[k * polyStep];
  }
  const insideLoop = (x: number, z: number): boolean => {
    let inside = false;
    for (let i = 0, j = pm - 1; i < pm; j = i++) {
      if (pz[i] > z !== pz[j] > z && x < ((px[j] - px[i]) * (z - pz[i])) / (pz[j] - pz[i]) + px[i]) inside = !inside;
    }
    return inside;
  };
  let lakeFrame: { x: number; z: number; tx: number; tz: number; ox: number; oz: number } | null = null;
  if (lakeSpan) {
    const sMid = (lakeSpan.s0 + lakeSpan.s1) / 2;
    const f = frameAt(track, sMid);
    lakeSide = insideLoop(f.x + f.lx * 30, f.z + f.lz * 30) ? -1 : 1;
    lakeFrame = { x: f.x, z: f.z, tx: f.tx, tz: f.tz, ox: f.lx * lakeSide, oz: f.lz * lakeSide };
    let low = Infinity;
    for (let s = lakeSpan.s0; s <= lakeSpan.s1; s += track.spacing) low = Math.min(low, frameAt(track, s).y);
    level = low - LK.levelBelowRoad;
    lakeBox.x0 = lakeBox.z0 = Infinity;
    lakeBox.x1 = lakeBox.z1 = -Infinity;
    for (const b of LK.basins) {
      // The outline can sit this far outside the plain ellipse (wobble plus the smooth union's bulge).
      const reach = 1.1 + LK.wobble;
      for (const [ka, ko] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const a = b.along + ka * b.rAlong * reach;
        const o = b.out + ko * b.rOut * reach;
        const x = f.x + f.tx * a + lakeFrame.ox * o;
        const z = f.z + f.tz * a + lakeFrame.oz * o;
        lakeBox.x0 = Math.min(lakeBox.x0, x);
        lakeBox.x1 = Math.max(lakeBox.x1, x);
        lakeBox.z0 = Math.min(lakeBox.z0, z);
        lakeBox.z1 = Math.max(lakeBox.z1, z);
      }
    }
  }
  const bed = level - LK.depth;
  /** Signed basin field: positive inside the outline, 0 on it, about −1 one basin radius outside. */
  const basinField = (x: number, z: number): number => {
    if (!lakeFrame) return -9;
    const dx = x - lakeFrame.x;
    const dz = z - lakeFrame.z;
    const along = dx * lakeFrame.tx + dz * lakeFrame.tz;
    const out = dx * lakeFrame.ox + dz * lakeFrame.oz;
    let f = -9;
    for (const b of LK.basins) {
      const qa = (along - b.along) / b.rAlong;
      const qo = (out - b.out) / b.rOut;
      // Smooth union, so two basins join in a rounded bay instead of a cusp.
      f = smax(f, 1 - Math.sqrt(qa * qa + qo * qo), 0.12);
    }
    return f + (fbm(x / 210, z / 210, 3, seed + 53) - 0.5) * 2 * LK.wobble;
  };
  /** Basin weight 0…1 from the outline alone (1 = open water), ignoring the track. */
  const basinOf = (x: number, z: number): number => {
    if (!lakeFrame || x < lakeBox.x0 || x > lakeBox.x1 || z < lakeBox.z0 || z > lakeBox.z1) return 0;
    return smoothstep(0, LK.edge, basinField(x, z));
  };
  if (lakeFrame) shoreRise = (x, z) => lerp(LK.farShoreHeight, 1, smoothstep(0, LK.farShoreRise, -basinField(x, z)));
  /** Keep natural ground clear of the water level, so no ponds appear away from the lake. */
  const dry = (h: number): number => (lakeFrame ? smax(h, level + LK.minAbove, 1.5) : h);

  // ---- far grid: natural ground and the lake's far shores ----
  for (let iz = 0; iz < far.nz; iz++) {
    for (let ix = 0; ix < far.nx; ix++) {
      const x = far.x0 + ix * big;
      const z = far.z0 + iz * big;
      let h = dry(natural(x, z));
      const basin = basinOf(x, z);
      if (basin > 0 && !insideLoop(x, z)) h = lerp(h, bed, basin);
      far.h[iz * far.nx + ix] = h;
    }
  }
  gradients(far);

  // ---- stamp the track into the fine grid: distance field and the banked road plane to conform to ----
  const count = fine.nx * fine.nz;
  const d2Min = new Float32Array(count).fill(Infinity);
  const nearI = new Int32Array(count).fill(-1);
  const wSum = new Float32Array(count);
  const cSum = new Float32Array(count);
  const R = T.stampRadius;
  const R2 = R * R;
  for (let i = 0; i < n; i++) {
    const cx = track.x[i];
    const cz = track.z[i];
    const tx = track.tx[i];
    const tz = track.tz[i];
    const lx = tz;
    const lz = -tx;
    const y = track.y[i] - T.drop;
    const grade = track.grade[i];
    const tanB = Math.tan(track.bank[i]);
    const a0 = Math.max(0, Math.ceil((cx - R - fine.x0) / cell));
    const a1 = Math.min(fine.nx - 1, Math.floor((cx + R - fine.x0) / cell));
    const b0 = Math.max(0, Math.ceil((cz - R - fine.z0) / cell));
    const b1 = Math.min(fine.nz - 1, Math.floor((cz + R - fine.z0) / cell));
    for (let b = b0; b <= b1; b++) {
      const dz = fine.z0 + b * cell - cz;
      for (let a = a0; a <= a1; a++) {
        const dx = fine.x0 + a * cell - cx;
        const d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;
        const k = b * fine.nx + a;
        if (d2 < d2Min[k]) {
          d2Min[k] = d2;
          nearI[k] = i;
        }
        const lat = clamp(dx * lx + dz * lz, -T.bankReach, T.bankReach);
        const q = d2 + 4;
        const w = 1 / (q * q * q);
        wSum[k] += w;
        cSum[k] += w * (y + grade * (dx * tx + dz * tz) - tanB * lat);
      }
    }
  }

  // ---- fine grid heights ----
  const G = WORLD.gallery;
  const gal = gallerySpec(track);
  const dist = new Float32Array(count);
  const rimW = (x: number, z: number): number => smoothstep(0, T.seamBand, Math.min(x - ix0, ix1 - x, z - iz0, iz1 - z));
  for (let iz = 0; iz < fine.nz; iz++) {
    for (let ix = 0; ix < fine.nx; ix++) {
      const k = iz * fine.nx + ix;
      const x = fine.x0 + ix * cell;
      const z = fine.z0 + iz * cell;
      const stamped = nearI[k] >= 0;
      const r = stamped ? Math.sqrt(d2Min[k]) : R;
      dist[k] = r;
      let a = dry(natural(x, z));
      if (stamped) {
        const i = nearI[k];
        const c = cSum[k] / wSum[k];
        const s = i * track.spacing;
        // Under the gallery the ground is always brought up to the road: no viaduct there.
        const inGallery = gal ? smoothstep(-40, -10, galleryDepth(track, s)) : 0;
        const f = c + (a - c) * smoothstep(T.flatDist, T.blendDist, r);
        if (a > c) a = f;
        else a += (f - a) * Math.max(inGallery, smoothstep(T.fillNone, T.fillFull, c - a));
        if (gal && inGallery > 0) {
          // The hillside the gallery shelters under: a bank against the closed wall, up to roof level.
          const lat = ((x - track.x[i]) * track.tz[i] - (z - track.z[i]) * track.tx[i]) * -gal.openSide;
          const roof = G.ceiling + G.roofThickness;
          const mound = roof * smoothstep(G.hillStart, G.hillFull, lat) * (1 - smoothstep(T.blendDist * 0.75, R * 0.95, r)) * inGallery;
          if (mound > 0) a = Math.max(a, c + mound);
        }
      }
      // The lake: outside the circuit only, with a bank that starts just beyond the wall. Everything that is
      // not lake stays clear of the water level (the inside of a banked corner can dip close to it).
      if (lakeFrame) a = Math.max(a, level + LK.minClear);
      const basin = basinOf(x, z);
      if (basin > 0) {
        let shore = 1;
        let outside: boolean;
        if (stamped) {
          const i = nearI[k];
          outside = ((x - track.x[i]) * track.tz[i] - (z - track.z[i]) * track.tx[i]) * lakeSide > 0;
          shore = smoothstep(LK.shoreStart, LK.shoreStart + LK.shoreWidth, r);
        } else outside = !insideLoop(x, z);
        if (outside) a = lerp(a, bed, basin * shore);
      }
      // Ease onto the far grid's surface along the rim so the two meshes meet exactly.
      const w = rimW(x, z);
      if (w < 1) a = lerp(sampleGrid(far, far.h, x, z), a, w);
      fine.h[k] = a;
    }
  }
  gradients(fine);
  for (let iz = 0; iz < fine.nz; iz++) {
    for (let ix = 0; ix < fine.nx; ix++) {
      const x = fine.x0 + ix * cell;
      const z = fine.z0 + iz * cell;
      const w = rimW(x, z);
      if (w >= 1) continue;
      const k = iz * fine.nx + ix;
      fine.gx[k] = lerp(sampleGrid(far, far.gx, x, z), fine.gx[k], w);
      fine.gz[k] = lerp(sampleGrid(far, far.gz, x, z), fine.gz[k], w);
    }
  }

  const inFine = (x: number, z: number): boolean => x >= ix0 && x <= ix1 && z >= iz0 && z <= iz1;
  const hf: Heightfield = {
    fine,
    far,
    dist,
    lake: { present: lakeFrame !== null, level, side: lakeSide, ...lakeBox },
    heightAt: (x, z) => (inFine(x, z) ? sampleGrid(fine, fine.h, x, z) : sampleGrid(far, far.h, x, z)),
    gradientAt: (x, z, out) => {
      const g = inFine(x, z) ? fine : far;
      out[0] = sampleGrid(g, g.gx, x, z);
      out[1] = sampleGrid(g, g.gz, x, z);
      return out;
    },
    trackDistAt: (x, z) => {
      if (inFine(x, z)) {
        const d = sampleGrid(fine, dist, x, z);
        if (d < R * 0.97) return d;
      }
      return Math.max(R * 0.97, guide(gDist, x, z));
    },
    ringAt: (x, z) => ringOf(x, z, guide(gDist, x, z)),
    lakeAt: (x, z) => {
      const basin = basinOf(x, z);
      return basin > 0 && !insideLoop(x, z) ? basin : 0;
    },
    buildMs: 0,
  };
  hf.buildMs = performance.now() - t0;
  return hf;
}

/** Lowest and highest vertex of a grid, metres. */
export function heightRange(g: Grid): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < g.h.length; i++) {
    lo = Math.min(lo, g.h[i]);
    hi = Math.max(hi, g.h[i]);
  }
  return [lo, hi];
}
