// Everything on the car that reacts to how it is driven: nitro flames, wall sparks, wet-road spray and the
// headlamp beams. One FrameSystem; call its `update` after the car visual and the camera have been posed.

import type * as pc from 'playcanvas';
import type { FrameState, FrameSystem } from '../core/frame';
import { CarLights } from '../render/car-lights';
import type { CarVisual } from '../render/car-visual';
import { NitroFlames } from './nitro-flames';
import { WallSparks } from './sparks';
import { WetSpray } from './spray';

export interface CarFx extends FrameSystem {
  /** Debug: when not null, the flames show this boost level (0…1) instead of `frame.boost`. */
  boostOverride: number | null;
  /** Debug: when not null, the flames show this surge level (0…1) instead of `frame.surge`. */
  surgeOverride: number | null;
  /**
   * Report a wall impact (normal speed, m/s) from the fixed step. Optional: `update` also reads `car.hit`,
   * but a rendered frame only sees the latest step and misses impacts that happened in an earlier one.
   */
  impact(speed: number): void;
}

export function createCarFx(app: pc.AppBase, carVisual: CarVisual): CarFx {
  const flames = new NitroFlames(app, carVisual.exhausts);
  const sparks = new WallSparks(app, carVisual.root);
  const spray = new WetSpray(app, carVisual.root, carVisual.rearWheels);
  const lights = new CarLights(carVisual);
  const fx: CarFx = {
    boostOverride: null,
    surgeOverride: null,
    impact: (speed) => sparks.impact(speed),
    update(frame: FrameState): void {
      flames.update(fx.boostOverride ?? frame.boost, fx.surgeOverride ?? frame.surge, frame.time, frame.dt, frame.camera);
      sparks.update(frame);
      spray.update(frame);
      lights.update(frame.tunnel, frame.dt);
    },
  };
  return fx;
}
