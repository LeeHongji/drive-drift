// Placement that depends on the ground: trees and viaduct piers. Pure logic (no engine imports); every
// random choice comes from one seeded stream, so a given TRACK.seed always grows the same forest.

import { WORLD } from '../config/world';
import { Rng } from '../core/rng';
import { frameAt, type Track } from '../track/track';
import { galleryDepth } from './layout';
import type { Heightfield } from './heightfield';
import { vnoise } from './noise';

/** Tree species index: 0 spruce, 1 golden larch, 2 broadleaf. */
export const TREE_SPECIES = 3;

export interface TreeSpot {
  x: number;
  y: number;
  z: number;
  /** Rotation about Y, radians. */
  yaw: number;
  /** Uniform scale, and an extra factor on height only. */
  scale: number;
  tall: number;
  species: number;
}

/** Clusters of trees on both sides of the track: off the road, out of the lake, not on cliffs. */
export function placeTrees(track: Track, hf: Heightfield): TreeSpot[] {
  const T = WORLD.trees;
  const seed = track.config.seed | 0;
  const rng = new Rng(seed ^ 0x51ee7);
  const grad: [number, number] = [0, 0];
  const out: TreeSpot[] = [];
  const minY = hf.lake.present ? hf.lake.level + T.minAboveLake : -Infinity;
  for (let s = 0; s < track.length - T.clusterSpacing / 2; s += T.clusterSpacing) {
    for (const side of [-1, 1]) {
      // Draw every number for the slot whether or not it is used, so one rejected tree never shifts the rest.
      const used = rng.next() < T.fill;
      const lat = T.latMin + Math.pow(rng.next(), 1.4) * (T.latMax - T.latMin);
      const count = 1 + Math.floor(rng.next() * rng.next() * T.clusterMax);
      const centre = frameAt(track, s + rng.range(-0.5, 0.5) * T.clusterSpacing, side * lat);
      const cluster = rng.fork();
      if (!used) continue;
      for (let k = 0; k < count; k++) {
        const ang = cluster.next() * Math.PI * 2;
        const rad = Math.sqrt(cluster.next()) * (5 + 3 * count);
        const x = centre.x + Math.cos(ang) * rad;
        const z = centre.z + Math.sin(ang) * rad;
        const yaw = cluster.next() * Math.PI * 2;
        const scale = cluster.range(T.scaleMin, T.scaleMax);
        const tall = 1 + cluster.range(-T.heightJitter, T.heightJitter);
        const pick = cluster.next();
        if (hf.trackDistAt(x, z) < T.minTrackDist) continue;
        const y = hf.heightAt(x, z);
        if (y < minY) continue;
        hf.gradientAt(x, z, grad);
        if (Math.hypot(grad[0], grad[1]) > T.maxSlope) continue;
        if (out.some((o) => (o.x - x) * (o.x - x) + (o.z - z) * (o.z - z) < T.minSpacing * T.minSpacing)) continue;
        // Broadleaves keep to the low ground by the lake; larches gather in golden stands among the spruce.
        const low = hf.lake.present ? y - hf.lake.level : 100;
        const stand = vnoise(x / 130, z / 130, seed + 83);
        const species = low < 9 + stand * 10 && pick < 0.75 ? 2 : pick < 0.15 + stand * 0.55 ? 1 : 0;
        out.push({ x, y: y - T.sink, z, yaw, scale, tall, species });
      }
    }
  }
  // Over budget: drop trees evenly along the lap rather than cutting off its end.
  if (out.length > T.maxCount) {
    const keep: TreeSpot[] = [];
    for (let k = 0; k < T.maxCount; k++) keep.push(out[Math.floor((k * out.length) / T.maxCount)]);
    return keep;
  }
  return out;
}

export interface PierSpot {
  /** Arc length of the pier, metres. */
  s: number;
  /** How far below the road plane the columns' feet are (already includes the buried part), metres. */
  foot: number;
}

/** Piers wherever the road is well above the ground under it (checked every WORLD.piers.spacing metres). */
export function placePiers(track: Track, hf: Heightfield): PierSpot[] {
  const P = WORLD.piers;
  const out: PierSpot[] = [];
  for (let s = P.spacing / 2; s < track.length - P.spacing / 2; s += P.spacing) {
    if (galleryDepth(track, s) > -P.spacing) continue;
    const c = frameAt(track, s);
    if (c.y - hf.heightAt(c.x, c.z) <= P.minGap) continue;
    let foot = 0;
    for (const d of [-P.columnOffset, P.columnOffset]) {
      const f = frameAt(track, s, d);
      foot = Math.max(foot, c.y - hf.heightAt(f.x, f.z));
    }
    out.push({ s, foot: foot + P.bury });
  }
  return out;
}
