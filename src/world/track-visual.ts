// Road, kerbs, walls, start line and gantry, all swept from the track centreline.
// Textures are procedural (canvas), so nothing here needs an asset download.

import { releaseMeshData } from '../core/memory';
import * as pc from 'playcanvas';
import { Rng } from '../core/rng';
import { ROAD_LAYER_ID } from '../render/layers';
import { WET_ROAD } from '../config/wet-road';
import { frameAt, type Track } from '../track/track';
import { WetRoad } from './wet-road';

/** A profile point: lateral offset (metres, + = left) and height above the banked road plane. */
type ProfilePoint = [d: number, h: number];

class StripBuilder {
  positions: number[] = [];
  normals: number[] = [];
  uvs: number[] = [];
  indices: number[] = [];

  /**
   * Sweep the edge a→b along the track over the arc lengths in `ss`. The face normal is tangent × (b − a),
   * so order a and b accordingly. u runs ua→ub across the edge, v = s / vTile along the track.
   */
  sweep(track: Track, ss: number[], a: ProfilePoint, b: ProfilePoint, ua: number, ub: number, vTile: number): void {
    const base = this.positions.length / 3;
    for (const s of ss) {
      const f = frameAt(track, s);
      const tan = Math.tan(f.bank);
      const ax = f.x + f.lx * a[0];
      const ay = f.y - a[0] * tan + a[1];
      const az = f.z + f.lz * a[0];
      const bx = f.x + f.lx * b[0];
      const by = f.y - b[0] * tan + b[1];
      const bz = f.z + f.lz * b[0];
      // 3D tangent including the grade.
      const tl = Math.hypot(1, f.grade);
      const tx = f.tx / tl;
      const ty = f.grade / tl;
      const tz = f.tz / tl;
      const ex = bx - ax;
      const ey = by - ay;
      const ez = bz - az;
      let nx = ty * ez - tz * ey;
      let ny = tz * ex - tx * ez;
      let nz = tx * ey - ty * ex;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      this.positions.push(ax, ay, az, bx, by, bz);
      this.normals.push(nx, ny, nz, nx, ny, nz);
      this.uvs.push(ua, s / vTile, ub, s / vTile);
    }
    for (let k = 0; k < ss.length - 1; k++) {
      const i = base + k * 2;
      this.indices.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
    }
  }

  build(device: pc.GraphicsDevice): pc.Mesh {
    const mesh = new pc.Mesh(device);
    mesh.setPositions(this.positions);
    mesh.setNormals(this.normals);
    mesh.setUvs(0, this.uvs);
    mesh.setIndices(this.indices);
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    return releaseMeshData(mesh);
  }
}

function canvasTexture(
  device: pc.GraphicsDevice,
  name: string,
  w: number,
  h: number,
  srgb: boolean,
  draw: (g: CanvasRenderingContext2D) => void,
  nearest = false,
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
    mipmaps: !nearest,
    minFilter: nearest ? pc.FILTER_NEAREST : pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: nearest ? pc.FILTER_NEAREST : pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT,
    anisotropy: nearest ? 1 : 8,
  });
  tex.setSource(canvas);
  return tex;
}

const WALL_TILE = 4;

function wallTexture(device: pc.GraphicsDevice, rng: Rng): pc.Texture {
  const S = 256;
  // u = height (0 bottom → 1 top), v = along the wall, one panel per tile.
  return canvasTexture(device, 'wall', S, S, true, (g) => {
    g.fillStyle = '#9c9a94';
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
      const v = 120 + Math.floor(rng.next() * 60);
      g.fillStyle = `rgba(${v},${v},${v - 4},0.35)`;
      g.fillRect(rng.next() * S, rng.next() * S, 1 + rng.next() * 2, 1 + rng.next() * 2);
    }
    // Grime rising from the base, a painted cap stripe, and a panel joint.
    const grime = g.createLinearGradient(0, 0, S * 0.45, 0);
    grime.addColorStop(0, 'rgba(40,38,34,0.6)');
    grime.addColorStop(1, 'rgba(40,38,34,0)');
    g.fillStyle = grime;
    g.fillRect(0, 0, S * 0.45, S);
    g.fillStyle = '#d6a11c';
    g.fillRect(S * 0.84, 0, S * 0.16, S);
    g.fillStyle = 'rgba(30,30,30,0.7)';
    g.fillRect(0, 0, S, 3);
  });
}

