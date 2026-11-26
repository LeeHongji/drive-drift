// A small geometry toolkit for the procedural world: accumulates positions, normals, UVs and vertex colours,
// then builds a pc.Mesh. Every face helper takes the direction the face should look toward and fixes the
// winding itself, so nothing depends on getting vertex order right by hand.

import { releaseMeshData } from '../core/memory';
import * as pc from 'playcanvas';
import type { TrackFrame } from '../track/track';

export type V3 = [number, number, number];
export type Rgb = [number, number, number];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export function normalize(a: V3): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Linear colour → gamma-encoded byte (materials built from these meshes set vertexColorGamma). */
export const toByte = (linear: number): number => Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, linear), 1 / 2.2) * 255)));

/**
 * World position of a point given in track coordinates: `d` metres left of the centreline and `h` metres
 * above the banked road plane (the same convention the road sweep uses), optionally `ds` metres further
 * along the tangent.
 */
export function trackPoint(f: TrackFrame, d: number, h: number, ds = 0): V3 {
  return [f.x + f.lx * d + f.tx * ds, f.y - d * Math.tan(f.bank) + h + f.grade * ds, f.z + f.lz * d + f.tz * ds];
}

export class MeshBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }
  get triangleCount(): number {
    return this.indices.length / 3;
  }

  /** Add one vertex; returns its index. `color` is linear RGB. */
  vertex(p: V3, n: V3, color: Rgb, u = 0, v = 0): number {
    this.positions.push(p[0], p[1], p[2]);
    this.normals.push(n[0], n[1], n[2]);
    this.uvs.push(u, v);
    this.colors.push(toByte(color[0]), toByte(color[1]), toByte(color[2]), 255);
    return this.positions.length / 3 - 1;
  }

  private at(i: number): V3 {
    return [this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]];
  }

  /** Add a triangle between existing vertices, wound so that it faces `toward`. */
  triangle(i: number, j: number, k: number, toward: V3): void {
    const a = this.at(i);
    const n = cross(sub(this.at(j), a), sub(this.at(k), a));
    if (dot(n, toward) >= 0) this.indices.push(i, j, k);
    else this.indices.push(i, k, j);
  }

  /** A flat triangle with its own vertices, facing `toward`. */
  tri(a: V3, b: V3, c: V3, toward: V3, color: Rgb): void {
    let n = normalize(cross(sub(b, a), sub(c, a)));
    const flip = dot(n, toward) < 0;
    if (flip) n = scale(n, -1);
    const i = this.vertex(a, n, color);
    const j = this.vertex(b, n, color);
    const k = this.vertex(c, n, color);
    if (flip) this.indices.push(i, k, j);
    else this.indices.push(i, j, k);
  }

  /**
   * A flat quad a→b→c→d (corners in order around the perimeter), facing `toward`. Colours and UVs may be
   * given per corner; one colour applies to all four.
   */
  quad(a: V3, b: V3, c: V3, d: V3, toward: V3, color: Rgb | [Rgb, Rgb, Rgb, Rgb], uv?: [number, number][]): void {
    let n = normalize(cross(sub(b, a), sub(d, a)));
    const flip = dot(n, toward) < 0;
    if (flip) n = scale(n, -1);
    const col = (k: number): Rgb => (typeof color[0] === 'number' ? (color as Rgb) : (color as Rgb[])[k]);
    const i = this.vertex(a, n, col(0), uv ? uv[0][0] : 0, uv ? uv[0][1] : 0);
    this.vertex(b, n, col(1), uv ? uv[1][0] : 0, uv ? uv[1][1] : 0);
    this.vertex(c, n, col(2), uv ? uv[2][0] : 0, uv ? uv[2][1] : 0);
    this.vertex(d, n, col(3), uv ? uv[3][0] : 0, uv ? uv[3][1] : 0);
    if (flip) this.indices.push(i, i + 2, i + 1, i, i + 3, i + 2);
    else this.indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  /** A box from its centre and three half-extent vectors (any orthogonal set); all six faces look outward. */
  box(c: V3, ex: V3, ey: V3, ez: V3, color: Rgb, skip: { top?: boolean; bottom?: boolean } = {}): void {
    const face = (axis: V3, u: V3, v: V3): void => {
      const o = add(c, axis);
      this.quad(sub(sub(o, u), v), sub(add(o, u), v), add(add(o, u), v), add(sub(o, u), v), axis, color);
    };
    face(ex, ey, ez);
    face(scale(ex, -1), ey, ez);
    if (!skip.top) face(ey, ex, ez);
    if (!skip.bottom) face(scale(ey, -1), ex, ez);
    face(ez, ex, ey);
    face(scale(ez, -1), ex, ey);
  }

  /**
   * A tube through `path` with a radius per point and smooth sides. `side` is any vector not parallel to
   * the path (it fixes where the seam is). Ends are left open unless `cap` is set.
   */
  tube(path: V3[], radii: number[], sides: number, side: V3, color: Rgb | Rgb[], cap = false): void {
    const rings: number[] = [];
    for (let i = 0; i < path.length; i++) {
      const dir = normalize(sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]));
      const n1 = normalize(cross(dir, cross(side, dir)));
      const n2 = cross(dir, n1);
      const col = typeof color[0] === 'number' ? (color as Rgb) : (color as Rgb[])[i];
      rings.push(this.vertexCount);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const out = add(scale(n1, Math.cos(a)), scale(n2, Math.sin(a)));
        this.vertex(add(path[i], scale(out, radii[i])), out, col);
      }
    }
    for (let i = 0; i < path.length - 1; i++) {
      for (let k = 0; k < sides; k++) {
        const k1 = (k + 1) % sides;
        const a = rings[i] + k;
        const b = rings[i] + k1;
        const c = rings[i + 1] + k1;
        const d = rings[i + 1] + k;
        const out: V3 = [this.normals[a * 3] + this.normals[b * 3], this.normals[a * 3 + 1] + this.normals[b * 3 + 1], this.normals[a * 3 + 2] + this.normals[b * 3 + 2]];
        this.triangle(a, b, c, out);
        this.triangle(a, c, d, out);
      }
    }
    if (cap) {
      const last = path.length - 1;
      const up = normalize(sub(path[last], path[last - 1]));
      const col = typeof color[0] === 'number' ? (color as Rgb) : (color as Rgb[])[last];
      const centre = this.vertex(path[last], up, col);
      const first = this.vertexCount;
      for (let k = 0; k < sides; k++) this.vertex(this.at(rings[last] + k), up, col);
      for (let k = 0; k < sides; k++) this.triangle(centre, first + k, first + ((k + 1) % sides), up);
    }
  }

  /** Build the mesh. Vertex colours are included unless `colors` is false; UVs only when `uvs` is set. */
  build(device: pc.GraphicsDevice, opts: { colors?: boolean; uvs?: boolean } = {}): pc.Mesh {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(this.positions);
    mesh.setNormals(this.normals);
    if (opts.uvs) mesh.setUvs(0, this.uvs);
    if (opts.colors !== false) mesh.setColors32(this.colors);
    mesh.setIndices(this.indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    return releaseMeshData(mesh);
  }
}

