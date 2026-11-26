// Chase camera. Distances in metres, angles in degrees, rates in 1/s (used as 1 − exp(−rate·dt)).

export const CAMERA = {
  /** Vertical field of view at rest, and what full speed adds. */
  fov: 52,
  fovSpeed: 12,
  /** Follow distance behind the car at rest, and what full speed adds. */
  distance: 5.4,
  distanceSpeed: 1.2,
  /** Camera height and look-at height above the car's road contact point. */
  height: 1.6,
  lookHeight: 0.8,
  /** The camera aims this far ahead of the car. */
  lookAhead: 5,
  /** Speed that counts as "full speed" for FOV, distance and shake, m/s. Follows the planned nitro cap. */
  speedNorm: 100,
  /** While sliding the camera follows the travel direction instead of the nose: weight driftFollowMin at no
   *  slip, rising to driftFollowMin + driftFollowGain at slipFull radians. */
  driftFollowMin: 0.55,
  driftFollowGain: 0.4,
  slipFull: 0.35,
  /** Below this speed the camera follows the nose only, m/s. */
  headingMinSpeed: 4,
  yawRate: 9,
  distanceRate: 6,
  heightRate: 14,
  rollRate: 5,
  /** Roll = steer·rollSteer + slip·rollSlip, degrees (steer and slip both positive to the right). */
  rollSteer: 0.8,
  rollSlip: 3,
  /** Shake amplitude in metres = shake·shakeHit + speed²·shakeSpeed + kerb·shakeKerb + boost·shakeBoost. */
  shakeHit: 0.16,
  shakeSpeed: 0.014,
  shakeKerb: 0.05,
  shakeBoost: 0.05,
  /** Nitro: the boost level (0 … 1) follows the car's boost flag at boostRate, and at 1 adds fovBoost
   *  degrees of field of view and distanceBoost metres of follow distance. */
  boostRate: 4,
  fovBoost: 14,
  distanceBoost: 0.9,
  /** A wall hit sets shake to min(1, normalSpeed × shakePerHit); it then decays at shakeDecay per second. */
  shakePerHit: 0.07,
  shakeDecay: 2.5,
  /** The camera never goes lower than this above the road under it. */
  groundClearance: 0.45,
  /** The camera stays at least this far inside the wall faces, metres. */
  wallClearance: 0.7,
  /** Intro glide: starts introDistance further back and introHeight higher, eases in over introTime seconds. */
  introTime: 1.8,
  introDistance: 7.5,
  introHeight: 4,
  near: 0.15,
  far: 6000,
};
