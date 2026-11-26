// Centreline generation and track queries. Pure logic: no engine imports, covered by unit tests.
//
// Pipeline: segment list (straights + arcs) → solve two straight lengths so the loop closes → dense polyline →
// closed box-filter smoothing (eases straight↔arc joints) → resample to uniform arc length → per-sample frames.
//
// Conventions: Y up. Yaw ψ is a rotation about +Y, forward = (−sin ψ, 0, −cos ψ), so a left turn increases ψ.
// Lateral offset d is positive to the LEFT of the driving direction. Curvature κ = dψ/ds (left turn positive).

import { clamp, DEG, lerp, mod, wrapAngle } from '../core/math';
import type { TrackConfig, TrackSegment } from '../config/track';

export interface SegmentSpan {
  name: string;
  kind: 'straight' | 'arc';
  /** Signed design radius: + left, − right, 0 for straights. */
  radius: number;
  /** Arc length range on the final centreline, metres. */
  s0: number;
  s1: number;
}

export interface TrackLocation {
  /** Sample index of the segment start, and fraction 0..1 toward the next sample. */
  i: number;
  f: number;
  /** Arc length along the centreline, metres, in [0, length). */
  s: number;
  /** Horizontal lateral offset from the centreline, metres, + = left. */
  d: number;
  /** Road surface height under the query point (banked plane), metres. */
  y: number;
  /** Horizontal unit tangent (driving direction). */
  tx: number;
  tz: number;
  /** Horizontal unit vector pointing left. */
  lx: number;
  lz: number;
  /** Smoothed signed curvature, 1/m. */
  curv: number;
  /** Bank angle, radians, + lowers the left side (inside of a left turn). */
  bank: number;
  /** Road grade dy/ds. */
  grade: number;
}

export interface Track {
  readonly n: number;
  /** Exact spacing between samples, metres. */
  readonly spacing: number;
  readonly length: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  /** Yaw of the driving direction at each sample (unwrapped is not guaranteed; use only through cos/sin). */
  readonly yaw: Float64Array;
  readonly tx: Float64Array;
  readonly tz: Float64Array;
  readonly grade: Float64Array;
  readonly curv: Float64Array;
  readonly bank: Float64Array;
  readonly spans: SegmentSpan[];
  readonly config: TrackConfig;
  /** Half-width of the drivable corridor including kerbs (distance from centreline to the wall face). */
  readonly wallOffset: number;
}

interface RawPath {
  x: number[];
  z: number[];
  rise: number[];
  /** Raw arc length at which each segment ends. */
  ends: number[];
}

const RAW_STEP = 1; // metres between raw turtle samples

function headingVec(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

/** Displacement of each segment in the frame where the first segment starts at the origin with yaw 0. */
function segmentDelta(seg: TrackSegment, yaw: number): { dx: number; dz: number; yaw: number } {
  if (seg.kind === 'straight') {
    const [fx, fz] = headingVec(yaw);
    return { dx: fx * seg.length, dz: fz * seg.length, yaw };
  }
  const turn = (seg.dir === 'left' ? 1 : -1) * seg.angle * DEG;
  const [fx, fz] = headingVec(yaw);
  // Left of forward is (fz, −fx); the arc centre sits `radius` to the turning side.
  const side = seg.dir === 'left' ? 1 : -1;
  const cx = fz * side * seg.radius;
  const cz = -fx * side * seg.radius;
  const [gx, gz] = headingVec(yaw + turn);
  return { dx: cx - gz * side * seg.radius, dz: cz + gx * side * seg.radius, yaw: yaw + turn };
}

/** Solve the two `solve` straights so the turtle returns to its start. Returns a copy of the segment list. */
export function closeLayout(segments: TrackSegment[]): TrackSegment[] {
  const free = segments.map((s, i) => (s.kind === 'straight' && s.solve ? i : -1)).filter((i) => i >= 0);
  if (free.length !== 2) throw new Error(`track: expected exactly 2 straights with solve:true, got ${free.length}`);
  let total = 0;
  for (const s of segments) if (s.kind === 'arc') total += (s.dir === 'left' ? 1 : -1) * s.angle;
  if (Math.abs(Math.abs(total) - 360) > 1e-6) throw new Error(`track: arcs turn ${total}°, need ±360°`);

  let yaw = 0;
  let ex = 0;
  let ez = 0;
  const dirs: [number, number][] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (free.includes(i)) {
      dirs.push(headingVec(yaw));
      continue;
    }
    const d = segmentDelta(seg, yaw);
    ex += d.dx;
    ez += d.dz;
    yaw = d.yaw;
  }
  // a·dirs[0] + b·dirs[1] = −(ex, ez)
  const [[ax, az], [bx, bz]] = dirs;
  const det = ax * bz - az * bx;
  if (Math.abs(det) < 1e-3) throw new Error('track: the two solved straights are parallel');
  const a = (-ex * bz + ez * bx) / det;
  const b = (-ax * ez + az * ex) / det;
  if (a < 10 || b < 10) throw new Error(`track: closure needs straight lengths ${a.toFixed(1)} m and ${b.toFixed(1)} m`);
  return segments.map((s, i) => (i === free[0] ? { ...s, length: a } : i === free[1] ? { ...s, length: b } : s));
}

