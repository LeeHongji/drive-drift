// Headlamp beams. The running lights (the Y-shaped signatures) and the brake lights are emissive materials
// handled in car-visual.ts and are always on; this module adds the light the lamps throw, which only shows
// in the snow gallery: two dipped beams that light everything, and one wide main beam that lights the Road
// layer only (asphalt, grass, trees) so it can be strong without burning out the walls.

import * as pc from 'playcanvas';
import { CAR_LIGHTS } from '../config/vfx';
import { damp } from '../core/math';
import { engineColor } from '../vfx/textures';
import type { CarVisual } from './car-visual';
import { LIT_LAYERS, ROAD_ONLY_LAYERS } from './layers';

/** Bounds of the headlamp lens mesh in the car frame (both lenses are one mesh spanning the nose). */
function lensBounds(car: CarVisual): pc.BoundingBox {
  const toCar = new pc.Mat4().copy(car.root.getWorldTransform()).invert();
  for (const render of car.root.findComponents('render') as pc.RenderComponent[]) {
    for (const mi of render.meshInstances) {
      if (mi.material?.name !== 'Light_Head' || !mi.mesh) continue;
      const box = new pc.BoundingBox();
      box.setFromTransformedAabb(mi.mesh.aabb, new pc.Mat4().mul2(toCar, mi.node.getWorldTransform()));
      return box;
    }
  }
  throw new Error('car model: no mesh uses the Light_Head material (rebuild with npm run car:build)');
}

interface Beam {
  entity: pc.Entity;
  /** Intensity with the lamps fully on. */
  full: number;
}

export class CarLights {
  /** How far the headlamps are on, 0…1. */
  lamps = 0;
  private readonly beams: Beam[] = [];

  constructor(car: CarVisual) {
    const lens = lensBounds(car);
    const C = CAR_LIGHTS;
    const spread = lens.halfExtents.x * C.lampSpread;
    this.add(car, 'DippedBeamL', lens.center.x - spread, lens, LIT_LAYERS, C.dippedIntensity, C.dippedRange, C.dippedInnerDeg, C.dippedOuterDeg, C.dippedDipDeg);
    this.add(car, 'DippedBeamR', lens.center.x + spread, lens, LIT_LAYERS, C.dippedIntensity, C.dippedRange, C.dippedInnerDeg, C.dippedOuterDeg, C.dippedDipDeg);
    this.add(car, 'MainBeam', lens.center.x, lens, ROAD_ONLY_LAYERS, C.mainIntensity, C.mainRange, C.mainInnerDeg, C.mainOuterDeg, C.mainDipDeg);
  }

  private add(car: CarVisual, name: string, x: number, lens: pc.BoundingBox, layers: number[], full: number, range: number, innerDeg: number, outerDeg: number, dipDeg: number): void {
    const entity = new pc.Entity(name);
    entity.addComponent('light', {
      type: 'spot',
      color: engineColor(CAR_LIGHTS.color),
      intensity: 0,
      range,
      innerConeAngle: innerDeg,
      outerConeAngle: outerDeg,
      castShadows: false,
      layers,
    });
    entity.setLocalPosition(x, lens.center.y, lens.center.z);
    // A spot shines along its own −Y. Turning it (90° − dip) about X swings that axis to the car's nose (−Z),
    // `dip` degrees below level.
    entity.setLocalEulerAngles(90 - dipDeg, 0, 0);
    entity.enabled = false;
    // On the body, so the beams nod with it under braking.
    car.bodyPivot.addChild(entity);
    this.beams.push({ entity, full });
  }

  /** `tunnel` is FrameState.tunnel: 0 outside the snow gallery, 1 well inside. */
  update(tunnel: number, dt: number): void {
    this.lamps += ((tunnel > CAR_LIGHTS.tunnelOn ? 1 : 0) - this.lamps) * damp(CAR_LIGHTS.rate, dt);
    const on = this.lamps > 0.01;
    for (const beam of this.beams) {
      if (beam.entity.enabled !== on) beam.entity.enabled = on;
      if (on) beam.entity.light!.intensity = beam.full * this.lamps;
    }
  }
}
