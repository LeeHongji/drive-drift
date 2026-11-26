// Everything around the track except the ground itself (src/world/terrain.ts): the lake, trees, grass,
// trackside props and the snow gallery. One entry point, `createWorld`, returns a frame system for game.ts.

import { releaseMeshData } from '../core/memory';
import * as pc from 'playcanvas';
import { WORLD } from '../config/world';
import type { FrameState, FrameSystem } from '../core/frame';
import { Rng } from '../core/rng';
import type { Track } from '../track/track';
import { createGallery } from './gallery';
import { getHeightfield, type Heightfield } from './heightfield';
import { galleryRange, gallerySpec, tunnelFactor } from './layout';
import { addMeshEntity, canvasTexture } from './mesh-builder';
import { placePiers, placeTrees } from './placement';
import { createProps } from './props';
import { GrassField, createTrees } from './vegetation';

export { galleryRange, tunnelFactor } from './layout';

export interface WorldStats {
  /** Milliseconds `createWorld` took (the heightfield is counted where it was first built). */
  buildMs: number;
  trees: number;
  treeGroups: number;
  treeTriangles: number;
  /** Grass tufts (instances) and triangles planted right now, and the number of tiles. */
  grassInstances: number;
  grassTriangles: number;
  grassTiles: number;
  /** Render entities for banners, boards, lamps, posts, piers and the gallery. */
  propEntities: number;
  propTriangles: number;
  chevrons: number;
  lamps: number;
  posts: number;
  piers: number;
  lakeTriangles: number;
  lights: number;
}

export interface World extends FrameSystem {
  root: pc.Entity;
  /** 0 outside the snow gallery, 1 inside, blended over the portals. `s` is arc length in metres. */
  tunnelFactor(s: number): number;
  /** Arc-length range of the snow gallery, or null if the track has none. */
  gallery: { s0: number; s1: number } | null;
  /** Water level and which side of the lake straight the lake is on (+1 left, −1 right); null if no lake. */
  lake: { level: number; side: 1 | -1 } | null;
  /** Live counts for the performance record. */
  stats(): WorldStats;
}

