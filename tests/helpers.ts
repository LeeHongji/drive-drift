import { TRACK, type TrackConfig } from '../src/config/track';
import { buildTrack, type Track } from '../src/track/track';

/** Handling test track: a stadium oval with 2 km straights, so scenarios do not depend on the real layout. */
export const OVAL: TrackConfig = {
  ...TRACK,
  finishS: 400,
  segments: [
    { kind: 'straight', length: 2000, solve: true, name: 'front straight' },
    { kind: 'arc', radius: 300, angle: 90, dir: 'right', name: 'turn 1' },
    { kind: 'straight', length: 600, solve: true, name: 'east chute' },
    { kind: 'arc', radius: 300, angle: 90, dir: 'right', name: 'turn 2' },
    { kind: 'straight', length: 2000, name: 'back straight' },
    { kind: 'arc', radius: 300, angle: 90, dir: 'right', name: 'turn 3' },
    { kind: 'straight', length: 600, name: 'west chute' },
    { kind: 'arc', radius: 300, angle: 90, dir: 'right', name: 'turn 4' },
  ],
};

/** Same oval with a 300 m wide road: an open skidpad for scenarios that must not meet a wall. */
export const PAD: TrackConfig = { ...OVAL, halfWidth: 150 };

let oval: Track | undefined;
let pad: Track | undefined;
let main: Track | undefined;
export const ovalTrack = (): Track => (oval ??= buildTrack(OVAL));
export const padTrack = (): Track => (pad ??= buildTrack(PAD));
export const mainTrack = (): Track => (main ??= buildTrack(TRACK));
