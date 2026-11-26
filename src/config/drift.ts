// Drift model. Grip and drift are two separate kinematic models; this file tunes the drift one.
// See docs/design/drift-gameplay.md §1–§2 for what each number feels like.

import { DEG, KMH } from '../core/math';

export const DRIFT = {
  /** Minimum forward speed to start a drift, m/s (50 km/h). */
  entrySpeed: 50 * KMH,
  /** The drift ends when speed falls below this, m/s (30 km/h). */
  exitSpeed: 30 * KMH,
  /** |steer| needed together with the drift button to start a drift. */
  entrySteer: 0.3,
  /** A tap of the drift button stays armed this long, seconds, so the button and the steering key do not
   *  have to be down in the very same instant. */
  entryBuffer: 0.25,
  /** Speed lost while the drift button is held and the car rolls forward, m/s². */
  bleed: 5,
  /** Largest target drift angle, radians. */
  angle: 45 * DEG,
  /** Share of `angle` held with only a light steer into the drift. */
  hold: 0.5,
  /** Target-angle multiplier off throttle. */
  lift: 0.4,
  /** Natural frequency of the angle spring while powered or steering, rad/s. */
  snap: 7,
  /** Damping ratio of the angle spring. */
  damping: 0.75,
  /** Natural frequency while coasting hands-off (slow straighten-up), rad/s. */
  grip: 3,
  /** The path turns at path × bend × maxYawRate(v). */
  path: 0.8,
  /** Minimum radius of the drift path, metres. */
  radius: 18,
  /** `bend` grows at ease/s and shrinks or reverses at unwind/s. */
  ease: 2,
  unwind: 4.5,
  /** Below this |steer·way| the driver counts as hands-off. */
  deadband: 0.1,
  /** Speed scrubbed per second = drag × |sin β|, m/s². */
  drag: 4,
  /** Counter-steer beyond this while β crosses zero flips the drift to the other side. */
  flickSteer: 0.5,
  /** Steering this hard into the drift blocks the exit timer. */
  holdSteer: 0.5,
  /** "Small angle" threshold for the slack test, radians. */
  exitAngle: 6 * DEG,
  /** Slack time before the drift ends, seconds. */
  settle: 0.3,
};
