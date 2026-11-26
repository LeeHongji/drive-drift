// Ground colours per terrain vertex: meadow, forest, dolomite rock, scree, snow, the gravel verge beside the
// road and the lake shore. Pure logic (no engine imports) so the result can be inspected from Node.

import { WORLD } from '../config/world';
import { lerp, smoothstep } from '../core/math';
import type { Track } from '../track/track';
import type { Grid, Heightfield } from './heightfield';
import { fbm, vnoise } from './noise';

type Rgb = [number, number, number];

function mix(out: Rgb, c: Rgb, w: number): void {
  out[0] += (c[0] - out[0]) * w;
  out[1] += (c[1] - out[1]) * w;
  out[2] += (c[2] - out[2]) * w;
}

/** Linear colour of the ground at a vertex, written to `out`. `r` is the distance to the centreline. */
export function groundColor(hf: Heightfield, seed: number, x: number, y: number, z: number, gx: number, gz: number, r: number, out: Rgb): Rgb {
  const P = WORLD.palette;
  const Z = WORLD.zones;
  const rel = y - (hf.lake.present ? hf.lake.level : 0);
  const slope = 1 - 1 / Math.sqrt(1 + gx * gx + gz * gz);
  const broad = fbm(x / 190, z / 190, 2, seed + 61);
  const fine = vnoise(x / 17, z / 17, seed + 67);
  const ring = hf.ringAt(x, z);

  // Meadow, drier in patches.
  const dry = smoothstep(0.4, 0.7, broad * 0.75 + fine * 0.25);
  out[0] = lerp(P.meadowLush[0], P.meadowDry[0], dry);
  out[1] = lerp(P.meadowLush[1], P.meadowDry[1], dry);
  out[2] = lerp(P.meadowLush[2], P.meadowDry[2], dry);

  // Foothill forest up to the treeline, alpine turf above it.
  const line = rel + (broad - 0.5) * 70;
  const above = smoothstep(Z.treeline - Z.treelineBlend / 2, Z.treeline + Z.treelineBlend / 2, line);
  const forest = smoothstep(0.03, 0.14, ring + (fine - 0.5) * 0.04) * (1 - above);
  mix(out, P.alpine, above);
  mix(out, P.forest, forest);

  // Bare earth where the ground has been cut into a bank, then rock on anything steep.
  mix(out, P.earth, smoothstep(Z.rockSlope0 * 0.45, Z.rockSlope0, slope) * (1 - forest) * 0.7);
  const rock = smoothstep(Z.rockSlope0, Z.rockSlope1, slope + (fine - 0.5) * 0.06 - forest * 0.07);
  if (rock > 0) {
    // Strata: bands that follow height, bent by the broad noise.
    const strata = smoothstep(0.35, 0.65, vnoise(y / 11 + broad * 4, x / 400, seed + 71));
    mix(out, [lerp(P.rock[0], P.rockDark[0], strata), lerp(P.rock[1], P.rockDark[1], strata), lerp(P.rock[2], P.rockDark[2], strata)], rock);
  }
  mix(out, P.scree, smoothstep(Z.treeline + 40, Z.treeline + 150, line) * (1 - rock) * 0.75);
  const snow = smoothstep(Z.snowLine - Z.snowBlend / 2, Z.snowLine + Z.snowBlend / 2, rel + (broad - 0.5) * 90) * (1 - smoothstep(Z.snowSlope * 0.55, Z.snowSlope, slope));
  mix(out, P.snow, snow);

  // Road verge, beach and lake bed.
  mix(out, P.verge, 1 - smoothstep(Z.vergeNear, Z.vergeFar, r));
  if (hf.lake.present) {
    mix(out, P.shore, 1 - smoothstep(Z.shoreHeight * 0.3, Z.shoreHeight, rel));
    mix(out, P.lakeBed, smoothstep(0, -1.6, rel));
  }
  return out;
}

/**
 * Vertex colours for a rectangle of a grid: RGBA bytes, gamma-encoded (the material sets vertexColorGamma),
 * row-major over [ix0, ix1] × [iz0, iz1]. `gain` compensates for the detail texture's mean brightness.
 */
export function shadeGrid(track: Track, hf: Heightfield, g: Grid, ix0: number, iz0: number, ix1: number, iz1: number, gain: number): Uint8Array {
  const w = ix1 - ix0 + 1;
  const out = new Uint8Array(w * (iz1 - iz0 + 1) * 4);
  const seed = track.config.seed | 0;
  const isFine = g === hf.fine;
  const c: Rgb = [0, 0, 0];
  let o = 0;
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const k = iz * g.nx + ix;
      const x = g.x0 + ix * g.cell;
      const z = g.z0 + iz * g.cell;
      const r = isFine ? hf.dist[k] : 1e3;
      groundColor(hf, seed, x, g.h[k], z, g.gx[k], g.gz[k], r, c);
      out[o++] = Math.min(255, Math.pow(c[0] * gain, 1 / 2.2) * 255);
      out[o++] = Math.min(255, Math.pow(c[1] * gain, 1 / 2.2) * 255);
      out[o++] = Math.min(255, Math.pow(c[2] * gain, 1 / 2.2) * 255);
      out[o++] = 255;
    }
  }
  return out;
}