function tracePath(segments: TrackSegment[]): RawPath {
  const path: RawPath = { x: [], z: [], rise: [], ends: [] };
  let x = 0;
  let z = 0;
  let yaw = 0;
  let h = 0;
  let sTotal = 0;
  for (const seg of segments) {
    const len = seg.kind === 'straight' ? seg.length : seg.radius * seg.angle * DEG;
    const steps = Math.max(1, Math.round(len / RAW_STEP));
    const rise = seg.rise ?? 0;
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      let px: number;
      let pz: number;
      if (seg.kind === 'straight') {
        const [fx, fz] = headingVec(yaw);
        px = x + fx * len * t;
        pz = z + fz * len * t;
      } else {
        const d = segmentDelta({ ...seg, angle: seg.angle * t }, yaw);
        px = x + d.dx;
        pz = z + d.dz;
      }
      path.x.push(px);
      path.z.push(pz);
      path.rise.push(h + rise * t);
    }
    const d = segmentDelta(seg, yaw);
    x += d.dx;
    z += d.dz;
    yaw = d.yaw;
    h += rise;
    sTotal += len;
    path.ends.push(sTotal);
  }
  if (Math.hypot(x, z) > 0.01) throw new Error(`track: loop does not close (gap ${Math.hypot(x, z).toFixed(3)} m)`);
  if (Math.abs(h) > 0.01) throw new Error(`track: height does not close (net rise ${h.toFixed(2)} m)`);
  return path;
}

/** In-place closed box filter with half-width `w` samples, repeated `passes` times (≈ Gaussian). */
function smoothClosed(a: Float64Array, w: number, passes: number): void {
  const n = a.length;
  if (w < 1) return;
  const tmp = new Float64Array(n);
  for (let p = 0; p < passes; p++) {
    let sum = 0;
    for (let k = -w; k <= w; k++) sum += a[mod(k, n)];
    for (let i = 0; i < n; i++) {
      tmp[i] = sum / (2 * w + 1);
      sum += a[mod(i + w + 1, n)] - a[mod(i - w, n)];
    }
    a.set(tmp);
  }
}

export function buildTrack(config: TrackConfig): Track {
  const segments = closeLayout(config.segments);
  const raw = tracePath(segments);
  const rx = Float64Array.from(raw.x);
  const rz = Float64Array.from(raw.z);
  const rh = Float64Array.from(raw.rise);
  smoothClosed(rx, Math.round(config.planSmoothing / RAW_STEP), 3);
  smoothClosed(rz, Math.round(config.planSmoothing / RAW_STEP), 3);
  smoothClosed(rh, Math.round(config.heightSmoothing / RAW_STEP), 3);
  for (let i = 0; i < rh.length; i++) rh[i] += config.baseHeight;

  const track = trackFromPolyline(rx, rh, rz, config);
  // Map raw segment ends onto the final arc length. Smoothing changes the length by well under 1 %, so a
  // proportional mapping is accurate to a couple of metres, which is enough for labels and prop ranges.
  const rawTotal = raw.ends[raw.ends.length - 1];
  segments.forEach((sg, k) => {
    track.spans.push({
      name: sg.name,
      kind: sg.kind,
      radius: sg.kind === 'arc' ? (sg.dir === 'left' ? 1 : -1) * sg.radius : 0,
      s0: ((k === 0 ? 0 : raw.ends[k - 1]) / rawTotal) * track.length,
      s1: (raw.ends[k] / rawTotal) * track.length,
    });
  });
  return track;
}

/**
 * Build a track from any dense closed polyline (x, y, z per point, first point not repeated at the end).
 * `buildTrack` uses it for the segment-list circuit; tests use it for other centrelines.
 */
