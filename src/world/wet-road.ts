// Wet asphalt: the textures and the material that make the road read as "just rained on".
// Three things do the work: a gloss map with polished wheel tracks and damp/dry patches, an animated
// rain-ripple normal layered over a coarse asphalt normal, and (set up elsewhere) a planar reflection.
// All textures are generated on canvases at load; nothing is downloaded.

import * as pc from 'playcanvas';
import { WET_ROAD } from '../config/wet-road';
import { Rng } from '../core/rng';

function hash2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Tileable value noise: lattice coordinates wrap at `period`. */
function noise2(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = (n: number): number => ((n % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed);
  const b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed);
  const d = hash2(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fbm in 0…1 over the unit square; `cells` lattice cells across at the lowest octave. */
function fbm(u: number, v: number, cells: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let c = cells;
  for (let o = 0; o < octaves; o++) {
    sum += noise2(u * c, v * c, c, seed + o * 13) * amp;
    norm += amp;
    amp *= 0.5;
    c *= 2;
  }
  return sum / norm;
}

function makeTexture(device: pc.GraphicsDevice, name: string, canvas: HTMLCanvasElement, srgb: boolean): pc.Texture {
  const tex = new pc.Texture(device, {
    name,
    width: canvas.width,
    height: canvas.height,
    format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    anisotropy: WET_ROAD.anisotropy,
  });
  tex.setSource(canvas);
  return tex;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d')!];
}

/** Fill a canvas from a per-pixel function returning RGB in 0…255. */
function paint(g: CanvasRenderingContext2D, w: number, h: number, fn: (u: number, v: number, out: number[]) => void): void {
  const img = g.createImageData(w, h);
  const rgb = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fn((x + 0.5) / w, (y + 0.5) / h, rgb);
      const o = (y * w + x) * 4;
      img.data[o] = rgb[0];
      img.data[o + 1] = rgb[1];
      img.data[o + 2] = rgb[2];
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/**
 * Base colour. u runs across the road (0 = right edge, 1 = left edge of the asphalt), v along it, one tile
 * covering WET_ROAD.tileLength metres: one centre-line dash per tile.
 */
function diffuseTexture(device: pc.GraphicsDevice, rng: Rng, halfWidth: number): pc.Texture {
  const S = WET_ROAD.diffuseSize;
  const [canvas, g] = canvasOf(S, S);
  const seed = Math.floor(rng.range(1, 1000));
  paint(g, S, S, (u, v, out) => {
    const grain = hash2(Math.floor(u * S), Math.floor(v * S), seed);
    const l = 46 + fbm(u, v, 6, 4, seed) * 26 + grain * 20;
    out[0] = l;
    out[1] = l;
    out[2] = l + 3;
  });
  const px = (m: number): number => ((m + halfWidth) / (2 * halfWidth)) * S;
  // Repairs: darker fresh asphalt and paler worn patches.
  for (let i = 0; i < 14; i++) {
    const dark = rng.next() > 0.4;
    g.fillStyle = dark ? `rgba(8,8,10,${rng.range(0.16, 0.36)})` : `rgba(125,125,130,${rng.range(0.05, 0.13)})`;
    g.fillRect(rng.next() * S, rng.next() * S, rng.range(0.06, 0.26) * S, rng.range(0.07, 0.34) * S);
  }
  // Cracks.
  g.strokeStyle = 'rgba(10,10,12,0.6)';
  for (let i = 0; i < 12; i++) {
    g.lineWidth = rng.range(0.6, 1.6);
    g.beginPath();
    let x = rng.next() * S;
    let y = rng.next() * S;
    g.moveTo(x, y);
    for (let k = 0; k < 14; k++) {
      // Step sizes are in pixels of a 2048² texture.
      x += rng.range(-26, 26) * (S / 2048);
      y += rng.range(8, 42) * (S / 2048);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  // Rubbered-in wheel paths: two per lane, either side of each lane centre.
  const lane = halfWidth / 2;
  for (const m of [-lane - 0.9, -lane + 0.9, lane - 0.9, lane + 0.9]) {
    const band = (0.75 / (2 * halfWidth)) * S;
    const grad = g.createLinearGradient(px(m) - band, 0, px(m) + band, 0);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(px(m) - band, 0, 2 * band, S);
  }
  // Markings: solid edge lines and one dashed centre line (a two-lane mountain road).
  const line = (WET_ROAD.lineWidth / (2 * halfWidth)) * S;
  const edge = halfWidth - WET_ROAD.edgeLineInset;
  g.fillStyle = 'rgba(217,214,204,0.93)';
  g.fillRect(px(-edge) - line / 2, 0, line, S);
  g.fillRect(px(edge) - line / 2, 0, line, S);
  g.fillRect(px(0) - line / 2, 0, line, S * (WET_ROAD.dashLength / WET_ROAD.tileLength));
  // Erode the paint a little so it looks driven on.
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(52,52,56,${rng.range(0.1, 0.3)})`;
    const cx = [px(-edge), px(edge), px(0)][Math.floor(rng.next() * 3)];
    g.fillRect(cx - line / 2 + rng.next() * line, rng.next() * S, 1, rng.range(1, 3));
  }
  return makeTexture(device, 'asphalt-diffuse', canvas, true);
}

/** Gloss in the red channel: damp/dry blotches plus polished streaks where the tyres run. */
function glossTexture(device: pc.GraphicsDevice, rng: Rng, halfWidth: number): pc.Texture {
  const S = WET_ROAD.glossSize;
  const [canvas, g] = canvasOf(S, S);
  const seed = Math.floor(rng.range(1, 1000));
  const lane = halfWidth / 2;
  const tracks = [-lane - 0.9, -lane + 0.9, lane - 0.9, lane + 0.9].map((m) => (m + halfWidth) / (2 * halfWidth));
  paint(g, S, S, (u, v, out) => {
    let polish = 0;
    for (const t of tracks) {
      const d = (u - t) / WET_ROAD.trackPolishWidth;
      polish = Math.max(polish, Math.exp(-d * d));
    }
    const blotch = fbm(u, v, 3, 4, seed);
    const gloss = WET_ROAD.glossMin + (WET_ROAD.glossMax - WET_ROAD.glossMin) * Math.min(1, blotch * 0.8 + polish * 0.55 + hash2(u * S, v * S, seed) * 0.04);
    out[0] = out[1] = out[2] = gloss * 255;
  });
  return makeTexture(device, 'asphalt-gloss', canvas, false);
}

/** Encode a height function's slope as a tangent-space normal map. */
function normalFromHeight(S: number, height: (x: number, y: number) => number, strength: number): HTMLCanvasElement {
  const [canvas, g] = canvasOf(S, S);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = height(x, y);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = h[y * S + ((x + S - 1) % S)];
      const r = h[y * S + ((x + 1) % S)];
      const d = h[((y + S - 1) % S) * S + x];
      const u = h[((y + 1) % S) * S + x];
      let nx = (l - r) * strength;
      let ny = (d - u) * strength;
      const len = Math.hypot(nx, ny, 1);
      nx /= len;
      ny /= len;
      const o = (y * S + x) * 4;
      img.data[o] = (nx * 0.5 + 0.5) * 255;
      img.data[o + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[o + 2] = (1 / len) * 0.5 * 255 + 127.5;
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

function grainNormal(device: pc.GraphicsDevice, rng: Rng): pc.Texture {
  const S = WET_ROAD.normalSize;
  const seed = Math.floor(rng.range(1, 1000));
  const canvas = normalFromHeight(S, (x, y) => fbm(x / S, y / S, 16, 3, seed) + hash2(x, y, seed) * 0.35, 2.2);
  return makeTexture(device, 'asphalt-normal', canvas, false);
}

/**
 * Rain ripples: `frames` normal maps that loop seamlessly. Each drop is a ring that grows and fades over one
 * loop; drops start at different phases so the surface is never still.
 */
function rippleFrames(device: pc.GraphicsDevice, rng: Rng): pc.Texture[] {
  const S = WET_ROAD.rippleSize;
  const drops = Array.from({ length: WET_ROAD.rippleDrops }, () => ({ x: rng.next() * S, y: rng.next() * S, phase: rng.next(), size: rng.range(0.7, 1.2) }));
  const maxR = WET_ROAD.rippleRadius * S;
  const out: pc.Texture[] = [];
  for (let f = 0; f < WET_ROAD.rippleFrames; f++) {
    const t = f / WET_ROAD.rippleFrames;
    const canvas = normalFromHeight(
      S,
      (x, y) => {
        let h = 0;
        for (const d of drops) {
          const age = (t + d.phase) % 1;
          const radius = age * maxR * d.size;
          // Shortest distance on the wrapped tile.
          let dx = Math.abs(x - d.x);
          let dy = Math.abs(y - d.y);
          if (dx > S / 2) dx = S - dx;
          if (dy > S / 2) dy = S - dy;
          // Ring profile constants are in pixels of a 256² tile.
          const off = (Math.hypot(dx, dy) - radius) * (256 / S);
          if (Math.abs(off) > 7) continue;
          const fade = (1 - age) * (1 - age);
          h += Math.cos(off * 1.1) * Math.exp(-(off * off) / 9) * fade;
        }
        return h;
      },
      1.6,
    );
    out.push(makeTexture(device, `rain-ripple-${f}`, canvas, false));
  }
  return out;
}

export class WetRoad {
  readonly material = new pc.StandardMaterial();
  private readonly ripples: pc.Texture[];
  private frame = -1;

  constructor(device: pc.GraphicsDevice, seed: number, halfWidth: number) {
    const rng = new Rng(seed);
    const m = this.material;
    m.name = 'Asphalt';
    m.diffuseMap = diffuseTexture(device, rng.fork(), halfWidth);
    m.useMetalness = true;
    m.metalness = 0;
    // The map drives the gloss; the scalar is its ceiling.
    m.gloss = 1;
    m.glossMap = glossTexture(device, rng.fork(), halfWidth);
    m.glossMapChannel = 'r';
    m.glossMapTiling = new pc.Vec2(1, WET_ROAD.glossTilingAlong);
    m.normalMap = grainNormal(device, rng.fork());
    m.normalMapTiling = new pc.Vec2(...WET_ROAD.normalTiling);
    m.bumpiness = WET_ROAD.grainBumpiness;
    this.ripples = rippleFrames(device, rng.fork());
    m.normalDetailMap = this.ripples[0];
    m.normalDetailMapTiling = new pc.Vec2(...WET_ROAD.rippleTiling);
    m.normalDetailMapBumpiness = WET_ROAD.rippleBumpiness;
    m.reflectivity = WET_ROAD.reflectivity;
    // Keep the sheen where ambient occlusion would otherwise kill it (inside the gallery).
    m.occludeSpecular = pc.SPECOCC_NONE;
    m.update();
  }

  /** Advance the rain-ripple animation. `time` is the render clock in seconds. */
  update(time: number): void {
    const n = this.ripples.length;
    const frame = Math.floor((time / WET_ROAD.rippleLoop) * n) % n;
    if (frame === this.frame) return;
    this.frame = frame;
    // Swap the texture on the material's uniform directly. `material.update()` would rebuild every uniform
    // of the road material about 15 times a second; the property is kept in step for the next full update.
    this.material.normalDetailMap = this.ripples[frame];
    this.material.setParameter('texture_normalDetailMap', this.ripples[frame]);
  }
}
