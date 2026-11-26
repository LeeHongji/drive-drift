// The visible car: model instantiation, material overrides by name, wheels, cosmetic body motion and lights.
// Nothing here feeds back into the simulation.

import * as pc from 'playcanvas';
import { CAR } from '../config/car';
import { SIM_DT } from '../config/sim';
import { CAR_LIGHTS, CAR_NO_SHADOW_PARTS } from '../config/vfx';
import { clamp, valueNoise } from '../core/math';
import { frameAt, makeFrame, type Track } from '../track/track';
import { ROAD_LAYER_ID } from './layers';
import type { CarInput, CarState } from '../vehicle/car';

const RAD = 180 / Math.PI;

/** Contact shadow footprint (metres) and darkness. */
const BLOB_WIDTH = 2.9;
const BLOB_LENGTH = 5.6;
const BLOB_OPACITY = 0.62;

class Spring {
  x = 0;
  v = 0;
  constructor(
    private readonly k: number,
    private readonly c: number,
  ) {}
  step(target: number, dt: number): void {
    this.v += (this.k * (target - this.x) - this.c * this.v) * dt;
    this.x += this.v * dt;
  }
}

interface Wheel {
  steer: pc.Entity;
  spin: pc.Entity;
  front: boolean;
  radius: number;
  /** Rest position in the car frame. */
  x: number;
  y: number;
  z: number;
  angle: number;
}

function tuneMaterials(root: pc.Entity): { tail: pc.StandardMaterial | null } {
  let tail: pc.StandardMaterial | null = null;
  const seen = new Set<pc.Material>();
  for (const render of root.findComponents('render') as pc.RenderComponent[]) {
    for (const mi of render.meshInstances) {
      const m = mi.material as pc.StandardMaterial;
      if (seen.has(m)) continue;
      seen.add(m);
      m.useMetalness = true;
      switch (m.name) {
        case 'Paint':
          // Base coat under a glossy clear coat. The livery (blue with orange trim) is in the texture.
          m.metalness = 0.25;
          m.gloss = 0.62;
          m.clearCoat = 1;
          m.clearCoatGloss = 0.97;
          break;
        case 'GlossBlack':
          m.metalness = 0;
          m.gloss = 0.9;
          m.clearCoat = 0.6;
          m.clearCoatGloss = 0.95;
          break;
        case 'Glass':
          m.diffuse = new pc.Color(0.01, 0.012, 0.015);
          m.diffuseMap = null;
          m.opacityMap = null;
          m.opacity = 0.72;
          m.blendType = pc.BLEND_NORMAL;
          m.depthWrite = false;
          m.metalness = 0;
          m.gloss = 0.98;
          // Keep reflections at full strength on the transparent surface.
          m.opacityFadesSpecular = false;
          break;
        case 'Light_Tail':
          m.emissiveMap = m.diffuseMap;
          m.emissive = new pc.Color(1, 1, 1);
          m.emissiveIntensity = CAR_LIGHTS.tailGlow;
          m.gloss = 0.8;
          tail = m;
          break;
        case 'Light_Head':
          m.emissiveMap = m.diffuseMap;
          m.emissive = new pc.Color(1, 1, 1);
          m.emissiveIntensity = CAR_LIGHTS.headGlow;
          m.gloss = 0.8;
          break;
        case 'Lights':
          m.emissiveMap = m.diffuseMap;
          m.emissive = new pc.Color(1, 1, 1);
          m.emissiveIntensity = CAR_LIGHTS.runningGlow;
          m.gloss = 0.7;
          break;
        case 'Rim':
          m.metalness = 0.75;
          m.gloss = 0.72;
          break;
        case 'Chrome':
          m.metalness = 1;
          m.gloss = 0.95;
          break;
        case 'Tyre':
          m.metalness = 0;
          m.gloss = 0.28;
          break;
        case 'Trim':
          m.metalness = 0.1;
          m.gloss = 0.5;
          break;
        case 'Badge':
          m.blendType = pc.BLEND_NORMAL;
          m.depthWrite = false;
          m.gloss = 0.8;
          break;
        default:
          // Chassis, Cabin: matte.
          m.metalness = 0;
          m.gloss = 0.3;
      }
      m.update();
    }
  }
  return { tail };
}