export function trackFromPolyline(rx: ArrayLike<number>, ry: ArrayLike<number>, rz: ArrayLike<number>, config: TrackConfig): Track {
  const m = rx.length;
  // Cumulative horizontal arc length of the polyline (closed).
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    cum[i + 1] = cum[i] + Math.hypot(rx[j] - rx[i], rz[j] - rz[i]);
  }
  const length = cum[m];
  const n = Math.round(length / config.sampleSpacing);
  const spacing = length / n;

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const z = new Float64Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const s = i * spacing;
    while (seg < m - 1 && cum[seg + 1] < s) seg++;
    const f = (s - cum[seg]) / (cum[seg + 1] - cum[seg]);
    const j = (seg + 1) % m;
    x[i] = lerp(rx[seg], rx[j], f);
    z[i] = lerp(rz[seg], rz[j], f);
    y[i] = lerp(ry[seg], ry[j], f);
  }

  const tx = new Float64Array(n);
  const tz = new Float64Array(n);
  const yaw = new Float64Array(n);
  const grade = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = mod(i - 1, n);
    const b = (i + 1) % n;
    const dx = x[b] - x[a];
    const dz = z[b] - z[a];
    const len = Math.hypot(dx, dz);
    tx[i] = dx / len;
    tz[i] = dz / len;
    yaw[i] = Math.atan2(-tx[i], -tz[i]);
    grade[i] = (y[b] - y[a]) / len;
  }

  const curv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    curv[i] = wrapAngle(yaw[(i + 1) % n] - yaw[mod(i - 1, n)]) / (2 * spacing);
  }
  smoothClosed(curv, config.curvatureSmoothing, 1);
  const bank = new Float64Array(n);
  for (let i = 0; i < n; i++) bank[i] = clamp(curv[i] * config.bankGain, -config.bankMax, config.bankMax);

  return {
    n, spacing, length, x, y, z, yaw, tx, tz, grade, curv, bank,
    spans: [],
    config,
    wallOffset: config.halfWidth + config.kerbWidth,
  };
}

export interface Corner {
  /** Arc length where the corner starts and ends, metres (s1 may exceed track.length when it wraps). */
  s0: number;
  s1: number;
  /** +1 = left, −1 = right. */
  dir: number;
  /** Tightest radius inside the corner, metres. */
  radius: number;
  /** Total heading change, radians (positive). */
  angle: number;
}

/**
 * Corners found from the smoothed curvature: runs where the radius stays under `maxRadius`.
 * Runs closer than `joinGap` metres and turning the same way are merged; turns under `minAngle` are dropped.
 */
