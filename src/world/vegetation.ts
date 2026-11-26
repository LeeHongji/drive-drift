// Trees and grass. Both are plain StandardMaterial meshes drawn with hardware instancing, in the Road layer
// so the road's planar reflection skips them.
//
// Trees: three procedural species (spruce, golden larch, broadleaf), placed by src/world/placement.ts and
// grouped into square cells so each group can be frustum-culled.
//
// Grass: tufts of blades on a set of nested rings of tiles around the camera. Each ring's tiles are twice
// the size of the ring inside it and hold the same number of tufts, so density falls off with distance
// while the blades get wider to keep the ground covered. Tiles are refilled as the camera moves.
// There is no wind animation: it needs a custom vertex shader in both GLSL and WGSL, left for later.

import { releaseMeshData } from '../core/memory';
import * as pc from 'playcanvas';
import { QUALITY } from '../config/quality';
import { WORLD } from '../config/world';
import { lerp, smoothstep } from '../core/math';
import { Rng } from '../core/rng';
import { ROAD_LAYER_ID } from '../render/layers';
import type { Track } from '../track/track';
import type { Heightfield } from './heightfield';
import { MeshBuilder, add, normalize, scale, sub, toByte, type Rgb, type V3 } from './mesh-builder';
import { TREE_SPECIES, type TreeSpot } from './placement';

const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const tint = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

function vertexColorMaterial(name: string, gloss: number, twoSided: boolean): pc.StandardMaterial {
  const m = new pc.StandardMaterial();
  m.name = name;
  m.diffuseVertexColor = true;
  m.vertexColorGamma = true;
  m.gloss = gloss;
  if (twoSided) m.cull = pc.CULLFACE_NONE;
  m.update();
  return m;
}

// ---------------------------------------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------------------------------------

/** Rough size of a tree model at scale 1, for bounding boxes: crown radius and height, metres. */
const TREE_RADIUS = 5;
const TREE_HEIGHT = 14.5;

function trunk(b: MeshBuilder, rng: Rng, height: number, r0: number, r1: number): void {
  const bark = WORLD.trees.bark;
  const lean: V3 = [rng.range(-0.25, 0.25), 0, rng.range(-0.25, 0.25)];
  const path: V3[] = [[0, -1.2, 0], [lean[0] * 0.3, height * 0.5, lean[2] * 0.3], [lean[0], height, lean[2]]];
  b.tube(path, [r0 * 1.25, lerp(r0, r1, 0.5), r1], 6, [1, 0, 0], [tint(bark, 0.7), bark, bark]);
}

/** A conifer: a short trunk under stacked skirts of branches, each a star-shaped cone with drooping tips. */
function conifer(seed: number, o: { height: number; radius: number; layers: number; star: number; droop: number; color: Rgb; dark: Rgb }): MeshBuilder {
  const b = new MeshBuilder();
  const rng = new Rng(seed);
  const first = o.height * 0.13;
  trunk(b, rng, first + 1.2, 0.3, 0.24);
  const span = o.height - first;
  for (let i = 0; i < o.layers; i++) {
    const t = i / (o.layers - 1);
    // Layers bunch toward the top, where they are also smaller.
    const y0 = first + span * (1 - Math.pow(1 - t * 0.86, 1.25));
    const r = o.radius * lerp(1, 0.2, Math.pow(t, 0.9)) * rng.range(0.9, 1.1);
    const top = Math.min(o.height, y0 + span * lerp(0.36, 0.22, t));
    const n = 9;
    const turn = rng.next() * Math.PI * 2;
    const tipColor = tint(mixRgb(o.color, o.dark, rng.range(0, 0.25)), lerp(0.85, 1.12, t));
    const apex = b.vertex([0, top, 0], [0, 1, 0], mixRgb(o.dark, o.color, 0.45));
    const hub = b.vertex([0, y0 + (top - y0) * 0.12, 0], [0, -1, 0], o.dark);
    const ring: number[] = [];
    const under: number[] = [];
    for (let k = 0; k < n; k++) {
      const a = turn + (k / n) * Math.PI * 2;
      const rr = r * (k % 2 ? o.star : 1) * rng.range(0.92, 1.08);
      const y = y0 - (k % 2 ? 0 : o.droop * r);
      const out: V3 = [Math.cos(a), 0, Math.sin(a)];
      const p: V3 = [out[0] * rr, y, out[2] * rr];
      // Smooth cone normal: outward, tilted up by the cone's slope.
      ring.push(b.vertex(p, normalize([out[0] * (top - y), rr, out[2] * (top - y)]), tipColor));
      under.push(b.vertex(p, [0, -1, 0], tint(o.dark, 1.2)));
    }
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const a = turn + ((k + 0.5) / n) * Math.PI * 2;
      b.triangle(ring[k], ring[k1], apex, [Math.cos(a), 0.6, Math.sin(a)]);
      b.triangle(under[k], under[k1], hub, [0, -1, 0]);
    }
  }
  return b;
}

