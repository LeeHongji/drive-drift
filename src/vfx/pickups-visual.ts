// Nitro shards on the track: one glowing hexagonal crystal per shard. It spins and bobs above the road, flies
// into the car when collected, stays hidden while the shard respawns and grows back in afterwards.
// StandardMaterial only (no custom shader), so it runs unchanged on WebGPU and WebGL2.

import * as pc from 'playcanvas';
import { SHARD_VISUAL } from '../config/nitro';
import type { FrameState, FrameSystem } from '../core/frame';
import type { PickupState } from '../gameplay/pickups';
import { frameAt, type Track } from '../track/track';

/** Direction the baked facet shading is "lit" from (crystal space, unit length not required). */
const FACET_LIGHT = [0.45, 0.8, 0.4];

/**
 * A hexagonal crystal: a short hexagonal waist with a blunt point above and a long point below, centred on
 * the origin with its axis along Y. Flat-shaded: every facet has its own vertices and normal, and its own
 * brightness baked into the vertex colours, so the facets still read when the emission blows out into bloom.
 */
function crystalMesh(device: pc.GraphicsDevice): pc.Mesh {
  const V = SHARD_VISUAL;
  const radius = V.width / Math.sqrt(3); // corner radius of a hexagon `width` across the flats
  const top = V.height / 2;
  const waistTop = top - V.height * V.topShare;
  const waistBottom = waistTop - V.height * V.waistShare;
  const ring = (y: number): number[][] =>
    Array.from({ length: 6 }, (_, k) => [Math.cos((k * Math.PI) / 3) * radius, y, Math.sin((k * Math.PI) / 3) * radius]);
  const upper = ring(waistTop);
  const lower = ring(waistBottom);

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const lightLength = Math.hypot(...FACET_LIGHT);
  /** Add one flat facet (triangle or quad, corners in order around it). */
  const facet = (corners: number[][]): void => {
    const [a, b, c] = corners;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const length = Math.hypot(...n);
    n = n.map((x) => x / length);
    // The crystal is convex around the origin: a facet faces outward when its normal points away from it.
    const outward = n[0] * a[0] + n[1] * a[1] + n[2] * a[2] > 0;
    if (!outward) n = n.map((x) => -x);
    const lit = 0.5 + (0.5 * (n[0] * FACET_LIGHT[0] + n[1] * FACET_LIGHT[1] + n[2] * FACET_LIGHT[2])) / lightLength;
    const shade = Math.round((V.facetMin + (1 - V.facetMin) * lit) * 255);
    const base = positions.length / 3;
    for (const p of corners) {
      positions.push(...p);
      normals.push(...n);
      colors.push(shade, shade, shade, 255);
    }
    for (let k = 1; k < corners.length - 1; k++) {
      // Counter-clockwise seen from outside.
      if (outward) indices.push(base, base + k, base + k + 1);
      else indices.push(base, base + k + 1, base + k);
    }
  };
  for (let k = 0; k < 6; k++) {
    const j = (k + 1) % 6;
    facet([[0, top, 0], upper[k], upper[j]]);
    facet([upper[k], upper[j], lower[j], lower[k]]);
    facet([[0, -top, 0], lower[k], lower[j]]);
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(positions);
  mesh.setNormals(normals);
  mesh.setColors32(new Uint8Array(colors));
  mesh.setIndices(indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

interface ShardVisual {
  entity: pc.Entity;
  /** Resting position: on the road at the shard's place, lifted by the hover height. */
  x: number;
  y: number;
  z: number;
  /** Whether the shard was on the track last frame. */
  present: boolean;
  /** Seconds left of the fly-into-the-car animation, and of the grow-back animation. */
  absorb: number;
  appear: number;
}

export class PickupsVisual implements FrameSystem {
  private readonly items: ShardVisual[] = [];

  constructor(app: pc.AppBase, track: Track, private readonly pickups: PickupState) {
    const V = SHARD_VISUAL;
    const mesh = crystalMesh(app.graphicsDevice);
    const material = new pc.StandardMaterial();
    material.name = 'NitroShard';
    material.diffuse = new pc.Color(0.02, 0.06, 0.09);
    material.emissive = new pc.Color(...V.color);
    material.emissiveIntensity = V.emissiveIntensity;
    material.emissiveVertexColor = true;
    material.emissiveVertexColorChannel = 'rgb';
    material.useMetalness = true;
    material.metalness = 0;
    material.gloss = 0.85;
    material.update();

    const root = new pc.Entity('NitroShards');
    app.root.addChild(root);
    pickups.shards.forEach((shard, i) => {
      const at = frameAt(track, shard.s, shard.d);
      const entity = new pc.Entity(`NitroShard${i}`);
      entity.addComponent('render', {
        meshInstances: [new pc.MeshInstance(mesh, material)],
        castShadows: false,
        receiveShadows: false,
        layers: [pc.LAYERID_WORLD],
      });
      root.addChild(entity);
      this.items.push({ entity, x: at.x, y: at.y + V.hover, z: at.z, present: true, absorb: 0, appear: 0 });
    });
  }

  update(frame: FrameState): void {
    const V = SHARD_VISUAL;
    const shards = this.pickups.shards;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const present = shards[i].timer <= 0;
      if (item.present && !present) item.absorb = V.absorbTime; // just collected
      if (!item.present && present) {
        item.appear = V.appearTime; // just respawned (or the session was reset)
        item.absorb = 0;
      }
      item.present = present;

      // Each shard is a fixed part of a cycle out of step with its neighbours.
      const phase = i * V.stagger;
      const bob = Math.sin((frame.time / V.bobPeriod + phase) * 2 * Math.PI) * V.bob;
      let x = item.x;
      let y = item.y + bob;
      let z = item.z;
      let scale = 1;
      if (present) {
        if (item.appear > 0) {
          item.appear = Math.max(0, item.appear - frame.dt);
          const t = 1 - item.appear / V.appearTime;
          scale = t * (2 - t); // ease out
        }
      } else if (item.absorb > 0) {
        item.absorb = Math.max(0, item.absorb - frame.dt);
        const t = 1 - item.absorb / V.absorbTime;
        const k = t * t; // ease in: it accelerates into the car
        x += (frame.x - x) * k;
        y += (frame.y + V.absorbHeight - y) * k;
        z += (frame.z - z) * k;
        scale = 1 + (V.absorbScale - 1) * k;
      } else {
        item.entity.enabled = false;
        continue;
      }
      item.entity.enabled = true;
      item.entity.setPosition(x, y, z);
      item.entity.setEulerAngles(0, (frame.time * V.spin + phase * 360) % 360, 0);
      item.entity.setLocalScale(scale, scale, scale);
    }
  }
}
