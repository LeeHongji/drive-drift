// Sky, sun, shadows and distance fog (docs/design/rendering-and-camera.md §4, track-and-world.md §2.1).
// The post-processing stack has its own file, config/post.ts. Quality-dependent numbers (shadow map size,
// cascades, shadow distance, cloud level) come from config/quality.ts.
//
// Two skies exist. The normal one is the engine's dynamic sky, which is a CameraFrame effect and therefore
// only works when src/render/post.ts has attached a CameraFrame to the main camera. The other is the static
// procedural sky from M1, used when `dynamicSky` is false or when no CameraFrame exists.
//
// Start values are the documented ones from the benchmark game. Nothing here has been tuned by eye yet.

export const RENDER = {
  /** Use the engine's dynamic sky. false = always the static procedural sky. */
  dynamicSky: true,

  /** Sun direction: elevation above the horizon and compass azimuth (0 = −Z, clockwise seen from above), degrees.
   *  The main straight runs along −Z, so 68 puts the sun ahead and to the right of it. Guess: tune by eye. */
  sunElevation: 5,
  sunAzimuth: 68,
  /** Sun strength. With the dynamic sky this is its `sunIntensity`: it scales the sky and the light together,
   *  and the light ends up at sunIntensity × (1 − cloudCoverage × cloudSunDimming). With the static sky it is
   *  the light intensity itself. */
  sunIntensity: 3.4,
  /** true: the dynamic sky sets the sun light's colour and intensity (warm near the horizon, dimmed by clouds).
   *  false: the light keeps `sunColor` × `sunIntensity` and only its direction matches the sky. */
  skyDrivesSun: true,
  /** Directional light colour (sRGB). Used with the static sky, or when `skyDrivesSun` is false. */
  sunColor: [1.0, 0.82, 0.62] as [number, number, number],

  // ── Dynamic sky ──────────────────────────────────────────────────────────────────────────────────────
  /** Atmosphere: haziness (1…20), blueness (0…4), and the size of the glow around the sun (0…0.1, 0…1). */
  turbidity: 4.5,
  rayleigh: 2.4,
  mieCoefficient: 0.007,
  mieDirectionalG: 0.8,
  /** Sky brightness relative to the sun (1 = clear-sky ratio). */
  skyLuminance: 1,
  /** The sun disc is clamped to this radiance so it cannot blow out bloom or overflow the RGBA16F target.
   *  Applied as a patch to the engine's atmosphere shader chunk; 0 leaves the engine's own limit (6000). */
  sunDiscMax: 1500,
  /** Clouds (used when QUALITY.clouds > 0). Fraction of sky covered, edge softness, sunlit brightness. */
  cloudCoverage: 0.24,
  cloudSoftness: 0.5,
  cloudBrightness: 0.34,
  /** Fraction of sunlight the clouds block at full coverage (dims the sun light). */
  cloudSunDimming: 0.6,
  /** Cloud drift speed, m/s, and the direction it drifts toward, degrees. */
  windSpeed: 30,
  windDirection: 45,
  /** Volumetric cloud cost per QUALITY.clouds level 1…3: [render scale 0.25…1, quality 0…1].
   *  Level 1 is what the benchmark game ships; levels 2 and 3 are guesses. */
  cloudLevels: [
    [0.25, 0.3],
    [0.33, 0.4],
    [0.5, 0.5],
  ] as [number, number][],
  /** Resolution of the cubemap the sky lighting is baked from, and of the environment atlas, pixels. */
  lightingResolution: 256,
  atlasSize: 512,

  // ── Static procedural sky (fallback) ─────────────────────────────────────────────────────────────────
  /** Radiance of the sun disc painted into the environment map (drives glints on paint and wet asphalt). */
  sunDiscRadiance: 220,
  /** Angular radius of that disc, degrees (larger than the real sun so it survives the blur). */
  sunDiscSize: 2.2,
  skyZenith: [0.07, 0.19, 0.52] as [number, number, number],
  skyHorizon: [0.95, 0.56, 0.3] as [number, number, number],
  /** Colour seen below the horizon in reflections (ground bounce). */
  skyGround: [0.1, 0.11, 0.09] as [number, number, number],
  /** Cloud cover 0..1 and the colour clouds take where the low sun lights them. */
  cloudCover: 0.42,
  cloudLit: [1.0, 0.72, 0.52] as [number, number, number],
  cloudShade: [0.36, 0.32, 0.42] as [number, number, number],

  // ── Shared ───────────────────────────────────────────────────────────────────────────────────────────
  /** Strength of the environment lighting and reflections (and of the static skybox). */
  skyboxIntensity: 1.0,
  exposure: 1.0,

  /** Distance fog density, 1/m. game.ts writes it to `scene.fog.density` every frame (0 for the aerial
   *  debug camera) and the sky reads it back from there, so that one number drives both skies:
   *  - dynamic sky: density of the sky haze at `hazeBaseHeight`. Distant surfaces fade into the sky colour
   *    behind them; a level view is 95% hidden at about 3 / density (10 km at 0.0003).
   *  - static sky: EXP2 fog density with the fixed colour `fogColor`. */
  fogDensity: 0.0003,
  /** Use the dynamic sky's haze as the distance fog. false keeps the single-colour scene fog. */
  haze: true,
  /** Height over which the haze thins to about a third, and the height where it is densest, metres. */
  hazeHeight: 200,
  hazeBaseHeight: 0,
  /** Scene fog colour (sRGB), matched to the horizon. Used with the static sky, by cameras that have no
   *  dynamic sky (the road reflection camera), and when `haze` is false. */
  fogColor: [0.74, 0.56, 0.46] as [number, number, number],

  /** Sun shadows. Map size, cascade count and distance come from QUALITY. */
  cascadeDistribution: 0.6,
  shadowBias: 0.2,
  normalOffsetBias: 0.06,

};