/** Unit icosphere (one subdivision): 42 vertices, 80 triangles. */
function icosphere(): { points: V3[]; faces: [number, number, number][] } {
  const t = (1 + Math.sqrt(5)) / 2;
  const points: V3[] = (
    [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]] as V3[]
  ).map(normalize);
  const base: [number, number, number][] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  const mid = new Map<number, number>();
  const midpoint = (a: number, b: number): number => {
    const key = Math.min(a, b) * 64 + Math.max(a, b);
    let m = mid.get(key);
    if (m === undefined) {
      m = points.length;
      points.push(normalize(add(points[a], points[b])));
      mid.set(key, m);
    }
    return m;
  };
  const faces: [number, number, number][] = [];
  for (const [a, b, c] of base) {
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    faces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return { points, faces };
}

/** A broadleaf: a trunk and a crown of a few lumpy blobs, shaded as one soft mass. */
function broadleaf(seed: number): MeshBuilder {
  const T = WORLD.trees;
  const b = new MeshBuilder();
  const rng = new Rng(seed);
  trunk(b, rng, 4.6, 0.36, 0.22);
  const ico = icosphere();
  const crown: V3 = [0, 6.6, 0];
  const blobs: { c: V3; r: V3 }[] = [{ c: [0, 6.9, 0], r: [2.7, 2.5, 2.7] }];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + rng.range(-0.4, 0.4);
    const d = rng.range(1.3, 2.0);
    const r = rng.range(1.6, 2.2);
    blobs.push({ c: [Math.cos(a) * d, rng.range(5.2, 7.6), Math.sin(a) * d], r: [r, r * rng.range(0.8, 0.95), r] });
  }
  for (const blob of blobs) {
    const first = b.vertexCount;
    for (const p of ico.points) {
      const bump = 1 + (rng.next() - 0.5) * 0.3;
      const pos: V3 = [blob.c[0] + p[0] * blob.r[0] * bump, blob.c[1] + p[1] * blob.r[1] * bump, blob.c[2] + p[2] * blob.r[2] * bump];
      // Normal: mostly the crown's sphere, partly the blob's, so the crown shades as one mass.
      const n = normalize(add(scale(normalize(sub(pos, crown)), 0.65), scale(p, 0.35)));
      // Darker underneath and inside, lighter on top and at the outside.
      const outside = Math.min(1, Math.hypot(pos[0], pos[1] - crown[1], pos[2]) / 3.6);
      const light = smoothstep(-0.9, 0.9, p[1]) * 0.6 + outside * 0.4;
      b.vertex(pos, n, tint(mixRgb(T.broadleafDark, T.broadleaf, light), rng.range(0.9, 1.1)));
    }
    for (const [i, j, k] of ico.faces) {
      const out = add(add(ico.points[i], ico.points[j]), ico.points[k]);
      b.triangle(first + i, first + j, first + k, out);
    }
  }
  return b;
}

export interface TreeStats {
  count: number;
  groups: number;
  triangles: number;
}

