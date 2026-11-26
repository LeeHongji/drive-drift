// Wet-road spray: a low, thin mist trailing each rear wheel at speed. It is what makes the asphalt read as
// wet from the chase camera, so it stays subtle and never looks like tyre smoke.
// The emitters ride on the car rig in local space (dense near the wheel at any speed) and are turned to trail
// against the direction of travel, so the mist also streams the right way in a drift.
// The particle system has no opacity control that can change per frame without a rebuild; density is set by
// swapping between a few copies of the puff texture with different alpha.

import * as pc from 'playcanvas';
import { SPRAY } from '../config/vfx';
import type { FrameState } from '../core/frame';
import { clamp, lerp } from '../core/math';
import { mistTexture, toSrgb } from './textures';

const RAD = 180 / Math.PI;

export class WetSpray {
  private readonly emitters: pc.Entity[] = [];
  /** Puff textures for density steps 1…SPRAY.steps. */
  private readonly maps: pc.Texture[] = [];
  /** Density step being shown; 0 = off. */
  private step = 0;

  /**
   * `rig` is the car rig (car frame on the road: x right, y up, z back); `rearWheels` are the rear wheel
   * centres in that frame.
   */
  constructor(app: pc.AppBase, rig: pc.Entity, rearWheels: { x: number; z: number }[]) {
    const device = app.graphicsDevice;
    for (let k = 1; k <= SPRAY.steps; k++) this.maps.push(mistTexture(device, (SPRAY.opacity * k) / SPRAY.steps));
    rearWheels.forEach((w, i) => {
      const e = new pc.Entity(`Spray${i}`);
      e.addComponent('particlesystem', {
        numParticles: SPRAY.count,
        lifetime: SPRAY.lifetime,
        rate: SPRAY.rate[0],
        rate2: SPRAY.rate[1],
        loop: true,
        autoPlay: false,
        localSpace: true,
        // A ball, not a box: the engine applies the emitter's rotation twice to a box in local space.
        emitterShape: pc.EMITTERSHAPE_SPHERE,
        emitterRadius: SPRAY.spawnRadius,
        startAngle: 0,
        startAngle2: 360,
        colorMap: this.maps[this.maps.length - 1],
        blendType: pc.BLEND_NORMAL,
        depthWrite: false,
        lighting: false,
        depthSoftening: SPRAY.depthSoftening,
        // Emitter axes: x sideways, y up, z against the direction of travel. Each puff picks a value between
        // the two graphs, independently per axis.
        localVelocityGraph: new pc.CurveSet([[0, -SPRAY.sideways], [0, SPRAY.upSlow[0], 1, SPRAY.upSlow[1]], [0, SPRAY.backward[0]]]),
        localVelocityGraph2: new pc.CurveSet([[0, SPRAY.sideways], [0, SPRAY.upFast[0], 1, SPRAY.upFast[1]], [0, SPRAY.backward[1]]]),
        scaleGraph: new pc.Curve([0, SPRAY.size[0], 1, SPRAY.size[1]]),
        // Thickens just behind the wheel, then thins out; the texture alpha carries the overall opacity.
        alphaGraph: new pc.Curve([0, 0.45, 0.1, 1, 0.5, 0.6, 1, 0]),
        colorGraph: new pc.CurveSet([[0, toSrgb(SPRAY.color[0])], [0, toSrgb(SPRAY.color[1])], [0, toSrgb(SPRAY.color[2])]]),
      });
      e.setLocalPosition(w.x, SPRAY.height, w.z + SPRAY.behind);
      rig.addChild(e);
      this.emitters.push(e);
    });
  }

  update(frame: FrameState): void {
    const car = frame.car;
    const pace = Math.hypot(car.vx, car.vz);
    // 0 at speedMin, 1 at speedFull.
    const speed = clamp((pace - SPRAY.speedMin) / (SPRAY.speedFull - SPRAY.speedMin), 0, 1);
    const density = speed * lerp(1, SPRAY.tunnelDensity, frame.tunnel);
    // Any forward speed above the threshold shows at least the faintest step.
    const step = car.speed > 0 && pace > SPRAY.speedMin ? Math.max(1, Math.ceil(density * SPRAY.steps)) : 0;
    const started = step > 0 && this.step === 0;
    const stopped = step === 0 && this.step > 0;
    this.step = step;

    const size = lerp(SPRAY.sizeAtMin, 1, speed);
    const brightness = lerp(1, SPRAY.tunnelBrightness, frame.tunnel);
    // Rotating +Z by θ about +Y gives (sin θ, 0, cos θ) in the car frame; against the travel direction is θ = −slip.
    const aim = -car.slip * RAD;
    for (const e of this.emitters) {
      const ps = e.particlesystem!;
      if (started) ps.play();
      else if (stopped) ps.stop();
      if (step === 0) continue;
      e.setLocalEulerAngles(0, aim, 0);
      // In local space the emitter's scale sizes the puffs without changing how far they travel.
      e.setLocalScale(size, size, size);
      const material = ps.emitter?.material;
      if (material) {
        material.setParameter('colorMap', this.maps[step - 1]);
        material.setParameter('colorMult', brightness);
      }
    }
  }
}