/** Ripple normal map: a sum of sine waves with whole numbers of periods, so it tiles. */
function rippleTexture(device: pc.GraphicsDevice, rng: Rng): pc.Texture {
  const S = 256;
  return canvasTexture(device, 'lake-ripples', S, S, false, (g) => {
    const waves: { kx: number; ky: number; amp: number; phase: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const k = 2 + Math.floor(rng.next() * 9);
      const a = rng.next() * Math.PI * 2;
      waves.push({ kx: Math.round(Math.cos(a) * k), ky: Math.round(Math.sin(a) * k), amp: 1 / (k + 2), phase: rng.next() * Math.PI * 2 });
    }
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        let dx = 0;
        let dy = 0;
        for (const w of waves) {
          const c = Math.cos(((w.kx * x + w.ky * y) / S) * Math.PI * 2 + w.phase) * w.amp;
          dx += c * w.kx;
          dy += c * w.ky;
        }
        const l = Math.hypot(dx * 0.35, dy * 0.35, 1);
        const o = (y * S + x) * 4;
        img.data[o] = ((-dx * 0.35) / l) * 127.5 + 127.5;
        img.data[o + 1] = ((-dy * 0.35) / l) * 127.5 + 127.5;
        img.data[o + 2] = (1 / l) * 127.5 + 127.5;
        img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** The lake: a flat sheet at the water level, only where the basin is, so it cannot surface anywhere else. */
function createLake(app: pc.AppBase, parent: pc.Entity, track: Track, hf: Heightfield): { material: pc.StandardMaterial; triangles: number } | null {
  const lake = hf.lake;
  if (!lake.present) return null;
  const LK = WORLD.lake;
  const cell = hf.far.cell;
  const x0 = Math.floor((lake.x0 - LK.planeMargin) / cell) * cell;
  const z0 = Math.floor((lake.z0 - LK.planeMargin) / cell) * cell;
  const nx = Math.ceil((lake.x1 + LK.planeMargin - x0) / cell) + 1;
  const nz = Math.ceil((lake.z1 + LK.planeMargin - z0) / cell) + 1;
  // A vertex is "wet" when it lies in the basin and the ground there is at or below the water.
  const wet = new Uint8Array(nx * nz);
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const x = x0 + ix * cell;
      const z = z0 + iz * cell;
      if (hf.lakeAt(x, z) > 0 && hf.heightAt(x, z) < lake.level + 0.5) wet[iz * nx + ix] = 1;
    }
  }
  // Keep every cell that touches a wet vertex or has a wet neighbour, so the sheet always runs a little way
  // under the shore and the waterline is cut by the terrain, not by the sheet's own edge.
  const keep = (cx: number, cz: number): boolean => {
    for (let dz = -1; dz <= 2; dz++) {
      for (let dx = -1; dx <= 2; dx++) {
        const ix = cx + dx;
        const iz = cz + dz;
        if (ix >= 0 && iz >= 0 && ix < nx && iz < nz && wet[iz * nx + ix]) return true;
      }
    }
    return false;
  };
  const index = new Int32Array(nx * nz).fill(-1);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const vertex = (ix: number, iz: number): number => {
    const k = iz * nx + ix;
    if (index[k] < 0) {
      const x = x0 + ix * cell;
      const z = z0 + iz * cell;
      index[k] = positions.length / 3;
      positions.push(x, lake.level, z);
      normals.push(0, 1, 0);
      uvs.push(x / LK.rippleTile, z / LK.rippleTile);
    }
    return index[k];
  };
  for (let cz = 0; cz < nz - 1; cz++) {
    for (let cx = 0; cx < nx - 1; cx++) {
      if (!keep(cx, cz)) continue;
      const a = vertex(cx, cz);
      const b = vertex(cx + 1, cz);
      const c = vertex(cx, cz + 1);
      const d = vertex(cx + 1, cz + 1);
      // Counter-clockwise seen from above, like the terrain.
      indices.push(a, c, b, b, c, d);
    }
  }
  if (indices.length === 0) return null;
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setUvs(0, uvs);
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  releaseMeshData(mesh);

  const material = new pc.StandardMaterial();
  material.name = 'Lake';
  material.diffuse = new pc.Color(LK.color[0], LK.color[1], LK.color[2]);
  material.useMetalness = true;
  material.metalness = LK.metalness;
  material.gloss = LK.gloss;
  material.normalMap = rippleTexture(app.graphicsDevice, new Rng((track.config.seed | 0) ^ 0x1a6e));
  material.bumpiness = LK.ripple;
  material.normalMapOffset = new pc.Vec2(0.5, 0.5);
  material.update();
  addMeshEntity(parent, 'Lake', mesh, material, { receiveShadows: false });
  return { material, triangles: indices.length / 3 };
}

export function createWorld(app: pc.AppBase, track: Track): World {
  const t0 = performance.now();
  const hf = getHeightfield(track);
  const root = new pc.Entity('World');
  app.root.addChild(root);

  const lake = createLake(app, root, track, hf);
  const trees = createTrees(app, root, track, placeTrees(track, hf));
  const piers = placePiers(track, hf);
  const props = createProps(app, root, track, hf, piers);
  const spec = gallerySpec(track);
  const gallery = spec ? createGallery(app, root, track, spec) : null;
  const grass = new GrassField(app, root, track, hf);
  const buildMs = performance.now() - t0;

  let planted = false;
  const drift = new pc.Vec2();
  let lakeDue = 0;
  const LK = WORLD.lake;
  return {
    root,
    tunnelFactor: (s) => tunnelFactor(track, s),
    gallery: galleryRange(track),
    lake: hf.lake.present ? { level: hf.lake.level, side: hf.lake.side } : null,
    update(frame: FrameState): void {
      // Grass follows the camera. The first call plants every tile at once; later ones a few per frame.
      const p = frame.camera.getPosition();
      grass.update(p.x, p.z, planted ? WORLD.grass.buildsPerFrame : Infinity);
      planted = true;
      if (lake && frame.time >= lakeDue) {
        // The ripples creep along at a few decimetres a second, so the material is only refreshed
        // `rippleRate` times a second (each `update()` rebuilds all of its uniforms).
        lakeDue = frame.time + 1 / LK.rippleRate;
        // Never exactly (0, 0): the material would switch shader variant when the offset first moves.
        drift.set(0.5 + (frame.time * LK.rippleSpeed[0]) / LK.rippleTile, 0.5 + (frame.time * LK.rippleSpeed[1]) / LK.rippleTile);
        lake.material.normalMapOffset = drift;
        lake.material.update();
      }
    },
    stats: () => ({
      buildMs,
      trees: trees.count,
      treeGroups: trees.groups,
      treeTriangles: trees.triangles,
      grassInstances: grass.instances,
      grassTriangles: grass.triangles,
      grassTiles: grass.tiles.length,
      propEntities: props.entities + (gallery ? gallery.entities : 0),
      propTriangles: props.triangles + (gallery ? gallery.triangles : 0),
      chevrons: props.chevrons,
      lamps: props.lamps,
      posts: props.posts,
      piers: props.piers,
      lakeTriangles: lake ? lake.triangles : 0,
      lights: gallery ? gallery.lights : 0,
    }),
  };
}