export function createTrees(app: pc.AppBase, parent: pc.Entity, track: Track, spots: TreeSpot[]): TreeStats {
  const T = WORLD.trees;
  const device = app.graphicsDevice;
  const seed = track.config.seed | 0;
  const models = [
    conifer(seed + 7, { height: 12.5, radius: 3.0, layers: 6, star: 0.72, droop: 0.16, color: T.spruce, dark: T.spruceDark }),
    conifer(seed + 8, { height: 11.5, radius: 2.3, layers: 7, star: 0.55, droop: 0.24, color: T.larch, dark: T.larchDark }),
    broadleaf(seed + 12),
  ];
  const meshes = models.map((m) => m.build(device));
  const material = vertexColorMaterial('Trees', T.gloss, false);
  const format = pc.VertexFormat.getDefaultInstancingFormat(device);
  const stats: TreeStats = { count: spots.length, groups: 0, triangles: 0 };

  // Group by species and by map cell.
  const groups = new Map<string, TreeSpot[]>();
  for (const s of spots) {
    const key = `${s.species}:${Math.floor(s.x / T.cell)}:${Math.floor(s.z / T.cell)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(s);
  }
  for (const [key, list] of groups) {
    const species = Math.min(TREE_SPECIES - 1, list[0].species);
    const data = new Float32Array(list.length * 16);
    const lo: V3 = [Infinity, Infinity, Infinity];
    const hi: V3 = [-Infinity, -Infinity, -Infinity];
    list.forEach((s, i) => {
      const c = Math.cos(s.yaw) * s.scale;
      const sn = Math.sin(s.yaw) * s.scale;
      // Column-major: yaw about Y, uniform scale, extra height scale, then translation.
      data.set([c, 0, -sn, 0, 0, s.scale * s.tall, 0, 0, sn, 0, c, 0, s.x, s.y, s.z, 1], i * 16);
      const r = TREE_RADIUS * s.scale;
      const h = TREE_HEIGHT * s.scale * s.tall;
      lo[0] = Math.min(lo[0], s.x - r);
      lo[1] = Math.min(lo[1], s.y - 2);
      lo[2] = Math.min(lo[2], s.z - r);
      hi[0] = Math.max(hi[0], s.x + r);
      hi[1] = Math.max(hi[1], s.y + h);
      hi[2] = Math.max(hi[2], s.z + r);
    });
    const vb = new pc.VertexBuffer(device, format, list.length, { usage: pc.BUFFER_STATIC, data });
    const mi = new pc.MeshInstance(meshes[species], material);
    const e = new pc.Entity(`Trees_${key}`);
    e.addComponent('render', { meshInstances: [mi], castShadows: true, receiveShadows: true, layers: [ROAD_LAYER_ID] });
    mi.setInstancing(vb, true);
    // Instance matrices are in world space (the entity stays at the origin), and so is this box.
    e.render!.customAabb = new pc.BoundingBox(
      new pc.Vec3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2),
      new pc.Vec3((hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, (hi[2] - lo[2]) / 2),
    );
    parent.addChild(e);
    stats.groups++;
    stats.triangles += models[species].triangleCount * list.length;
  }
  return stats;
}

// ---------------------------------------------------------------------------------------------------------
// Grass
// ---------------------------------------------------------------------------------------------------------

/** One tuft: `blades` blades scattered within `spread` of the origin. All normals point up (see below). */
function tuftMesh(device: pc.GraphicsDevice, rng: Rng, spread: number, width: number, height: number, detailed: boolean): pc.Mesh {
  const G = WORLD.grass;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const push = (p: V3, c: Rgb): number => {
    positions.push(p[0], p[1], p[2]);
    colors.push(toByte(c[0]), toByte(c[1]), toByte(c[2]), 255);
    return positions.length / 3 - 1;
  };
  for (let k = 0; k < G.blades; k++) {
    const a = rng.next() * Math.PI * 2;
    const d = Math.sqrt(rng.next()) * spread;
    const base: V3 = [Math.cos(a) * d, -0.06, Math.sin(a) * d];
    const face = rng.next() * Math.PI;
    const half: V3 = [(Math.cos(face) * width) / 2, 0, (Math.sin(face) * width) / 2];
    const h = height * (1 + (rng.next() - 0.5) * 2 * G.heightJitter);
    const leanDir = rng.next() * Math.PI * 2;
    const lean = h * rng.range(0.08, 0.38);
    const tip: V3 = [base[0] + Math.cos(leanDir) * lean, h, base[2] + Math.sin(leanDir) * lean];
    const dry = rng.next() < G.dryShare;
    const shade = rng.range(0.8, 1.15);
    const cBase = tint(dry ? G.dryBase : G.lushBase, shade);
    const cTip = tint(dry ? G.dryTip : G.lushTip, shade);
    const bl = push(sub(base, half), cBase);
    const br = push(add(base, half), cBase);
    if (detailed) {
      const mid: V3 = [lerp(base[0], tip[0], 0.3), h * 0.55, lerp(base[2], tip[2], 0.3)];
      const cMid = mixRgb(cBase, cTip, 0.6);
      const ml = push(sub(mid, scale(half, 0.62)), cMid);
      const mr = push(add(mid, scale(half, 0.62)), cMid);
      const t = push(tip, cTip);
      indices.push(bl, br, mr, bl, mr, ml, ml, mr, t);
    } else {
      const t = push(tip, cTip);
      indices.push(bl, br, t);
    }
  }
  // Every normal is +Y. The instance matrix turns +Y into the ground normal, so a tuft is lit exactly like
  // the terrain under it and the meadow reads as one surface; the blades' colour gradient gives the depth.
  const normals = new Array<number>(positions.length).fill(0);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setColors32(colors);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return releaseMeshData(mesh);
}

interface GrassTile {
  ring: number;
  /** Tile coordinates in units of the ring's tile size; NaN while the slot is empty. */
  ix: number;
  iz: number;
  entity: pc.Entity;
  mi: pc.MeshInstance;
  vb: pc.VertexBuffer;
  data: Float32Array;
  dirty: boolean;
}

export class GrassField {
  /** Tufts per tile, rings, and tiles in total. */
  readonly tufts: number;
  readonly rings: number;
  readonly tiles: GrassTile[] = [];
  /** Instances and triangles currently planted (all tiles, visible or not). */
  instances = 0;
  triangles = 0;

  private readonly hf: Heightfield;
  private readonly pattern: Float32Array;
  private readonly ringTris: number[] = [];
  private readonly counts = new Map<GrassTile, number>();
  private readonly origin: { x: number; z: number }[] = [];
  private readonly grad: [number, number] = [0, 0];
  private readonly box = new pc.BoundingBox();

  constructor(app: pc.AppBase, parent: pc.Entity, track: Track, hf: Heightfield) {
    const G = WORLD.grass;
    const device = app.graphicsDevice;
    this.hf = hf;
    const rng = new Rng((track.config.seed | 0) ^ 0x6a55);
    const density = QUALITY.grassDensity * G.densityScale;
    this.tufts = Math.max(1, Math.round((G.tile * G.tile * density) / G.blades));
    // Enough rings for the outermost one to reach the draw distance.
    this.rings = Math.max(1, Math.ceil(Math.log2(Math.max(1, QUALITY.grassDistance / (2 * G.tile)))) + 1);

    // One scatter pattern shared by every tile: stratified so tufts cover the tile evenly.
    // Per tuft: u, v in the tile, yaw, size, and a rank used to thin the grass toward the road.
    const side = Math.ceil(Math.sqrt(this.tufts));
    const cells: number[] = [];
    for (let i = 0; i < side * side; i++) cells.push(i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    this.pattern = new Float32Array(this.tufts * 5);
    for (let k = 0; k < this.tufts; k++) {
      const cell = cells[k];
      this.pattern[k * 5] = ((cell % side) + rng.next()) / side;
      this.pattern[k * 5 + 1] = (Math.floor(cell / side) + rng.next()) / side;
      this.pattern[k * 5 + 2] = rng.next() * Math.PI * 2;
      this.pattern[k * 5 + 3] = rng.range(0.78, 1.28);
      this.pattern[k * 5 + 4] = rng.next();
    }

    const material = vertexColorMaterial('Grass', G.gloss, true);
    const format = pc.VertexFormat.getDefaultInstancingFormat(device);
    for (let ring = 0; ring < this.rings; ring++) {
      const size = G.tile * 2 ** ring;
      const detailed = ring < G.detailRings;
      const spacing = size / Math.sqrt(this.tufts);
      const width = Math.min(G.maxWidth, G.width * G.widen ** ring);
      const mesh = tuftMesh(device, rng.fork(), spacing * G.spreadFactor, width, G.height * (1 + 0.15 * ring), detailed);
      this.ringTris.push(G.blades * (detailed ? 3 : 1));
      this.origin.push({ x: NaN, z: NaN });
      const slots = ring === 0 ? 16 : 12;
      for (let k = 0; k < slots; k++) {
        const data = new Float32Array(this.tufts * 16);
        const vb = new pc.VertexBuffer(device, format, this.tufts, { usage: pc.BUFFER_DYNAMIC, data });
        const mi = new pc.MeshInstance(mesh, material);
        const entity = new pc.Entity(`Grass_${ring}_${k}`);
        entity.addComponent('render', { meshInstances: [mi], castShadows: false, receiveShadows: true, layers: [ROAD_LAYER_ID] });
        mi.setInstancing(vb, true);
        mi.instancingCount = 0;
        entity.enabled = false;
        parent.addChild(entity);
        this.tiles.push({ ring, ix: NaN, iz: NaN, entity, mi, vb, data, dirty: false });
      }
    }
  }

  /**
   * Re-centre the rings on (x, z). Tiles that are no longer needed are hidden and queued; at most `budget`
   * of them are refilled per call (pass Infinity to fill everything at once, e.g. on the first frame).
   */
  update(x: number, z: number, budget = WORLD.grass.buildsPerFrame): void {
    const G = WORLD.grass;
    let changed = false;
    for (let ring = 0; ring < this.rings; ring++) {
      const snap = G.tile * 2 ** ring * 2;
      const ox = (Math.round(x / snap) - 1) * 2;
      const oz = (Math.round(z / snap) - 1) * 2;
      if (ox !== this.origin[ring].x || oz !== this.origin[ring].z) {
        this.origin[ring].x = ox;
        this.origin[ring].z = oz;
        changed = true;
      }
    }
    if (changed) this.assign();
    if (budget <= 0) return;
    // Refill queued tiles, finest ring first (they are the ones next to the camera).
    for (const tile of this.tiles) {
      if (!tile.dirty) continue;
      this.fill(tile);
      if (--budget <= 0) break;
    }
  }

  /** Work out which tiles each ring needs now; keep the ones already in place, queue the rest. */
  private assign(): void {
    for (let ring = 0; ring < this.rings; ring++) {
      const o = this.origin[ring];
      // The next finer ring covers a 2 × 2 block of this ring's tiles; leave that block out.
      const inner = ring > 0 ? this.origin[ring - 1] : null;
      const hx = inner ? inner.x / 2 : NaN;
      const hz = inner ? inner.z / 2 : NaN;
      const need: [number, number][] = [];
      for (let dz = 0; dz < 4; dz++) {
        for (let dx = 0; dx < 4; dx++) {
          const ix = o.x + dx;
          const iz = o.z + dz;
          if (inner && ix >= hx && ix < hx + 2 && iz >= hz && iz < hz + 2) continue;
          need.push([ix, iz]);
        }
      }
      const slots = this.tiles.filter((t) => t.ring === ring);
      const free: GrassTile[] = [];
      for (const t of slots) {
        const k = need.findIndex(([ix, iz]) => ix === t.ix && iz === t.iz);
        if (k >= 0) need.splice(k, 1);
        else free.push(t);
      }
      for (const [ix, iz] of need) {
        const t = free.pop();
        if (!t) break;
        t.ix = ix;
        t.iz = iz;
        t.dirty = true;
        t.entity.enabled = false;
      }
      // Slots left over (only possible if the block to leave out is not inside this ring) stay hidden.
      for (const t of free) {
        t.ix = NaN;
        t.iz = NaN;
        t.dirty = false;
        t.entity.enabled = false;
        this.setCount(t, 0);
      }
    }
  }

  private setCount(tile: GrassTile, count: number): void {
    const before = this.counts.get(tile) ?? 0;
    this.counts.set(tile, count);
    this.instances += count - before;
    this.triangles += (count - before) * this.ringTris[tile.ring];
    tile.mi.instancingCount = count;
  }

  /** Plant one tile: place each tuft of the pattern on the ground, skipping road, water, rock and cliffs. */
  private fill(tile: GrassTile): void {
    const G = WORLD.grass;
    const hf = this.hf;
    const size = G.tile * 2 ** tile.ring;
    const x0 = tile.ix * size;
    const z0 = tile.iz * size;
    // Mirror and swap the pattern per tile so neighbouring tiles do not repeat.
    let hash = (Math.imul(tile.ix, 0x27d4eb2d) ^ Math.imul(tile.iz, 0x165667b1) ^ (tile.ring * 0x9e3779b1)) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b) >>> 0;
    const flipU = (hash & 1) !== 0;
    const flipV = (hash & 2) !== 0;
    const swap = (hash & 4) !== 0;
    const lakeY = hf.lake.present ? hf.lake.level : -1e6;
    const pattern = this.pattern;
    const data = tile.data;
    let n = 0;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let k = 0; k < this.tufts; k++) {
      let u = pattern[k * 5];
      let v = pattern[k * 5 + 1];
      if (swap) [u, v] = [v, u];
      if (flipU) u = 1 - u;
      if (flipV) v = 1 - v;
      const x = x0 + u * size;
      const z = z0 + v * size;
      const rank = pattern[k * 5 + 4];
      const d = hf.trackDistAt(x, z);
      if (d < G.minTrackDist || (d < G.fadeDist && rank > smoothstep(G.minTrackDist, G.fadeDist, d))) continue;
      const y = hf.heightAt(x, z);
      const rel = y - lakeY;
      if (rel < G.minAboveLake || rel > G.maxAboveLake) continue;
      const g = hf.gradientAt(x, z, this.grad);
      const gx = g[0];
      const gz = g[1];
      const steep = Math.sqrt(gx * gx + gz * gz);
      if (steep > G.maxSlope * (0.6 + 0.4 * rank)) continue;
      const yaw = pattern[k * 5 + 2] + (hash & 0xff);
      const s = pattern[k * 5 + 3];
      const c = Math.cos(yaw) * s;
      const sn = Math.sin(yaw) * s;
      const nl = s / Math.sqrt(gx * gx + 1 + gz * gz);
      const o = n * 16;
      // Column-major. Local X and Z lie in the ground plane, local Y is the ground normal.
      data[o] = c;
      data[o + 1] = gx * c - gz * sn;
      data[o + 2] = -sn;
      data[o + 3] = 0;
      data[o + 4] = -gx * nl;
      data[o + 5] = nl;
      data[o + 6] = -gz * nl;
      data[o + 7] = 0;
      data[o + 8] = sn;
      data[o + 9] = gx * sn + gz * c;
      data[o + 10] = c;
      data[o + 11] = 0;
      data[o + 12] = x;
      data[o + 13] = y;
      data[o + 14] = z;
      data[o + 15] = 1;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
      n++;
    }
    tile.dirty = false;
    this.setCount(tile, n);
    if (n === 0) {
      tile.entity.enabled = false;
      return;
    }
    tile.vb.setData(data);
    // World-space bounds (the entity sits at the origin): the tile, padded for blade height and spread.
    const pad = size * 0.1 + 1;
    this.box.center.set(x0 + size / 2, (yMin + yMax) / 2 + 0.5, z0 + size / 2);
    this.box.halfExtents.set(size / 2 + pad, (yMax - yMin) / 2 + 2, size / 2 + pad);
    tile.entity.render!.customAabb = this.box;
    tile.entity.enabled = true;
  }
}
