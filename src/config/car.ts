// Huracán STO handling and dimensions. Units: metres, seconds, radians unless a name says otherwise.
// The "reference" comments give the benchmark game's value where ours differs (see docs/design/drift-gameplay.md §4).

export const CAR = {
  // ---- dimensions (real car: 4549 × 1945 × 1220 mm, wheelbase 2620 mm) ----
  wheelbase: 2.62,
  /** Distance between left and right wheel centres. */
  trackWidth: 1.66,
  /** Half body width used for wall contact. */
  halfWidth: 0.97,
  /** Half body length used for wall contact when the car is at an angle to the wall (real: 2.27 m; the
   *  corners are rounded, so a nose at 45° touches later than a box would). */
  halfLength: 1.9,
  /** How much of the angled reach counts, 0…1. 0 = the wall only sees the car's width whatever its angle
   *  (benchmark behaviour: forgiving, but the nose can sink into the wall); 1 = full oriented box. */
  wallAngleReach: 0.5,
  /** Gap kept between the body side and the wall face, metres. */
  wallMargin: 0.1,

  // ---- longitudinal ----
  /** Throttle acceleration at standstill, m/s². Tapers linearly to 0 at topSpeed.
   *  Benchmark value: the drift model is balanced around it (thrust against drift drag decides whether a
   *  drift holds its speed). It is quicker than the real car: 0–100 km/h in 2.4 s against the official 3.0 s. */
  engineAccel: 14,
  /** Top speed without nitro, m/s (310 km/h, the real car's). Benchmark: 80. */
  topSpeed: 86,
  /** Brake deceleration while rolling forward, m/s² (benchmark value). Works in a drift too. */
  brakeDecel: 34,
  /** Reverse acceleration, m/s², and reverse speed cap, m/s. */
  reverseAccel: 14,
  reverseSpeed: 14,
  /** Coasting deceleration: rollingDrag + aeroDrag·v², m/s². */
  rollingDrag: 0.6,
  aeroDrag: 5e-4,
  /** Extra deceleration = cornerScrub·|yawRate·v| above scrubMinSpeed. */
  cornerScrub: 0.03,
  /** Extra deceleration with a wheel on the kerb, m/s². */
  kerbDrag: 2.2,
  /** Speed below which scrub and kerb drag are ignored, m/s. */
  scrubMinSpeed: 5,
  /** Below this speed with no pedal input the car is snapped to rest, m/s. */
  restSpeed: 0.3,

  // ---- steering and yaw (grip mode) ----
  /** Steering slew toward a same-sign input, and when centring or reversing, 1/s. */
  steerRateIn: 16,
  steerRateOut: 18,
  /** Yaw rate follows its target at this rate, 1/s (≈27 ms time constant). */
  yawResponse: 32,
  /** Low-speed yaw cap is v / minTurnRadius (benchmark value). */
  minTurnRadius: 7,
  /** Max yaw rate against speed, [km/h, deg/s], smoothstep between rows. */
  yawRateTable: [
    [0, 130],
    [70, 120],
    [145, 72],
    [215, 58],
    [290, 52],
    [400, 47],
  ] as [number, number][],
  /** Lateral velocity decays at this rate in grip mode, 1/s; its energy is given back as forward speed. */
  gripLateralDecay: 12,
  /** Speed above which grip mode preserves the speed magnitude, m/s. */
  gripKeepSpeed: 1,

  // ---- walls ----
  wallRestitution: 0.25,
  /** Fraction of speed lost per m/s of normal impact speed, and its cap. */
  wallLossPerSpeed: 0.022,
  wallLossMax: 0.55,
  /** Fraction of speed lost per second while sliding along the wall. */
  wallSlideLoss: 0.35,
  /** How strongly an impact twists the car parallel to the wall: min(max, vn·perSpeed + perSecond·dt). */
  wallAlignPerSpeed: 0.03,
  wallAlignPerSecond: 2,
  wallAlignMax: 0.3,
  /** Normal impact speed above which a hit counts as a crash (ends the drift, wipes the chain), m/s. */
  crashSpeed: 3,
  /** `scrape` (1 while touching a wall) decays at this rate, 1/s. */
  scrapeDecay: 4,

  // ---- gearbox and revs (cosmetic: thrust never reads the gear) ----
  /** Upshift speed for gears 1..7, m/s. Also the speed where rpm reaches 1.0 in that gear. */
  gearTop: [16, 27, 38, 50, 63, 76, 100],
  /** Downshift when speed drops below this fraction of the previous gear's top. */
  downshiftRatio: 0.75,
  idleRpm: 0.12,
  /** rpm follows its target at this rate, 1/s. */
  rpmSmooth: 9,
  /** Tachometer scale for the HUD. */
  rpmGaugeMax: 9000,
  rpmRedline: 8500,

  // ---- cosmetic body motion (damped springs [stiffness, damping]) ----
  suspSpring: [210, 15] as [number, number],
  diveSpring: [150, 13] as [number, number],
  leanSpring: [140, 12] as [number, number],
  /** Roll target = clamp(yawRate·speed·leanPerLatAccel, ±leanMax) + slip·leanPerSlip, radians. */
  leanPerLatAccel: 0.0016,
  leanMax: 0.05,
  leanPerSlip: 0.05,
  /** Pitch target = clamp(accel·divePerAccel, −diveBrake, +diveSquat), radians (+ = nose up). */
  divePerAccel: 0.0028,
  diveBrake: 0.055,
  diveSquat: 0.035,
  /** Front wheels turn this far at full lock at standstill, degrees; reduced with speed. */
  wheelSteerDeg: 22,
  /** In a drift the front wheels show counter-steer up to this angle, degrees. */
  wheelCounterSteerDeg: 30,
  wheelRadiusFront: 0.34,
  wheelRadiusRear: 0.355,
};