/** Soft contact shadow under the car, on top of the real shadow map: it keeps the car grounded in shade. */
function createBlobShadow(device: pc.GraphicsDevice): pc.Entity {
  const W = 128;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext('2d')!;
  // Stack shrinking rounded rectangles: cheap blur that works without canvas filters.
  const layers = 22;
  for (let i = 0; i < layers; i++) {
    const inset = 4 + i * 1.7;
    g.fillStyle = 'rgba(255,255,255,0.075)';
    g.beginPath();
    g.roundRect(inset, inset, W - 2 * inset, H - 2 * inset, 30 - i * 0.6);
    g.fill();
  }
  const tex = new pc.Texture(device, { name: 'blob-shadow', width: W, height: H, format: pc.PIXELFORMAT_RGBA8, mipmaps: true });
  tex.setSource(canvas);
  tex.addressU = pc.ADDRESS_CLAMP_TO_EDGE;
  tex.addressV = pc.ADDRESS_CLAMP_TO_EDGE;

  const m = new pc.StandardMaterial();
  m.name = 'BlobShadow';
  m.diffuse = new pc.Color(0, 0, 0);
  m.useLighting = false;
  m.useFog = false;
  m.opacityMap = tex;
  m.opacityMapChannel = 'a';
  m.opacity = BLOB_OPACITY;
  m.blendType = pc.BLEND_NORMAL;
  m.depthWrite = false;
  m.update();

  const e = new pc.Entity('BlobShadow');
  e.addComponent('render', { type: 'plane', material: m, castShadows: false, receiveShadows: false, layers: [ROAD_LAYER_ID] });
  e.setLocalPosition(0, 0.035, -0.12);
  e.setLocalScale(BLOB_WIDTH, 1, BLOB_LENGTH);
  return e;
}

export class CarVisual {
  readonly root = new pc.Entity('CarRig');
  /** Carries the body only: heave, pitch and roll from the cosmetic springs. Wheels stay on the rig.
   *  Its frame is the car frame (x right, y up, z back); body-mounted lights and effects attach here. */
  readonly bodyPivot = new pc.Entity('BodyPivot');
  /** Tailpipe markers (left, right), riding with the body: origin at the outlet, +Z along the jet. */
  readonly exhausts: pc.Entity[] = [];
  private readonly wheels: Wheel[] = [];
  private readonly tail: pc.StandardMaterial | null;
  private readonly ownMeshes: number;
  private readonly susp = new Spring(...CAR.suspSpring);
  private readonly dive = new Spring(...CAR.diveSpring);
  private readonly lean = new Spring(...CAR.leanSpring);
  private springClock = 0;
  private brakeGlow = 0;
  private pitch = 0;
  private roll = 0;
  private lift = 0;
  private readonly roadFrame = makeFrame();
  private readonly liftScratch = [0, 0, 0, 0];

  constructor(app: pc.AppBase, asset: pc.Asset) {
    const model = (asset.resource as pc.ContainerResource).instantiateRenderEntity({ castShadows: true });
    const car = model.findByName('Car') as pc.Entity | null;
    const body = model.findByName('Body') as pc.Entity | null;
    if (!car || !body) throw new Error('car model: Car/Body nodes missing (rebuild with npm run car:build)');
    for (const name of CAR_NO_SHADOW_PARTS) {
      const part = model.findByName(name) as pc.Entity | null;
      if (part?.render) part.render.castShadows = false;
    }
    this.root.addChild(model);
    this.root.addChild(this.bodyPivot);
    // Move the body under the pivot; it sits at the origin of the car frame so the transform is unchanged.
    body.reparent(this.bodyPivot);
    for (const name of ['Exhaust_L', 'Exhaust_R']) {
      const marker = model.findByName(name) as pc.Entity | null;
      if (!marker) continue;
      marker.reparent(this.bodyPivot);
      this.exhausts.push(marker);
    }

    for (const [name, front] of [['Wheel_FL', true], ['Wheel_FR', true], ['Wheel_RL', false], ['Wheel_RR', false]] as const) {
      const steer = model.findByName(name) as pc.Entity | null;
      const spin = steer?.findByName('Spin') as pc.Entity | null;
      if (!steer || !spin) throw new Error(`car model: ${name}/Spin missing`);
      const p = steer.getLocalPosition();
      this.wheels.push({
        steer, spin, front,
        radius: front ? CAR.wheelRadiusFront : CAR.wheelRadiusRear,
        x: p.x, y: p.y, z: p.z, angle: 0,
      });
    }
    this.tail = tuneMaterials(this.root).tail;
    this.root.addChild(createBlobShadow(app.graphicsDevice));
    // Counted now: effects that attach to the rig later (flames, beams) are not part of the car's own cost.
    this.ownMeshes = (this.root.findComponents('render') as pc.RenderComponent[]).reduce((n, r) => n + r.meshInstances.length, 0);
    app.root.addChild(this.root);
  }

