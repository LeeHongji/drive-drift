// Small procedural textures and colour helpers for the car effects. Textures are drawn once at start-up
// from fixed seeds.

import * as pc from 'playcanvas';
import { Rng } from '../core/rng';

type Rgb = readonly [number, number, number];

/** Linear 0…1 → sRGB 0…1. The config states colours as linear; the engine wants sRGB for material and
 *  light colours, particle colour graphs and 8-bit textures, and converts back itself. */
export const toSrgb = (v: number): number => Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2);

/** A linear RGB triple as the `pc.Color` the engine expects for material and light colours. */
export const engineColor = (rgb: Rgb): pc.Color => new pc.Color(toSrgb(rgb[0]), toSrgb(rgb[1]), toSrgb(rgb[2]));

const srgbByte = (v: number): number => Math.round(255 * toSrgb(v));

function fromPixels(device: pc.GraphicsDevice, name: string, width: number, height: number, pixels: Uint8Array, repeat: boolean): pc.Texture {
  const address = repeat ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE;
  // Raw pixels rather than a canvas: a canvas stores premultiplied alpha and would darken the faint edges.
  return new pc.Texture(device, { name, width, height, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true, addressU: address, addressV: address, levels: [pixels] });
}

/** Round white dot whose alpha falls from 1 at the centre to 0 at the rim (a spark). */
export function dotTexture(device: pc.GraphicsDevice): pc.Texture {
  const S = 32;
  const px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
      const a = Math.max(0, 1 - r);
      px.set([255, 255, 255, Math.round(255 * a * a)], (y * S + x) * 4);
    }
  }
  return fromPixels(device, 'spark-dot', S, S, px, false);
}

/**
 * Soft glow for an additive sprite: a wide halo of `rim` colour with a small white-hot centre. Black at the
 * edge of the texture, so the quad's outline never shows.
 */
export function glowTexture(device: pc.GraphicsDevice, rim: Rgb): pc.Texture {
  const S = 64;
  const px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const r2 = ((x + 0.5 - S / 2) ** 2 + (y + 0.5 - S / 2) ** 2) / (S / 2) ** 2;
      // The halo is cut to exactly zero at the rim (r = 1).
      const halo = Math.exp(-7 * r2) * 0.5 * Math.max(0, 1 - r2);
      const hot = Math.exp(-45 * r2);
      px.set([srgbByte(rim[0] * halo + hot), srgbByte(rim[1] * halo + 0.95 * hot), srgbByte(rim[2] * halo + 0.9 * hot), 255], (y * S + x) * 4);
    }
  }
  return fromPixels(device, 'flame-glow', S, S, px, false);
}

/**
 * Tiling brightness pattern for the flame jets, 1 = full brightness, darkest value 1 − `depth`. U runs
 * around the jet, V along it: streaks stretched along V plus a few bright bands across (shock diamonds).
 */
export function flameNoiseTexture(device: pc.GraphicsDevice, depth: number): pc.Texture {
  const W = 64;
  const H = 128;
  const rng = new Rng(0xf1a3e);
  // Two periodic value-noise lattices: coarse streaks and fine grain.
  const lattice = (cols: number, rows: number): ((u: number, v: number) => number) => {
    const cell = Array.from({ length: cols * rows }, () => rng.next());
    return (u, v) => {
      const x = u * cols;
      const y = v * rows;
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number): number => cell[(((j % rows) + rows) % rows) * cols + (((i % cols) + cols) % cols)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const streaks = lattice(8, 5);
  const grain = lattice(16, 14);
  const px = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / H;
      const n = streaks(u, v) * 0.65 + grain(u, v) * 0.35;
      const bands = Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * 3 * v), 6);
      const b = srgbByte(1 - depth + depth * Math.min(1, n * 0.9 + bands * 0.6));
      px.set([b, b, b, 255], (y * W + x) * 4);
    }
  }
  return fromPixels(device, 'flame-noise', W, H, px, true);
}

/** Soft billowy puff, white, with its alpha scaled by `alpha` (0…1). */
export function mistTexture(device: pc.GraphicsDevice, alpha: number): pc.Texture {
  const S = 64;
  // A few overlapping blobs read as a billow rather than a disc: [centre x, centre y, radius, weight].
  const blobs = [[32, 32, 30, 0.6], [22, 27, 17, 0.4], [42, 30, 16, 0.35], [31, 42, 18, 0.35]];
  const px = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let a = 0;
      for (const [cx, cy, radius, weight] of blobs) {
        const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        if (r < 1) a += weight * (1 - r * r) ** 2;
      }
      px.set([255, 255, 255, Math.round(255 * Math.min(1, a) * alpha)], (y * S + x) * 4);
    }
  }
  return fromPixels(device, `mist-${alpha.toFixed(2)}`, S, S, px, false);
}
