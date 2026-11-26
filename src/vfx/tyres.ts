// Tyre feedback: skid marks and smoke from the rear wheels. This is what tells the driver the car is
// sliding, so it belongs with the drift feel rather than with decoration.

import * as pc from 'playcanvas';
import { clamp } from '../core/math';
import { ROAD_LAYER_ID } from '../render/layers';
import { makeLocation, project, type Track, type TrackLocation } from '../track/track';
import type { CarInput, CarState } from '../vehicle/car';

const TYRES = {
  /** Skid mark strip width and height above the road, metres. */
  markWidth: 0.26,
  markLift: 0.02,
  /** A new mark segment is laid every this many metres; a longer gap starts a new strip. */
  markStep: 0.35,
  markGap: 4,
  /** Ring buffer size in quads (both wheels share it). */
  markQuads: 1400,
  /** Mark darkness at full screech. */
  markAlpha: 0.6,
  /** Smoke starts above this body slip angle (radians) and this speed (m/s). */
  smokeSlip: 0.12,
  smokeSpeed: 10,
};

/**
 * How hard the tyres are being worked, 0…1 (benchmark formula): sideways sliding speed above 9 m/s,
 * lateral acceleration above 64 m/s², or braking / the drift button at speed.
 */
export function screechLevel(car: CarState, input: CarInput): number {
  const pace = Math.hypot(car.vx, car.vz);
  if (pace < 3) return 0;
  const slide = (pace * Math.sin(Math.abs(car.slip)) - 9) / 6;
  const lateral = (Math.abs(car.yawRate * car.speed) / 40 - 1.6) * 2;
  const braking = (car.speed > 0 ? Math.max(input.brake, input.handbrake ? 1 : 0) : 0) * clamp((pace - 8) / 15, 0, 1);
  return clamp(Math.max(slide, lateral, braking), 0, 1);
}

function puffTexture(device: pc.GraphicsDevice): pc.Texture {
  const S = 64;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d')!;
  // A few overlapping soft blobs read as a billow rather than a disc.
  for (const [x, y, r, a] of [[32, 32, 30, 0.55], [22, 26, 16, 0.35], [42, 30, 15, 0.3], [30, 42, 17, 0.3]]) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }
  const tex = new pc.Texture(device, { name: 'smoke-puff', width: S, height: S, format: pc.PIXELFORMAT_SRGBA8, mipmaps: true });
  tex.setSource(canvas);
  return tex;
}

interface WheelTrail {
  loc: TrackLocation;
  /** Last mark edge laid (left and right points), or null when the strip is broken. */
  lastL: pc.Vec3 | null;
  lastR: pc.Vec3 | null;
  lastX: number;
  lastZ: number;
  lastAlpha: number;
  smoke: pc.Entity;
  smoking: boolean;
}

export class TyreFx {
  /** Current screech level, 0…1 (also useful to audio later). */
  screech = 0;
  private readonly mesh: pc.Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Uint8Array;
  private cursor = 0;
  private dirty = false;
  private readonly trails: WheelTrail[] = [];

  /** `rearWheels` are the car-frame positions (x right, z back) of the two rear wheel centres. */
  constructor(app: pc.AppBase, private readonly rearWheels: { x: number; z: number }[]) {
    const device = app.graphicsDevice;
    const n = TYRES.markQuads;
    this.positions = new Float32Array(n * 4 * 3);
    this.colors = new Uint8Array(n * 4 * 4);
    const indices = new Uint16Array(n * 6);
    for (let q = 0; q < n; q++) {
      const v = q * 4;
      indices.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
    }
    // The standard shader wants normals even when unlit; the marks all face up.
    const normals = new Float32Array(n * 4 * 3);
    for (let v = 0; v < n * 4; v++) normals[v * 3 + 1] = 1;
    this.mesh = new pc.Mesh(device);
    this.mesh.setPositions(this.positions);
    this.mesh.setNormals(normals);
    this.mesh.setColors32(this.colors);
    this.mesh.setIndices(indices);
    this.mesh.update(pc.PRIMITIVE_TRIANGLES);
    // The marks move around the whole circuit: give the mesh bounds that are never culled.
    this.mesh.aabb = new pc.BoundingBox(new pc.Vec3(0, 0, 0), new pc.Vec3(1e5, 1e4, 1e5));

    const marks = new pc.StandardMaterial();
    marks.name = 'SkidMarks';
    marks.diffuse = new pc.Color(0.012, 0.012, 0.014);
    marks.useLighting = false;
    marks.opacityVertexColor = true;
    marks.opacityVertexColorChannel = 'a';
    marks.blendType = pc.BLEND_NORMAL;
    marks.depthWrite = false;
    marks.depthBias = -1;
    marks.slopeDepthBias = -1;
    marks.cull = pc.CULLFACE_NONE;
    marks.update();
    const entity = new pc.Entity('SkidMarks');
    entity.addComponent('render', { meshInstances: [new pc.MeshInstance(this.mesh, marks)], castShadows: false, receiveShadows: false, layers: [ROAD_LAYER_ID] });
    app.root.addChild(entity);

    const puff = puffTexture(device);
    for (let i = 0; i < rearWheels.length; i++) {
      const smoke = new pc.Entity(`TyreSmoke${i}`);
      smoke.addComponent('particlesystem', {
        numParticles: 110,
        lifetime: 1.4,
        rate: 0.01,
        rate2: 0.016,
        loop: true,
        autoPlay: false,
        localSpace: false,
        emitterShape: pc.EMITTERSHAPE_BOX,
        emitterExtents: new pc.Vec3(0.25, 0.05, 0.3),
        startAngle: 0,
        startAngle2: 360,
        colorMap: puff,
        blendType: pc.BLEND_NORMAL,
        depthWrite: false,
        lighting: false,
        // Rises and drifts a little; grows as it thins out.
        velocityGraph: new pc.CurveSet([[0, -0.5], [0, 1.6, 1, 0.5], [0, -0.5]]),
        velocityGraph2: new pc.CurveSet([[0, 0.5], [0, 2.4, 1, 0.9], [0, 0.5]]),
        scaleGraph: new pc.Curve([0, 0.5, 0.3, 1.6, 1, 3.0]),
        alphaGraph: new pc.Curve([0, 0, 0.08, 0.42, 0.5, 0.2, 1, 0]),
        colorGraph: new pc.CurveSet([[0, 0.92], [0, 0.9], [0, 0.88]]),
      });
      app.root.addChild(smoke);
      this.trails.push({ loc: makeLocation(), lastL: null, lastR: null, lastX: 0, lastZ: 0, lastAlpha: 0, smoke, smoking: false });
    }
  }

