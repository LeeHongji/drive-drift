// Chase camera: sits behind the car, swings toward the direction of travel in a slide, widens with speed,
// shakes on impacts, and glides in from behind and above at the start.

import * as pc from 'playcanvas';
import { CAMERA } from '../config/camera';
import { MAIN_CAMERA_LAYERS } from '../render/layers';
import { clamp, damp, wrapAngle } from '../core/math';
import { makeLocation, project, type Track } from '../track/track';
import type { CarState } from '../vehicle/car';

export class ChaseCamera {
  readonly entity = new pc.Entity('ChaseCamera');
  private yaw = 0;
  private dist = CAMERA.distance;
  private y = 0;
  private roll = 0;
  private shake = 0;
  private intro = 1;
  private time = 0;
  /** Smoothed nitro level, 0 … 1 (drives FOV, distance and shake; other effects may read it). */
  boost = 0;
  private readonly loc = makeLocation();

  constructor(app: pc.AppBase) {
    this.entity.addComponent('camera', {
      fov: CAMERA.fov,
      nearClip: CAMERA.near,
      farClip: CAMERA.far,
      clearColor: new pc.Color(0.5, 0.6, 0.75),
      toneMapping: pc.TONEMAP_ACES,
      gammaCorrection: pc.GAMMA_SRGB,
      layers: MAIN_CAMERA_LAYERS,
    });
    app.root.addChild(this.entity);
  }

  /** Snap behind the car; with `intro` the glide-in from behind and above plays again. */
  reset(car: CarState, track: Track, intro = true): void {
    this.yaw = car.yaw;
    this.dist = CAMERA.distance;
    this.y = car.y;
    this.roll = 0;
    this.shake = 0;
    this.intro = intro ? 1 : 0;
    project(track, car.x, car.z, this.loc, true);
  }

  /** Register a wall impact (normal speed in m/s). */
  hit(normalSpeed: number): void {
    this.shake = Math.max(this.shake, Math.min(1, normalSpeed * CAMERA.shakePerHit));
  }

  update(car: CarState, track: Track, x: number, y: number, z: number, dt: number): void {
    const C = CAMERA;
    this.time += dt;
    const pace = Math.sqrt(car.vx * car.vx + car.vz * car.vz);
    const sf = clamp(pace / C.speedNorm, 0, 1);

    const velHeading = car.speed > C.headingMinSpeed ? Math.atan2(-car.vx, -car.vz) : car.yaw;
    const w = C.driftFollowMin + C.driftFollowGain * clamp(Math.abs(car.slip) / C.slipFull, 0, 1);
    const targetYaw = car.yaw + wrapAngle(velHeading - car.yaw) * w;
    this.yaw = wrapAngle(this.yaw + wrapAngle(targetYaw - this.yaw) * damp(C.yawRate, dt));
    this.boost += ((car.boost ? 1 : 0) - this.boost) * damp(C.boostRate, dt);
    this.dist += (C.distance + sf * C.distanceSpeed + this.boost * C.distanceBoost - this.dist) * damp(C.distanceRate, dt);
    this.y += (y - this.y) * damp(C.heightRate, dt);

    this.shake = Math.max(0, this.shake - dt * C.shakeDecay);
    const amp =
      this.shake * C.shakeHit + sf * sf * C.shakeSpeed + (car.onKerb && pace > 5 ? C.shakeKerb : 0) + this.boost * C.shakeBoost;
    const t = this.time;
    const sx = Math.sin(61 * t) * Math.sin(37 * t) * amp;
    const sy = Math.sin(53 * t + 1) * Math.sin(29 * t) * amp;

    this.intro = Math.max(0, this.intro - dt / C.introTime);
    const i2 = this.intro * this.intro;
    const back = this.dist + i2 * C.introDistance;
    const ahead = C.lookAhead * (1 - i2);

    // Forward and right of the camera's own yaw.
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    let px = x - fx * back + rx * sx;
    let pz = z - fz * back + rz * sx;
    project(track, px, pz, this.loc);
    // Keep the camera on the road side of the walls: slide it sideways back inside.
    const limit = track.wallOffset - C.wallClearance;
    if (Math.abs(this.loc.d) > limit) {
      const over = this.loc.d - Math.sign(this.loc.d) * limit;
      px -= this.loc.lx * over;
      pz -= this.loc.lz * over;
      project(track, px, pz, this.loc);
    }
    const floor = this.loc.y + C.groundClearance;
    const py = Math.max(floor, this.y + C.height + i2 * this.intro * C.introHeight + sy);

    this.entity.setPosition(px, py, pz);
    this.entity.lookAt(x + fx * ahead, this.y + C.lookHeight, z + fz * ahead);
    const rollTarget = car.steer * C.rollSteer + car.slip * C.rollSlip;
    this.roll += (rollTarget - this.roll) * damp(C.rollRate, dt);
    this.entity.rotateLocal(0, 0, this.roll);
    this.entity.camera!.fov = C.fov + sf * C.fovSpeed + this.boost * C.fovBoost;
  }
}