/** A canvas-drawn texture. sRGB for colour, linear for data; canvas pixel (x, y) maps to uv (x/w, y/h). */
export function canvasTexture(
  device: pc.GraphicsDevice,
  name: string,
  w: number,
  h: number,
  srgb: boolean,
  draw: (g: CanvasRenderingContext2D) => void,
  repeat = true,
): pc.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new pc.Texture(device, {
    name,
    width: w,
    height: h,
    format: srgb ? pc.PIXELFORMAT_SRGBA8 : pc.PIXELFORMAT_RGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: repeat ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: repeat ? pc.ADDRESS_REPEAT : pc.ADDRESS_CLAMP_TO_EDGE,
    anisotropy: 8,
  });
  tex.setSource(canvas);
  return tex;
}

/** Add a mesh to the scene as its own entity. */
export function addMeshEntity(
  parent: pc.Entity,
  name: string,
  mesh: pc.Mesh,
  material: pc.Material,
  opts: { castShadows?: boolean; receiveShadows?: boolean; layer?: number } = {},
): pc.Entity {
  const e = new pc.Entity(name);
  e.addComponent('render', {
    meshInstances: [new pc.MeshInstance(mesh, material)],
    castShadows: opts.castShadows ?? false,
    receiveShadows: opts.receiveShadows ?? true,
    layers: [opts.layer ?? pc.LAYERID_WORLD],
  });
  parent.addChild(e);
  return e;
}
