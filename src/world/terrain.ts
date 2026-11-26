// The ground: meshes built from the heightfield (src/world/heightfield.ts). A fine grid around the circuit and
// a coarser one for the mountain ring, both cut into chunks so the engine can frustum-cull them. Colour comes
// from vertex colours (src/world/terrain-shade.ts) times a small tiling detail texture mapped in world space.

import { ROAD_LAYER_ID } from '../render/layers';
import { releaseMeshData } from '../core/memory';
import * as pc from 'playcanvas';
import { WORLD } from '../config/world';
import { Rng } from '../core/rng';
import type { Track } from '../track/track';
import { getHeightfield, type Grid, type Heightfield } from './heightfield';
import { canvasTexture } from './mesh-builder';
import { shadeGrid } from './terrain-shade';

/** Counts from the last `createTerrain` call, for the performance record. */
export const terrainStats = { triangles: 0, chunks: 0, buildMs: 0 };

/** Greyscale ground detail: tileable blotches and speckle. Its mean brightness is `1 − contrast / 2`. */
function detailTexture(device: pc.GraphicsDevice, rng: Rng, contrast: number): pc.Texture {
  const S = 256;
  return canvasTexture(device, 'terrain-detail', S, S, true, (g) => {
    // Tileable value noise: lattice values repeat with the texture.
    const octave = (period: number): Float32Array => {
      const lattice = new Float32Array(period * period);
      for (let i = 0; i < lattice.length; i++) lattice[i] = rng.next();
      const out = new Float32Array(S * S);
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          const fx = (x / S) * period;
          const fy = (y / S) * period;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const u = fx - x0;
          const v = fy - y0;
          const su = u * u * (3 - 2 * u);
          const sv = v * v * (3 - 2 * v);
          const a = lattice[(y0 % period) * period + (x0 % period)];
          const b = lattice[(y0 % period) * period + ((x0 + 1) % period)];
          const c = lattice[((y0 + 1) % period) * period + (x0 % period)];
          const d = lattice[((y0 + 1) % period) * period + ((x0 + 1) % period)];
          out[y * S + x] = a + (b - a) * su + (c - a + (a - b - c + d) * su) * sv;
        }
      }
      return out;
    };
    const o1 = octave(5);
    const o2 = octave(13);
    const o3 = octave(41);
    const o4 = octave(128);
    const img = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const n = o1[i] * 0.34 + o2[i] * 0.3 + o3[i] * 0.22 + o4[i] * 0.14;
      // Stored gamma-encoded: the sampler decodes sRGB, so the shader sees the linear multiplier.
      const v = Math.pow(1 - contrast * n, 1 / 2.2) * 255;
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

/**
 * One chunk of a grid: vertices [ix0, ix1] × [iz0, iz1]. Cells for which `skip` returns true are left out
 * (the far grid's hole where the fine grid sits). Returns null when nothing is left.
 */
function chunkMesh(
  device: pc.GraphicsDevice,
  track: Track,
  hf: Heightfield,
  g: Grid,
  ix0: number,
  iz0: number,
  ix1: number,
  iz1: number,
  gain: number,
  skip: ((cx: number, cz: number) => boolean) | null,
): pc.Mesh | null {
  const w = ix1 - ix0 + 1;
  const h = iz1 - iz0 + 1;
  const indices = new Uint16Array((w - 1) * (h - 1) * 6);
  let p = 0;
  for (let cz = 0; cz < h - 1; cz++) {
    for (let cx = 0; cx < w - 1; cx++) {
      if (skip && skip(ix0 + cx, iz0 + cz)) continue;
      const a = cz * w + cx;
      // Diagonal from (1, 0) to (0, 1): the same split `sampleGrid` interpolates on.
      indices[p++] = a;
      indices[p++] = a + w;
      indices[p++] = a + 1;
      indices[p++] = a + 1;
      indices[p++] = a + w;
      indices[p++] = a + w + 1;
    }
  }
  if (p === 0) return null;

  const positions = new Float32Array(w * h * 3);
  const normals = new Float32Array(w * h * 3);
  const uvs = new Float32Array(w * h * 2);
  const tile = WORLD.terrain.detailTile;
  let o = 0;
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const k = iz * g.nx + ix;
      const x = g.x0 + ix * g.cell;
      const z = g.z0 + iz * g.cell;
      positions[o * 3] = x;
      positions[o * 3 + 1] = g.h[k];
      positions[o * 3 + 2] = z;
      const gx = g.gx[k];
      const gz = g.gz[k];
      const l = 1 / Math.sqrt(gx * gx + 1 + gz * gz);
      normals[o * 3] = -gx * l;
      normals[o * 3 + 1] = l;
      normals[o * 3 + 2] = -gz * l;
      uvs[o * 2] = x / tile;
      uvs[o * 2 + 1] = z / tile;
      o++;
    }
  }
  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0, uvs);
  mesh.setColors32(shadeGrid(track, hf, g, ix0, iz0, ix1, iz1, gain));
  mesh.setIndices(p === indices.length ? indices : indices.subarray(0, p));
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  terrainStats.triangles += p / 3;
  return releaseMeshData(mesh);
}

