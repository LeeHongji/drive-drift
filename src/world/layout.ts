// Trackside layout rules that need only the centreline: where the snow gallery is, and where banners, chevron
// boards, lamps and marker posts go. Pure logic (no engine imports), covered by tests/world.test.ts.

import { RENDER } from '../config/render';
import { WORLD } from '../config/world';
import { DEG, mod, smoothstep } from '../core/math';
import { arcDelta, findCorners, frameAt, type Track } from '../track/track';

export interface GallerySpec {
  /** Arc-length range covered by the roof, metres (s0 < s1, no wrap). */
  s0: number;
  s1: number;
  /** +1 = arched openings on the left of the driving direction, −1 = on the right. */
  openSide: 1 | -1;
  /** Number of bays (pier + opening) and the exact length of one, metres. */
  bays: number;
  bayLength: number;
}

const galleryCache = new WeakMap<Track, GallerySpec | null>();

/** The snow gallery on this track, or null when the layout has no gallery segment (test ovals). */
export function gallerySpec(track: Track): GallerySpec | null {
  let spec = galleryCache.get(track);
  if (spec !== undefined) return spec;
  const G = WORLD.gallery;
  const span = track.spans.find((sp) => sp.name === G.segment);
  if (!span) spec = null;
  else {
    const bays = Math.max(1, Math.round((span.s1 - span.s0) / G.bayLength));
    let openSide: 1 | -1 = G.openSide === 'left' ? 1 : -1;
    if (G.openSide === 'auto') {
      // Horizontal direction toward the sun (azimuth 0 = −Z, clockwise seen from above).
      const az = RENDER.sunAzimuth * DEG;
      const f = frameAt(track, (span.s0 + span.s1) / 2);
      openSide = f.lx * Math.sin(az) - f.lz * Math.cos(az) >= 0 ? 1 : -1;
    }
    spec = { s0: span.s0, s1: span.s1, openSide, bays, bayLength: (span.s1 - span.s0) / bays };
  }
  galleryCache.set(track, spec);
  return spec;
}

/** Arc-length range of the snow gallery, or null when the track has none. */
export function galleryRange(track: Track): { s0: number; s1: number } | null {
  const g = gallerySpec(track);
  return g ? { s0: g.s0, s1: g.s1 } : null;
}

/** How far arc length `s` is inside the gallery: positive inside, negative outside, metres from the nearer portal. */
export function galleryDepth(track: Track, s: number): number {
  const g = gallerySpec(track);
  if (!g) return -Infinity;
  const half = (g.s1 - g.s0) / 2;
  return half - Math.abs(arcDelta(track, mod(s, track.length), (g.s0 + g.s1) / 2));
}

/**
 * 0 outside the snow gallery, 1 inside, ramping over WORLD.gallery.portalBlend metres centred on each portal.
 * Drives everything that changes under the roof (exposure, headlights, reverb, droplets).
 */
export function tunnelFactor(track: Track, s: number): number {
  const half = WORLD.gallery.portalBlend / 2;
  return smoothstep(-half, half, galleryDepth(track, s));
}

export interface SideSpot {
  /** Arc length, metres. */
  s: number;
  /** +1 = left wall, −1 = right wall. */
  side: 1 | -1;
}

/** `>>` boards: on the outside wall wherever the corner is tighter than TRACK.chevronRadius, not in the gallery. */
export function placeChevrons(track: Track): SideSpot[] {
  const C = WORLD.chevrons;
  const out: SideSpot[] = [];
  const k0 = 1 / track.config.chevronRadius;
  for (let s = 0; s < track.length - C.spacing / 2; s += C.spacing) {
    const curv = frameAt(track, s).curv;
    if (Math.abs(curv) <= k0) continue;
    if (galleryDepth(track, s) > -C.width) continue;
    out.push({ s, side: curv > 0 ? -1 : 1 });
  }
  return out;
}

/** Lamp posts at a fixed spacing, alternating sides, none under the gallery roof or at the start gantry. */
export function placeLamps(track: Track): SideSpot[] {
  const L = WORLD.lamps;
  const out: SideSpot[] = [];
  // Offset so lamps fall between chevron boards (their spacing divides ours) and clear of the gantry.
  const offset = 20;
  let k = 0;
  for (let s = offset; s < track.length - L.spacing / 2; s += L.spacing, k++) {
    if (galleryDepth(track, s) > -10) continue;
    if (Math.abs(arcDelta(track, s, track.config.finishS)) < 6) continue;
    out.push({ s, side: k % 2 ? 1 : -1 });
  }
  return out;
}

/** Marker posts on both wall tops every WORLD.posts.spacing metres, nudged clear of boards, lamps and the gallery. */
export function placePosts(track: Track, chevrons: SideSpot[], lamps: SideSpot[]): SideSpot[] {
  const P = WORLD.posts;
  const out: SideSpot[] = [];
  const clash = (s: number, side: number): boolean =>
    galleryDepth(track, s) > -2 ||
    Math.abs(arcDelta(track, s, track.config.finishS)) < 4 ||
    chevrons.some((c) => c.side === side && Math.abs(arcDelta(track, c.s, s)) < WORLD.chevrons.width / 2 + 1) ||
    lamps.some((l) => l.side === side && Math.abs(arcDelta(track, l.s, s)) < 1.5);
  for (let s0 = P.spacing / 2; s0 < track.length - P.spacing / 4; s0 += P.spacing) {
    for (const side of [1, -1] as const) {
      let s = s0;
      for (let tries = 0; tries < 6 && clash(s, side); tries++) s += 4;
      if (!clash(s, side)) out.push({ s, side });
    }
  }
  return out;
}

export interface BannerRange {
  /** Arc-length range, metres. s1 may exceed track.length when the range wraps past the first sample. */
  s0: number;
  s1: number;
}

/** Sponsor banners cover both walls through every corner plus a lead-in/out, snapped to whole boards. */
export function bannerRanges(track: Track): BannerRange[] {
  const B = WORLD.banners;
  const ranges = findCorners(track, B.cornerRadius)
    .map((c) => ({
      s0: Math.floor((c.s0 - B.lead) / B.boardLength) * B.boardLength,
      s1: Math.ceil((c.s1 + B.lead) / B.boardLength) * B.boardLength,
    }))
    .sort((a, b) => a.s0 - b.s0);
  const out: BannerRange[] = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && r.s0 <= last.s1) last.s1 = Math.max(last.s1, r.s1);
    else out.push({ ...r });
  }
  // A range that starts before 0 or runs past the end wraps; never let the total exceed one lap.
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (last.s1 - track.length >= first.s0) {
      last.s1 = first.s1 + track.length;
      out.shift();
    }
  }
  for (const r of out) r.s1 = Math.min(r.s1, r.s0 + track.length);
  return out;
}

/** Lateral offset of things that stand on top of a wall (its centre line), metres from the centreline. */
export function wallTopOffset(track: Track): number {
  return track.wallOffset + track.config.wallThickness / 2;
}
