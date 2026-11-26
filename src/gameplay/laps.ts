// Lap timing with a half-lap checkpoint. Pure logic.

import { mod } from '../core/math';
import type { Track } from '../track/track';

export interface LapEvent {
  /** Lap number just completed (1-based). */
  lap: number;
  time: number;
  /** True when this lap beat the previous best (also true for the first timed lap). */
  best: boolean;
}

export interface LapState {
  /** False until the car first crosses the line (rolling start). */
  started: boolean;
  /** Laps completed. */
  count: number;
  /** Time on the current lap, seconds. */
  time: number;
  last: number | null;
  best: number | null;
  /** Set once the car has been through the half-lap window on this lap. */
  half: boolean;
  /** Distance past the line in the driving direction, metres, in [0, length). */
  progress: number;
  events: LapEvent[];
}

export function makeLaps(): LapState {
  return { started: false, count: 0, time: 0, last: null, best: null, half: false, progress: -1, events: [] };
}

/** Advance lap timing by one fixed step. `s` is the car's arc length on the track. */
export function stepLaps(l: LapState, track: Track, s: number, dt: number): void {
  const len = track.length;
  const progress = mod(s - track.config.finishS, len);
  const prev = l.progress < 0 ? progress : l.progress;
  l.progress = progress;
  if (l.started) l.time += dt;

  const frac = progress / len;
  const [h0, h1] = track.config.halfLapWindow;
  if (frac >= h0 && frac <= h1) l.half = true;

  // The line is at progress 0: crossing it forward wraps from near `len` to near 0.
  const forward = prev > len * 0.75 && progress < len * 0.25;
  const backward = prev < len * 0.25 && progress > len * 0.75;
  if (backward) {
    l.half = false;
  } else if (forward) {
    if (!l.started) {
      l.started = true;
      l.time = 0;
    } else if (l.half) {
      const best = l.best === null || l.time < l.best;
      l.count++;
      l.last = l.time;
      if (best) l.best = l.time;
      l.events.push({ lap: l.count, time: l.time, best });
      l.time = 0;
    }
    l.half = false;
  }
}