function kerbTexture(device: pc.GraphicsDevice): pc.Texture {
  return canvasTexture(
    device,
    'kerb',
    4,
    8,
    true,
    (g) => {
      g.fillStyle = '#c0261e';
      g.fillRect(0, 0, 4, 4);
      g.fillStyle = '#e9e7df';
      g.fillRect(0, 4, 4, 4);
    },
    true,
  );
}

function checkerTexture(device: pc.GraphicsDevice): pc.Texture {
  return canvasTexture(
    device,
    'checker',
    32,
    4,
    true,
    (g) => {
      for (let x = 0; x < 32; x++) {
        for (let y = 0; y < 4; y++) {
          g.fillStyle = (x + y) % 2 ? '#f2f2ee' : '#0c0c0e';
          g.fillRect(x, y, 1, 1);
        }
      }
    },
    true,
  );
}

function bannerTexture(device: pc.GraphicsDevice): pc.Texture {
  const W = 1024;
  const H = 64;
  const tex = canvasTexture(device, 'banner', W, H, true, (g) => {
    g.fillStyle = '#0d0e10';
    g.fillRect(0, 0, W, H);
    const cell = H / 4;
    for (const x0 of [0, W - 10 * cell]) {
      for (let x = 0; x < 10; x++) {
        for (let y = 0; y < 4; y++) {
          g.fillStyle = (x + y) % 2 ? '#f2f2ee' : '#0d0e10';
          g.fillRect(x0 + x * cell, y * cell, cell, cell);
        }
      }
    }
    g.fillStyle = '#d7f205';
    g.font = 'italic 900 44px "Avenir Next Condensed", "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('D R I V E   ·   S T A R T  /  F I N I S H', W / 2, H / 2 + 2);
  });
  tex.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
  tex.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
  return tex;
}

function arcLengths(track: Track, i0: number, i1: number): number[] {
  const ss: number[] = [];
  for (let i = i0; i <= i1; i++) ss.push(i * track.spacing);
  return ss;
}

export interface TrackVisual {
  root: pc.Entity;
  /** The asphalt material and its rain-ripple animation; call `wetRoad.update(time)` every frame. */
  wetRoad: WetRoad;
  /** Number of render entities created (for the draw-call budget). */
  entityCount: number;
}

