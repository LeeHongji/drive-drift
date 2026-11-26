// Car-driven effects: nitro flames, wall sparks, wet-road spray and the headlamp beams.
// Units: metres, seconds, m/s; angles in degrees where the name says so. Colours are linear RGB, 0…1.
// "Car frame" below means: x to the car's right, y up, z to the car's BACK (the nose is at −z).
// Starting values follow docs/research/rendering.md §7 and §8.4 (a local-only document, not in the public repo); design: docs/design/rendering-and-camera.md §9–§10.

type Rgb = [number, number, number];

export const FLAMES = {
  /** The flames follow frame.boost at this rate, 1/s, and are hidden below `minLevel`. */
  rate: 10,
  minLevel: 0.02,
  /** Jet length at boost level 0 and 1, metres. */
  lengthMin: 0.5,
  lengthMax: 1.5,
  /** Jet radius at its widest point at boost level 0 and 1, metres (the tailpipe radius is 0.054). */
  radiusMin: 0.055,
  radiusMax: 0.09,
  /** The jet length wobbles by ± this fraction (two beating sines, a different phase per pipe). */
  lengthFlicker: 0.15,
  /** Brightness flickers by ± this fraction. */
  brightFlicker: 0.15,
  /** Emissive strength of the jet at full boost (HDR: well above 1 so it blooms). */
  intensity: 5,
  /** Sheath colour at the pipe and from mid-length on; the hot core; the tip colour at full surge. */
  colorRoot: [0.42, 0.32, 1] as Rgb,
  colorMid: [0.2, 0.5, 1] as Rgb,
  colorCore: [1, 0.92, 0.85] as Rgb,
  colorSurge: [1, 0.42, 0.08] as Rgb,
  /** The core is this fraction of the sheath's radius and length, and this many times as bright. */
  coreRadius: 0.42,
  coreLength: 0.6,
  coreGain: 1.6,
  /** The surge colour takes over the sheath between these fractions of the jet length. */
  surgeFrom: 0.3,
  surgeTo: 0.85,
  /** The noise pattern runs down the jet at this many jet lengths per second, repeated `noiseTiles` times
   *  along the jet. */
  scroll: 2.6,
  noiseTiles: 1.3,
  /** How far the noise darkens the jet, 0 (no pattern) … 1 (down to black). */
  noiseDepth: 0.5,
  /** Glow sprite at the pipe mouth: half-size at boost level 0 and 1, metres; emissive strength at full
   *  boost; rim and centre colours. */
  glowSizeMin: 0.11,
  glowSizeMax: 0.18,
  glowIntensity: 4,
  glowColor: [0.35, 0.5, 1] as Rgb,
  /** Jet mesh resolution: segments around and along. */
  segmentsAround: 14,
  segmentsAlong: 12,

  /** The two road-only point lights: colour, strength at full boost, reach in metres. */
  lightColor: [0.4, 0.6, 1] as Rgb,
  lightIntensity: 0.6,
  lightRange: 6,
  /** Light strength flickers by ± this fraction. */
  lightFlicker: 0.2,
  /** Where each light sits relative to its tailpipe marker: metres outward (away from the centre line), up
   *  and behind. The pipes are at (±0.35, 0.57, 2.09) in the car frame, so this puts the lights at about
   *  (±0.45, 0.30, 2.70): low behind the bumper. */
  lightOutward: 0.1,
  lightUp: -0.27,
  lightBehind: 0.6,
};

export const SPARKS = {
  /** Scrape sparks fly while car.scrape is above `scrapeMin` and the car is faster than `speedMin`, m/s. */
  scrapeMin: 0.5,
  speedMin: 8,
  /** Particles alive at once (at most), their life in seconds, and the seconds between spawns (random
   *  between the two values). */
  count: 50,
  lifetime: 0.32,
  rate: [0.006, 0.012] as [number, number],
  /** Brightness multiplier (HDR, drives bloom) and streak length in seconds of travel. */
  intensity: 8,
  stretch: 0.12,
  /** Spark half-size at birth and at death, metres. */
  size: [0.05, 0.015] as [number, number],
  /** Colour at birth and at death. */
  colorStart: [1, 0.7, 0.3] as Rgb,
  colorEnd: [1, 0.35, 0.05] as Rgb,
  /** Velocity relative to the car, m/s. Sideways: ± this. */
  sideways: 1.5,
  /** Backwards (opposite to the direction of travel): between these two. */
  backward: [2, 9] as [number, number],
  /** Upwards at birth → at death, for the slowest and the fastest spark (they arc up, then fall). */
  upSlow: [1, -5] as [number, number],
  upFast: [6, -2] as [number, number],
  /** The whole fan is turned this many degrees away from the wall. */
  inwardDeg: 12,
  /** Contact point: height above the road; radius of the spawn ball. */
  height: 0.45,
  spawnRadius: 0.12,
  /** Where along the car the sparks start, metres from its centre: `ahead` (toward the nose) with the car
   *  parallel to the wall, moving to `cornerReach` ahead when the nose points at the wall by `cornerDeg`
   *  or more, and to `cornerReach` behind when the tail does. The point slides there at `slideRate`, 1/s. */
  ahead: 0.5,
  cornerReach: 1.6,
  cornerDeg: 7,
  slideRate: 12,

  /** Impact burst: fired when the wall is hit at more than `burstMinHit` m/s (normal speed), at most once
   *  per `burstCooldown` seconds. The share of `burstCount` sparks shown grows linearly with the impact
   *  speed, from `burstMinShare` to all of them at `burstFullHit` m/s. */
  burstMinHit: 1.5,
  burstFullHit: 12,
  burstMinShare: 0.25,
  burstCooldown: 0.12,
  burstCount: 48,
  burstLifetime: 0.45,
  /** The burst leaves over this many seconds. */
  burstSpread: 0.05,
  burstIntensity: 10,
  burstSize: [0.06, 0.015] as [number, number],
  /** Burst velocity relative to the car, m/s: sideways ± this; backwards between the two values (negative =
   *  forwards); upwards at birth → at death for the slowest and the fastest spark. */
  burstSideways: 5,
  burstBackward: [-3, 6] as [number, number],
  burstUpSlow: [2, -6] as [number, number],
  burstUpFast: [8, -3] as [number, number],
};

