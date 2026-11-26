// Nitro tank and nitro shards (pickups). Rules: docs/design/drift-gameplay.md §3.3; shard placement:
// docs/design/track-and-world.md §5. The tank is a fraction 0…1; speeds in m/s, times in seconds.

export const NITRO = {
  /** Tank level at spawn and after a reset, 0…1. */
  start: 0.6,
  /** Boost can only START above this tank level; once on it runs until released or empty. */
  minStart: 0.08,
  /** Above this level the tank counts as full: firing from here triggers the surge, the HUD shows "MAX". */
  full: 0.99,
  /** Tank drained per second while boosting (a full tank lasts 4 s). */
  drain: 0.25,
  /** Tank regained per second whenever the car is not boosting. */
  refill: 0.015,
  /** Extra tank regained per second while drifting (0.215/s in total: about 4.65 s from empty to full). */
  driftRefill: 0.2,
  /** Boost thrust at standstill, m/s². Replaces the throttle and tapers linearly to 0 at the boost cap. */
  accel: 46,
  /** Boost speed cap, m/s (360 km/h). Benchmark: 106. */
  topSpeed: 100,
  /** Surge (boost fired from a full tank): starts at 1 and falls linearly to 0 over this many seconds. */
  surgeTime: 3,
  /** Thrust multiplier at full surge is 1 + surgeThrust. */
  surgeThrust: 1.2,
  /** Speed added to the boost cap at full surge, m/s. */
  surgeSpeed: 14,
  /** Without boost, speed above CAR.topSpeed falls back at this rate, m/s². */
  bleed: 7,
};

export const SHARDS = {
  /** Shards on one lap. */
  count: 11,
  /** Tank gained per shard. */
  gain: 0.2,
  /** Seconds a collected shard stays away. */
  respawn: 8,
  /** Collection box around a shard, measured from the car centre in track coordinates: the shard may be up
   *  to reachAhead metres ahead of the car or reachBehind metres behind it, and reachLateral metres to
   *  either side. */
  reachAhead: 2.8,
  reachBehind: 2,
  reachLateral: 2.4,

  // ---- placement rule (src/gameplay/pickups.ts) ----
  /** Corners at or under this radius are drift corners: their shard sits just past the exit, on the outside,
   *  where a drift carried all the way out runs wide. Wider corners are sweepers. Metres. */
  driftRadius: 100,
  /** Distance past the end of a drift corner, and lateral offset toward the outside, metres. */
  exitAhead: 10,
  exitOffset: 4,
  /** Sweepers carry their shard mid-corner, this far toward the outside (off the fast inside line), metres. */
  sweeperOffset: 4,
  /** Straights, longest first, get a shard at this fraction of their length, offset toward the INSIDE of the
   *  next corner: taking it costs the ideal outside approach. Metres. */
  straightAt: 0.5,
  straightOffset: 4,
  /** Two shards are never closer than this along the track, metres. */
  minSpacing: 60,
  /** Shards keep at least this far from the asphalt edge, metres. */
  edgeMargin: 1.5,
  /** On a track with no corners at all the first shard sits this far past the finish line, metres. */
  fillStart: 120,
};

/** Shard look and animation (src/vfx/pickups-visual.ts). Metres, seconds, degrees. */
export const SHARD_VISUAL = {
  /** Crystal size: across the flats of the hexagon, and tip to tip. */
  width: 0.95,
  height: 1.7,
  /** Share of the height taken by the upper point, the hexagonal waist and the lower point (sums to 1). */
  topShare: 0.3,
  waistShare: 0.12,
  /** Height of the crystal's centre above the road, and the amplitude and period of its bobbing. */
  hover: 1.15,
  bob: 0.12,
  bobPeriod: 2.4,
  /** Spin rate, degrees per second. */
  spin: 120,
  /** Each shard's spin and bob run this fraction of a cycle ahead of the previous shard's. */
  stagger: 0.37,
  /** Emissive colour (linear RGB) and intensity: well above 1 so the bloom pass picks it up. */
  color: [0.3, 0.82, 1] as [number, number, number],
  emissiveIntensity: 6,
  /** Darkest facet as a fraction of the brightest (facet shading baked into vertex colours). */
  facetMin: 0.35,
  /** Collected shards fly to a point this high above the car's road contact, over absorbTime, easing in. */
  absorbHeight: 0.6,
  absorbTime: 0.16,
  /** Scale left at the end of the absorb flight (the shard shrinks into the car). */
  absorbScale: 0.15,
  /** A respawned shard grows back in over this long. */
  appearTime: 0.35,
};