  /**
   * Pose the car for this frame. `x, y, z, yaw` are the render-interpolated pose; `car` is the latest sim state.
   */
  update(car: CarState, input: CarInput, track: Track, x: number, y: number, z: number, yaw: number, dt: number): void {
    // ---- rig: follow the road's grade and bank under the car ----
    const f = frameAt(track, car.loc.s, 0, this.roadFrame);
    const rel = yaw - f.yaw; // nose relative to the road direction
    // Road height near the car is grade·(along) − tan(bank)·(left). Slope along the nose gives pitch
    // (+ = nose up); slope toward the car's right gives roll (+ = right side up, i.e. left side down).
    const pitchTarget = Math.atan(f.grade) * Math.cos(rel) - f.bank * Math.sin(rel);
    const rollTarget = f.bank * Math.cos(rel) + Math.atan(f.grade) * Math.sin(rel);
    // Kerbs: each wheel on the raised kerb lifts its corner; the rig takes the mean height and the tilt.
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    const lift = this.liftScratch;
    this.wheels.forEach((w, i) => {
      const ox = cosY * w.x + sinY * w.z; // world offset of the wheel from the car origin
      const oz = -sinY * w.x + cosY * w.z;
      const d = car.loc.d + ox * car.loc.lx + oz * car.loc.lz;
      lift[i] = clamp((Math.abs(d) - track.config.halfWidth) / track.config.kerbWidth, 0, 1) * track.config.kerbHeight;
    });
    const [fl, fr, rl, rr] = lift;
    const kerbPitch = (fl + fr - rl - rr) / 2 / CAR.wheelbase;
    const kerbRoll = (fr + rr - fl - rl) / 2 / CAR.trackWidth; // + = right side up
    const k = 1 - Math.exp(-14 * dt);
    this.pitch += (pitchTarget + kerbPitch - this.pitch) * k;
    this.roll += (rollTarget + kerbRoll - this.roll) * k;
    this.lift += ((fl + fr + rl + rr) / 4 - this.lift) * k;
    this.root.setPosition(x, y + this.lift, z);
    this.root.setEulerAngles(0, yaw * RAD, 0);
    this.root.rotateLocal(this.pitch * RAD, 0, this.roll * RAD);

    // ---- body springs, integrated at the physics rate so they behave the same at any frame rate ----
    const speedK = Math.min(1, Math.abs(car.speed) / 12);
    const bump = (valueNoise(car.loc.s * 0.11) - 0.5) * 0.04 + (valueNoise(car.loc.s * 0.85 + car.loc.d * 0.6) - 0.5) * 0.016;
    const kerb = car.onKerb ? (Math.floor(car.loc.s / 1.5) % 2 ? 0.03 : -0.012) : 0;
    const heaveTarget = (bump + kerb) * speedK;
    // Roll outward in a corner: positive = right side down, which is what a left turn (yawRate > 0) gives.
    // Slip has the same sign as the turn in a drift and adds to it.
    const leanTarget = clamp(car.yawRate * car.speed * CAR.leanPerLatAccel, -CAR.leanMax, CAR.leanMax) + car.slip * CAR.leanPerSlip;
    const diveTarget = clamp(car.accel * CAR.divePerAccel, -CAR.diveBrake, CAR.diveSquat);
    this.springClock += dt;
    let guard = 0;
    while (this.springClock >= SIM_DT && guard++ < 16) {
      this.springClock -= SIM_DT;
      this.susp.step(heaveTarget, SIM_DT);
      this.dive.step(diveTarget, SIM_DT);
      this.lean.step(leanTarget, SIM_DT);
    }
    if (guard >= 16) this.springClock = 0;
    // The wheels stay on the rig (the road); only the body rides the springs.
    this.bodyPivot.setLocalPosition(0, clamp(this.susp.x, -0.11, 0.1), 0);
    // +X rotation lifts the nose (the nose is at −Z); −Z rotation drops the right side.
    this.bodyPivot.setLocalEulerAngles(this.dive.x * RAD, 0, -this.lean.x * RAD);

    // ---- wheels ----
    const steerDeg = car.drift
      ? clamp(-car.beta * RAD, -CAR.wheelCounterSteerDeg, CAR.wheelCounterSteerDeg)
      : -car.steer * CAR.wheelSteerDeg * (1 - Math.min(0.6, Math.abs(car.speed) / 130));
    for (const w of this.wheels) {
      // Rolling forward (−Z) turns the wheel backwards about +X.
      w.angle = (w.angle - (car.speed / w.radius) * dt) % (2 * Math.PI);
      w.spin.setLocalEulerAngles(w.angle * RAD, 0, 0);
      if (w.front) w.steer.setLocalEulerAngles(0, steerDeg, 0);
    }

    // ---- lights ----
    const braking = input.brake > 0 && car.speed > 0.5 ? 1 : 0;
    this.brakeGlow += (braking - this.brakeGlow) * (1 - Math.exp(-(braking ? 40 : 12) * dt));
    if (this.tail) {
      const want = CAR_LIGHTS.tailGlow * (1 + (CAR_LIGHTS.brakeGain - 1) * this.brakeGlow);
      if (Math.abs(this.tail.emissiveIntensity - want) > 0.01) {
        this.tail.emissiveIntensity = want;
        this.tail.update();
      }
    }
  }

  /** Car-frame positions (x right, z back) of the two rear wheel centres. */
  get rearWheels(): { x: number; z: number }[] {
    return this.wheels.filter((w) => !w.front).map((w) => ({ x: w.x, z: w.z }));
  }

  /** Draw calls the car itself costs (mesh instances of the model and the contact shadow). */
  get meshCount(): number {
    return this.ownMeshes;
  }
}
