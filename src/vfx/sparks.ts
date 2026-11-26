// Wall sparks: a steady fan of streaks while the body scrapes along a wall, plus a one-shot burst on impact.
// Both emitters ride on the car rig in local space, so the sparks stay with the car at any speed; their
// velocities are relative to the car. Spawn shapes are balls on purpose: the engine applies the emitter's
// rotation twice to a box spawn volume in local space.

import * as pc from 'playcanvas';
import { CAR } from '../config/car';
import { SPARKS } from '../config/vfx';
import type { FrameState } from '../core/frame';
import { clamp, damp, DEG, lerp } from '../core/math';
import { dotTexture, toSrgb } from './textures';

const RAD = 180 / Math.PI;

type Pair = readonly [number, number];

function sparkEmitter(name: string, map: pc.Texture, o: { count: number; lifetime: number; rate: Pair; loop: boolean; intensity: number; size: Pair; sideways: number; backward: Pair; upSlow: Pair; upFast: Pair }): pc.Entity {
  const e = new pc.Entity(name);
  e.addComponent('particlesystem', {
    numParticles: o.count,
    lifetime: o.lifetime,
    rate: o.rate[0],
    rate2: o.rate[1],
    loop: o.loop,
    autoPlay: false,
    localSpace: true,
    emitterShape: pc.EMITTERSHAPE_SPHERE,
    emitterRadius: SPARKS.spawnRadius,
    colorMap: map,
    blendType: pc.BLEND_ADDITIVE,
    depthWrite: false,
    lighting: false,
    intensity: o.intensity,
    stretch: SPARKS.stretch,
    // Emitter axes: x sideways, y up, z backwards (see `aim` below). Each spark picks a value between the
    // two graphs, independently per axis.
    localVelocityGraph: new pc.CurveSet([[0, -o.sideways], [0, o.upSlow[0], 1, o.upSlow[1]], [0, o.backward[0]]]),
    localVelocityGraph2: new pc.CurveSet([[0, o.sideways], [0, o.upFast[0], 1, o.upFast[1]], [0, o.backward[1]]]),
    scaleGraph: new pc.Curve([0, o.size[0], 1, o.size[1]]),
    alphaGraph: new pc.Curve([0, 1, 1, 0]),
    colorGraph: new pc.CurveSet([0, 1, 2].map((c) => [0, toSrgb(SPARKS.colorStart[c]), 1, toSrgb(SPARKS.colorEnd[c])])),
  });
  return e;
}

export class WallSparks {
  private readonly scrape: pc.Entity;
  private readonly burst: pc.Entity;
  private scraping = false;
  /** Where along the car the scrape sparks start, metres behind the centre (car frame z). */
  private along = -SPARKS.ahead;
  private cooldown = 0;
  private pendingHit = 0;

  /** `rig` is the car rig: its frame is the car frame on the road (x right, y up, z back). */
  constructor(app: pc.AppBase, rig: pc.Entity) {
    const dot = dotTexture(app.graphicsDevice);
    this.scrape = sparkEmitter('ScrapeSparks', dot, {
      count: SPARKS.count, lifetime: SPARKS.lifetime, rate: SPARKS.rate, loop: true, intensity: SPARKS.intensity, size: SPARKS.size,
      sideways: SPARKS.sideways, backward: SPARKS.backward, upSlow: SPARKS.upSlow, upFast: SPARKS.upFast,
    });
    this.burst = sparkEmitter('ImpactSparks', dot, {
      count: SPARKS.burstCount, lifetime: SPARKS.burstLifetime, rate: [0, SPARKS.burstSpread / SPARKS.burstCount], loop: false, intensity: SPARKS.burstIntensity, size: SPARKS.burstSize,
      sideways: SPARKS.burstSideways, backward: SPARKS.burstBackward, upSlow: SPARKS.burstUpSlow, upFast: SPARKS.burstUpFast,
    });
    rig.addChild(this.scrape);
    rig.addChild(this.burst);
  }

  /**
   * Report a wall impact (normal speed, m/s). `update` also reads `car.hit`, but that only holds the latest
   * fixed step: calling this from the step itself catches the impacts a rendered frame would miss.
   */
  impact(speed: number): void {
    this.pendingHit = Math.max(this.pendingHit, speed);
  }

  update(frame: FrameState): void {
    const car = frame.car;
    const sin = Math.sin(frame.yaw);
    const cos = Math.cos(frame.yaw);
    // Outward normal of the wall last touched (horizontal, world), split along the car's right and nose.
    // The car's right is (cos ψ, −sin ψ) and its nose (−sin ψ, −cos ψ).
    const nx = car.loc.lx * car.wallSide;
    const nz = car.loc.lz * car.wallSide;
    const toRight = nx * cos - nz * sin;
    const toNose = -nx * sin - nz * cos;
    const side = toRight >= 0 ? 1 : -1;
    // +1 = the nose corner is the one touching, −1 = the tail corner, 0 = the whole flank.
    const corner = clamp(toNose / Math.sin(SPARKS.cornerDeg * DEG), -1, 1);
    const alongTarget = -SPARKS.ahead * (1 - Math.abs(corner)) - corner * SPARKS.cornerReach;
    this.along += (alongTarget - this.along) * damp(SPARKS.slideRate, frame.dt);
    // Turn the emitter about Y so its +Z points against the direction of travel (−slip), then a little away
    // from the wall. Rotating +Z by θ about +Y gives (sin θ, 0, cos θ) in the car frame.
    const aim = -car.slip * RAD - side * SPARKS.inwardDeg;

    const scraping = car.scrape > SPARKS.scrapeMin && Math.abs(car.speed) > SPARKS.speedMin;
    if (scraping) {
      this.scrape.setLocalPosition(side * CAR.halfWidth, SPARKS.height, this.along);
      this.scrape.setLocalEulerAngles(0, aim, 0);
    }
    if (scraping !== this.scraping) {
      this.scraping = scraping;
      const ps = this.scrape.particlesystem!;
      if (scraping) ps.play();
      else ps.stop();
    }

    const hit = Math.max(this.pendingHit, car.hit);
    this.pendingHit = 0;
    this.cooldown -= frame.dt;
    if (hit > SPARKS.burstMinHit && this.cooldown <= 0) {
      this.cooldown = SPARKS.burstCooldown;
      const ps = this.burst.particlesystem!;
      const mesh = ps.emitter?.meshInstance.mesh;
      if (!mesh) return;
      // The burst starts where the contact is now, not where the scrape point has slid to so far.
      this.burst.setLocalPosition(side * CAR.halfWidth, SPARKS.height, alongTarget);
      this.burst.setLocalEulerAngles(0, aim, 0);
      const share = lerp(SPARKS.burstMinShare, 1, clamp((hit - SPARKS.burstMinHit) / (SPARKS.burstFullHit - SPARKS.burstMinHit), 0, 1));
      // Draw only the first sparks of the pool (6 indices each): a harder hit shows more of them.
      mesh.primitive[0].count = Math.max(1, Math.round(share * SPARKS.burstCount)) * 6;
      ps.reset();
      ps.play();
    }
  }
}