  /** Forget the open strips (after a reset or teleport) so no mark is drawn across the jump. */
  breakTrails(): void {
    for (const t of this.trails) {
      t.lastL = null;
      t.lastR = null;
    }
  }

  private addQuad(aL: pc.Vec3, aR: pc.Vec3, bL: pc.Vec3, bR: pc.Vec3, alpha0: number, alpha1: number): void {
    const q = this.cursor;
    this.cursor = (this.cursor + 1) % TYRES.markQuads;
    const p = this.positions;
    const o = q * 12;
    p.set([aL.x, aL.y, aL.z, aR.x, aR.y, aR.z, bL.x, bL.y, bL.z, bR.x, bR.y, bR.z], o);
    const c = this.colors;
    const a0 = Math.round(alpha0 * 255);
    const a1 = Math.round(alpha1 * 255);
    for (let k = 0; k < 4; k++) {
      c[q * 16 + k * 4] = c[q * 16 + k * 4 + 1] = c[q * 16 + k * 4 + 2] = 255;
      c[q * 16 + k * 4 + 3] = k < 2 ? a0 : a1;
    }
    this.dirty = true;
  }

  /** `x, z, yaw` are the car's render pose. */
  update(car: CarState, input: CarInput, track: Track, x: number, z: number, yaw: number): void {
    this.screech = screechLevel(car, input);
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const pace = Math.hypot(car.vx, car.vz);
    // Marks run along the direction of travel, so their width is measured across it.
    const vx = pace > 1 ? car.vx / pace : -sin;
    const vz = pace > 1 ? car.vz / pace : -cos;
    const half = TYRES.markWidth / 2;
    const smokeOn = Math.abs(car.slip) > TYRES.smokeSlip && pace > TYRES.smokeSpeed;

    this.trails.forEach((t, i) => {
      const w = this.rearWheels[i];
      const wx = x + cos * w.x + sin * w.z;
      const wz = z - sin * w.x + cos * w.z;
      project(track, wx, wz, t.loc);
      const wy = t.loc.y;

      t.smoke.setPosition(wx, wy + 0.12, wz);
      if (smokeOn !== t.smoking) {
        t.smoking = smokeOn;
        const ps = t.smoke.particlesystem!;
        if (smokeOn) ps.play();
        else ps.stop();
      }

      const alpha = this.screech * TYRES.markAlpha;
      if (alpha < 0.02) {
        t.lastL = t.lastR = null;
        return;
      }
      const moved = Math.hypot(wx - t.lastX, wz - t.lastZ);
      if (t.lastL && moved < TYRES.markStep) return;
      const L = new pc.Vec3(wx + vz * half, wy + TYRES.markLift, wz - vx * half);
      const R = new pc.Vec3(wx - vz * half, wy + TYRES.markLift, wz + vx * half);
      if (t.lastL && t.lastR && moved < TYRES.markGap) this.addQuad(t.lastL, t.lastR, L, R, t.lastAlpha, alpha);
      t.lastL = L;
      t.lastR = R;
      t.lastX = wx;
      t.lastZ = wz;
      t.lastAlpha = alpha;
    });

    if (this.dirty) {
      this.dirty = false;
      this.mesh.setPositions(this.positions);
      this.mesh.setColors32(this.colors);
      this.mesh.update(pc.PRIMITIVE_TRIANGLES, false);
    }
  }
}
