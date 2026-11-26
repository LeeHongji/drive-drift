// Fixed-timestep accumulator. Rendering runs at the display rate; the simulation only advances in whole
// steps of SIM_DT, at most MAX_STEPS_PER_FRAME per frame (beyond that the game slows down rather than
// trying to catch up).

import { MAX_STEPS_PER_FRAME, SIM_DT } from '../config/sim';

export class FixedStepper {
  private acc = 0;
  /** Fraction of a step left over after the last `advance`, for render interpolation. */
  alpha = 0;

  /** Feed one frame's elapsed time; returns how many fixed steps to run now. */
  advance(frameDt: number): number {
    this.acc += Math.max(0, frameDt);
    let steps = Math.floor(this.acc / SIM_DT + 1e-9);
    if (steps > MAX_STEPS_PER_FRAME) {
      steps = MAX_STEPS_PER_FRAME;
      this.acc = 0; // drop the backlog
    } else {
      this.acc -= steps * SIM_DT;
    }
    this.alpha = this.acc / SIM_DT;
    return steps;
  }

  reset(): void {
    this.acc = 0;
    this.alpha = 0;
  }
}