export function createTerrain(app: pc.AppBase, track: Track): pc.Entity {
  const t0 = performance.now();
  const T = WORLD.terrain;
  const device = app.graphicsDevice;
  const hf = getHeightfield(track);
  terrainStats.triangles = 0;
  terrainStats.chunks = 0;

  const material = new pc.StandardMaterial();
  material.name = 'Terrain';
  material.diffuseVertexColor = true;
  material.vertexColorGamma = true;
  material.diffuseMap = detailTexture(device, new Rng(track.config.seed ^ 0x7e44a1), T.detailContrast);
  material.gloss = T.gloss;
  material.update();
  // Vertex colours are divided by the detail texture's mean so the two multiply back to the palette colour.
  const gain = 1 / (1 - T.detailContrast / 2);

  const root = new pc.Entity('Terrain');
  app.root.addChild(root);
  const addChunks = (g: Grid, size: number, name: string, layer: number, skip: ((cx: number, cz: number) => boolean) | null): void => {
    for (let iz = 0; iz < g.nz - 1; iz += size) {
      for (let ix = 0; ix < g.nx - 1; ix += size) {
        const mesh = chunkMesh(device, track, hf, g, ix, iz, Math.min(ix + size, g.nx - 1), Math.min(iz + size, g.nz - 1), gain, skip);
        if (!mesh) continue;
        const e = new pc.Entity(`${name}_${ix}_${iz}`);
        e.addComponent('render', {
          meshInstances: [new pc.MeshInstance(mesh, material)],
          castShadows: T.castShadows,
          receiveShadows: true,
          layers: [layer],
        });
        root.addChild(e);
        terrainStats.chunks++;
      }
    }
  };

  const { fine, far } = hf;
  // The near ground goes in the Road layer: the road's reflection camera skips that layer, and the meadow
  // right beside the track is hidden behind the walls in the reflection anyway. The far grid (the mountains
  // that do show up in reflections) stays in World.
  addChunks(fine, T.chunkCells, 'Near', ROAD_LAYER_ID, null);
  // The far grid leaves a hole exactly where the fine grid sits (their edges share vertices).
  const hx0 = Math.round((fine.x0 - far.x0) / far.cell);
  const hz0 = Math.round((fine.z0 - far.z0) / far.cell);
  const hx1 = hx0 + Math.round(((fine.nx - 1) * fine.cell) / far.cell);
  const hz1 = hz0 + Math.round(((fine.nz - 1) * fine.cell) / far.cell);
  addChunks(far, T.chunkCellsFar, 'Far', pc.LAYERID_WORLD, (cx, cz) => cx >= hx0 && cx < hx1 && cz >= hz0 && cz < hz1);

  terrainStats.buildMs = performance.now() - t0;
  return root;
}
