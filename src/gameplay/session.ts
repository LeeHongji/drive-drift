// One play session: track + car + scoring + laps + nitro shards, advanced together in fixed steps. Runs headless, so the
// game loop, unit tests and input replays all drive the exact same code.

import { SIM_DT } from '../config/sim';
import { mod } from '../core/math';
import type { Track } from '../track/track';
import { makeCar, placeCar, stepCar, type CarInput, type CarState } from '../vehicle/car';
import { makeLaps, stepLaps, type LapState } from './laps';
import { makePickups, resetPickups, stepPickups, type PickupState } from './pickups';
import { makeScore, stepScore, type ScoreState } from './scoring';

export class Session {
  readonly track: Track;
  car: CarState = makeCar();
  score: ScoreState = makeScore();
  laps: LapState = makeLaps();
  /** Nitro shards. The object lives as long as the session (resets clear it in place), so visuals can hold it. */
  readonly pickups: PickupState;
  /** Simulated seconds since the last reset. */
  time = 0;
  /** Fixed steps since the last reset. */
  steps = 0;

  constructor(track: Track) {
    this.track = track;
    this.pickups = makePickups(track);
    this.reset();
  }

  /** Back to the grid: `spawnBeforeFinish` metres before the line, at rest. */
  reset(): void {
    const cfg = this.track.config;
    this.place(mod(cfg.finishS - cfg.spawnBeforeFinish, this.track.length), 0, 0);
  }

  /** Put the car anywhere on the track and clear scoring, laps, nitro and shards (tests, replays, debug teleport). */
  place(s: number, d: number, speed: number): void {
    placeCar(this.car, this.track, s, d, speed);
    this.score = makeScore();
    this.laps = makeLaps();
    resetPickups(this.pickups, this.car.nitro);
    this.time = 0;
    this.steps = 0;
  }

  step(input: CarInput): void {
    stepCar(this.car, input, this.track, SIM_DT);
    stepScore(this.score, this.car, SIM_DT);
    const lapsBefore = this.laps.events.length;
    stepLaps(this.laps, this.track, this.car.loc.s, SIM_DT);
    if (this.laps.events.length > lapsBefore) this.score.lapPoints = 0;
    stepPickups(this.pickups, this.car, this.track, SIM_DT);
    this.time += SIM_DT;
    this.steps++;
  }
}