export function findCorners(t: Track, maxRadius = 260, joinGap = 20, minAngle = 0.35): Corner[] {
  const k0 = 1 / maxRadius;
  // Start scanning on a straight so no corner is split by the array wrap.
  let start = 0;
  for (let i = 0; i < t.n; i++) {
    if (Math.abs(t.curv[i]) < k0 * 0.5) {
      start = i;
      break;
    }
  }
  const out: Corner[] = [];
  let cur: Corner | null = null;
  for (let k = 0; k <= t.n; k++) {
    const i = (start + k) % t.n;
    const c = t.curv[i];
    const s = (start + k) * t.spacing;
    const inside = k < t.n && Math.abs(c) > k0;
    if (inside && cur && Math.sign(c) !== cur.dir) {
      out.push(cur);
      cur = null;
    }
    if (inside) {
      cur ??= { s0: s, s1: s, dir: Math.sign(c), radius: Infinity, angle: 0 };
      cur.s1 = s + t.spacing;
      cur.radius = Math.min(cur.radius, 1 / Math.abs(c));
      cur.angle += Math.abs(c) * t.spacing;
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  const merged: Corner[] = [];
  for (const c of out) {
    const last = merged[merged.length - 1];
    if (last && last.dir === c.dir && c.s0 - last.s1 < joinGap) {
      last.s1 = c.s1;
      last.radius = Math.min(last.radius, c.radius);
      last.angle += c.angle;
    } else merged.push({ ...c });
  }
  return merged.filter((c) => c.angle >= minAngle);
}

/** A fresh location object for `project` to fill. */
export function makeLocation(): TrackLocation {
  return { i: 0, f: 0, s: 0, d: 0, y: 0, tx: 0, tz: -1, lx: -1, lz: 0, curv: 0, bank: 0, grade: 0 };
}

const WINDOW_BACK = 8;
const WINDOW_FWD = 16;
const LOST_DISTANCE = 30;

/** Fraction along the segment of the closest point, written by `distToSegmentSq`. It lives in a typed array
 *  (not a return tuple, not a `let`) so the search below allocates nothing. */
const SEG_F = new Float64Array(1);

/** Squared distance from (px, pz) to segment i → i + 1; the closest point's fraction goes to `SEG_F[0]`. */
function distToSegmentSq(t: Track, i: number, px: number, pz: number): number {
  const j = (i + 1) % t.n;
  const ax = t.x[i];
  const az = t.z[i];
  const sx = t.x[j] - ax;
  const sz = t.z[j] - az;
  const f = clamp(((px - ax) * sx + (pz - az) * sz) / (sx * sx + sz * sz), 0, 1);
  const ex = px - (ax + sx * f);
  const ez = pz - (az + sz * f);
  SEG_F[0] = f;
  return ex * ex + ez * ez;
}

/**
 * Project a world point onto the centreline. `out.i` is used as the search hint and is updated in place, so
 * each moving object (car, each wheel, camera) should keep its own location object.
 * Pass `global = true` to ignore the hint (spawning, teleporting).
 */
export function project(t: Track, px: number, pz: number, out: TrackLocation, global = false): TrackLocation {
  let best = -1;
  let bestD = Infinity;
  let bestF = 0;
  if (!global) {
    for (let k = -WINDOW_BACK; k < WINDOW_FWD; k++) {
      const i = mod(out.i + k, t.n);
      const d2 = distToSegmentSq(t, i, px, pz);
      if (d2 < bestD) {
        bestD = d2;
        best = i;
        bestF = SEG_F[0];
      }
    }
  }
  if (global || bestD > LOST_DISTANCE * LOST_DISTANCE) {
    bestD = Infinity;
    for (let i = 0; i < t.n; i++) {
      const d2 = distToSegmentSq(t, i, px, pz);
      if (d2 < bestD) {
        bestD = d2;
        best = i;
        bestF = SEG_F[0];
      }
    }
  }
  const i = best;
  const j = (i + 1) % t.n;
  const f = bestF;
  // Interpolate the tangent so d and the frame are continuous across samples.
  let tx = lerp(t.tx[i], t.tx[j], f);
  let tz = lerp(t.tz[i], t.tz[j], f);
  const tl = Math.sqrt(tx * tx + tz * tz);
  tx /= tl;
  tz /= tl;
  const lx = tz;
  const lz = -tx;
  const cx = lerp(t.x[i], t.x[j], f);
  const cz = lerp(t.z[i], t.z[j], f);
  const bank = lerp(t.bank[i], t.bank[j], f);
  const d = (px - cx) * lx + (pz - cz) * lz;
  out.i = i;
  out.f = f;
  out.s = (i + f) * t.spacing;
  out.d = d;
  out.y = lerp(t.y[i], t.y[j], f) - d * Math.tan(bank);
  out.tx = tx;
  out.tz = tz;
  out.lx = lx;
  out.lz = lz;
  out.curv = lerp(t.curv[i], t.curv[j], f);
  out.bank = bank;
  out.grade = lerp(t.grade[i], t.grade[j], f);
  return out;
}

export interface TrackFrame {
  x: number;
  y: number;
  z: number;
  /** Horizontal unit tangent. */
  tx: number;
  tz: number;
  /** Horizontal unit left vector. */
  lx: number;
  lz: number;
  yaw: number;
  bank: number;
  grade: number;
  curv: number;
}

/** Centreline frame at arc length `s` (wraps), offset `d` metres to the left along the banked surface. */
export function frameAt(t: Track, s: number, d = 0, out?: TrackFrame): TrackFrame {
  const u = mod(s, t.length) / t.spacing;
  const i = Math.floor(u) % t.n;
  const j = (i + 1) % t.n;
  const f = u - Math.floor(u);
  let tx = lerp(t.tx[i], t.tx[j], f);
  let tz = lerp(t.tz[i], t.tz[j], f);
  const tl = Math.sqrt(tx * tx + tz * tz);
  tx /= tl;
  tz /= tl;
  const lx = tz;
  const lz = -tx;
  const bank = lerp(t.bank[i], t.bank[j], f);
  // Per-frame callers pass `out` so the lookup allocates nothing.
  const r = out ?? ({} as TrackFrame);
  r.x = lerp(t.x[i], t.x[j], f) + lx * d;
  r.y = lerp(t.y[i], t.y[j], f) - d * Math.tan(bank);
  r.z = lerp(t.z[i], t.z[j], f) + lz * d;
  r.tx = tx;
  r.tz = tz;
  r.lx = lx;
  r.lz = lz;
  r.yaw = Math.atan2(-tx, -tz);
  r.bank = bank;
  r.grade = lerp(t.grade[i], t.grade[j], f);
  r.curv = lerp(t.curv[i], t.curv[j], f);
  return r;
}

/** Smoothed curvature at arc length `s` (wraps). Cheaper than `frameAt` when only the curvature is needed. */
export function curvatureAt(t: Track, s: number): number {
  const u = mod(s, t.length) / t.spacing;
  const i = Math.floor(u) % t.n;
  return lerp(t.curv[i], t.curv[(i + 1) % t.n], u - Math.floor(u));
}

/** A blank frame for use as `frameAt`'s `out`. */
export function makeFrame(): TrackFrame {
  return { x: 0, y: 0, z: 0, tx: 0, tz: -1, lx: -1, lz: 0, yaw: 0, bank: 0, grade: 0, curv: 0 };
}

/** Signed shortest arc-length difference a − b on the closed track, in (−length/2, length/2]. */
export function arcDelta(t: Track, a: number, b: number): number {
  let d = mod(a - b, t.length);
  if (d > t.length / 2) d -= t.length;
  return d;
}