export const SPRAY = {
  /** Mist starts above `speedMin` m/s and reaches full density at `speedFull` m/s. */
  speedMin: 12,
  speedFull: 60,
  /** Particles per rear wheel, their life in seconds, seconds between spawns (random between the two). */
  count: 40,
  lifetime: 0.6,
  rate: [0.016, 0.02] as [number, number],
  /** Emitter position: metres behind the rear wheel centre and above the road; radius of the spawn ball. */
  behind: 0.38,
  height: 0.12,
  spawnRadius: 0.08,
  /** Puff half-size at birth and at death, metres, at full density. */
  size: [0.12, 0.5] as [number, number],
  /** Puff size multiplier at `speedMin` (it grows to 1 at `speedFull`). */
  sizeAtMin: 0.6,
  /** Mist colour, and its opacity at the densest point of a puff's life at full density. Keep it low: this
   *  is road spray, not tyre smoke. */
  color: [0.3, 0.33, 0.38] as Rgb,
  opacity: 0.14,
  /** Density is quantised into this many steps (one small texture each). */
  steps: 5,
  /** Velocity relative to the car, m/s: sideways ± this; backwards (opposite to the direction of travel)
   *  between the two values; upwards at birth → at death for the slowest and the fastest puff. */
  sideways: 0.15,
  backward: [2.5, 4.5] as [number, number],
  upSlow: [0.1, 0.3] as [number, number],
  upFast: [0.35, 0.6] as [number, number],
  /** Inside the snow gallery the road is drier and darker: density and brightness are multiplied by these
   *  (blended with frame.tunnel). */
  tunnelDensity: 0.35,
  tunnelBrightness: 0.35,
  /** Soft fade where puffs meet the road, metres; 0 = off. Needs the scene depth map, so leave it at 0
   *  until the post-processing stack provides one. */
  depthSoftening: 0,
};

/** Body parts (render entity names) that cast no shadow: lamps, badge and chrome sit flush on the bodywork, so
 *  the car's shadow is the same without them. Each one saved is a draw call per cascade, per camera. */
export const CAR_NO_SHADOW_PARTS = ['Body_Lights', 'Body_Light_Head', 'Body_Light_Tail', 'Body_Badge', 'Body_Chrome'];

export const CAR_LIGHTS = {
  /** Emissive strength of the lamp materials, always on (the Y-shaped signatures come from their emissive
   *  maps): tail lamps (`Light_Tail`), headlamp lenses (`Light_Head`) and the rest of the lamp atlas (`Lights`).
   *  Above 1 so they bloom. */
  tailGlow: 2.2,
  headGlow: 3.5,
  runningGlow: 1.6,
  /** The tail lamps are this many times brighter with the brake applied. */
  brakeGain: 5,

  /** The headlamps come on when frame.tunnel rises above `tunnelOn`, and fade in and out at `rate`, 1/s. */
  tunnelOn: 0.02,
  rate: 8,
  /** Each dipped beam sits at the headlamp lens centre, this fraction of the lens half-span out from the
   *  car's centre line (the two lenses are one mesh spanning the nose). */
  lampSpread: 0.83,
  /** Beam colour (slightly cold white). */
  color: [0.82, 0.9, 1] as Rgb,
  /** Dipped beams ×2 (they light the road and everything on it): strength, reach in metres, inner and
   *  outer cone half-angles, and how far below the horizontal they point, degrees. */
  dippedIntensity: 4,
  dippedRange: 28,
  dippedInnerDeg: 14,
  dippedOuterDeg: 42,
  dippedDipDeg: 10,
  /** Main beam ×1 at the centre of the nose (lights the road layer only, so it can be strong without
   *  burning out the walls): same fields. */
  mainIntensity: 8,
  mainRange: 45,
  mainInnerDeg: 22,
  mainOuterDeg: 58,
  mainDipDeg: 13,
};