export function createTrackVisual(app: pc.AppBase, track: Track): TrackVisual {
  const device = app.graphicsDevice;
  const cfg = track.config;
  const rng = new Rng(cfg.seed);
  const root = new pc.Entity('Track');
  app.root.addChild(root);

  const wetRoad = new WetRoad(device, cfg.seed, cfg.halfWidth);
  const asphalt = wetRoad.material;

  const kerb = new pc.StandardMaterial();
  kerb.name = 'Kerb';
  kerb.diffuseMap = kerbTexture(device);
  kerb.gloss = 0.5;
  kerb.update();

  const wall = new pc.StandardMaterial();
  wall.name = 'Wall';
  wall.diffuseMap = wallTexture(device, rng.fork());
  wall.gloss = 0.25;
  wall.update();

  const W = cfg.halfWidth;
  const K = W + cfg.kerbWidth;
  const O = K + cfg.wallThickness;
  const kh = cfg.kerbHeight;
  const top = cfg.wallHeight;
  const deck = -cfg.deckDepth;
  let entityCount = 0;

  const addMesh = (name: string, b: StripBuilder, material: pc.Material, castShadows: boolean, layer: number = pc.LAYERID_WORLD): void => {
    const e = new pc.Entity(name);
    e.addComponent('render', {
      meshInstances: [new pc.MeshInstance(b.build(device), material)],
      castShadows,
      receiveShadows: true,
      layers: [layer],
    });
    root.addChild(e);
    entityCount++;
  };

  // ~200 m chunks so each can be frustum-culled on its own.
  const CHUNK = 100;
  for (let i0 = 0; i0 < track.n; i0 += CHUNK) {
    const ss = arcLengths(track, i0, Math.min(track.n, i0 + CHUNK));
    const road = new StripBuilder();
    road.sweep(track, ss, [-W, 0], [W, 0], 1, 0, WET_ROAD.tileLength);
    addMesh(`Road_${i0}`, road, asphalt, false, ROAD_LAYER_ID);

    const kerbs = new StripBuilder();
    kerbs.sweep(track, ss, [W, 0], [K, kh], 0, 1, 2 * cfg.kerbBlock);
    kerbs.sweep(track, ss, [-K, kh], [-W, 0], 1, 0, 2 * cfg.kerbBlock);
    addMesh(`Kerb_${i0}`, kerbs, kerb, false);

    const walls = new StripBuilder();
    // Left wall: inner face, top, outer face down to the bottom of the deck.
    walls.sweep(track, ss, [K, kh], [K, top], 0.1, 1, WALL_TILE);
    walls.sweep(track, ss, [K, top], [O, top], 0.9, 1, WALL_TILE);
    walls.sweep(track, ss, [O, top], [O, deck], 1, 0, WALL_TILE);
    // Right wall, mirrored.
    walls.sweep(track, ss, [-K, top], [-K, kh], 1, 0.1, WALL_TILE);
    walls.sweep(track, ss, [-O, top], [-K, top], 1, 0.9, WALL_TILE);
    walls.sweep(track, ss, [-O, deck], [-O, top], 0, 1, WALL_TILE);
    addMesh(`Wall_${i0}`, walls, wall, true);
  }

  // ---- start/finish line ----
  const lineMat = new pc.StandardMaterial();
  lineMat.name = 'StartLine';
  lineMat.diffuseMap = checkerTexture(device);
  lineMat.gloss = 0.6;
  lineMat.depthBias = -2;
  lineMat.slopeDepthBias = -2;
  lineMat.update();
  const line = new StripBuilder();
  const lineSs = [cfg.finishS - 1, cfg.finishS, cfg.finishS + 1];
  line.sweep(track, lineSs, [-W, 0.012], [W, 0.012], 1, 0, 2);
  addMesh('StartLine', line, lineMat, false, ROAD_LAYER_ID);

  // ---- gantry ----
  const f = frameAt(track, cfg.finishS);
  const gantry = new pc.Entity('Gantry');
  gantry.setPosition(f.x, f.y, f.z);
  gantry.setEulerAngles(0, (f.yaw * 180) / Math.PI, 0);
  root.addChild(gantry);
  const steel = new pc.StandardMaterial();
  steel.name = 'GantrySteel';
  steel.diffuse = new pc.Color(0.06, 0.065, 0.07);
  steel.useMetalness = true;
  steel.metalness = 0.6;
  steel.gloss = 0.55;
  steel.update();
  const banner = new pc.StandardMaterial();
  banner.name = 'GantryBanner';
  banner.diffuseMap = bannerTexture(device);
  banner.emissiveMap = banner.diffuseMap;
  banner.emissive = new pc.Color(1, 1, 1);
  banner.emissiveIntensity = 0.35;
  banner.gloss = 0.3;
  banner.update();
  const box = (name: string, mat: pc.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number): void => {
    const e = new pc.Entity(name);
    e.addComponent('render', { type: 'box', material: mat, castShadows: true });
    e.setLocalPosition(x, y, z);
    e.setLocalScale(sx, sy, sz);
    gantry.addChild(e);
    entityCount++;
  };
  const postX = O + 0.6;
  const beamY = 7.2;
  box('PostL', steel, -postX, beamY / 2 - 1, 0, 0.5, beamY + 2, 0.5);
  box('PostR', steel, postX, beamY / 2 - 1, 0, 0.5, beamY + 2, 0.5);
  box('BeamTop', steel, 0, beamY + 0.75, 0, 2 * postX + 0.5, 0.18, 0.5);
  box('BeamBottom', steel, 0, beamY - 0.75, 0, 2 * postX + 0.5, 0.18, 0.5);
  // The banner faces the approaching cars: its +Z face looks back down the track.
  box('Banner', banner, 0, beamY, 0.05, 2 * postX - 0.6, 1.25, 0.12);

  return { root, wetRoad, entityCount };
}
