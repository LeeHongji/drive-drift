// Post-processing stack on the main camera (docs/design/rendering-and-camera.md §4): tone mapping, sharpening,
// bloom, vignette, colour grading, fringing, auto exposure, volumetric fog and the sun's lens flare.
// MSAA samples and the volumetric fog step count / resolution come from config/quality.ts.
//
// Start values are the documented ones from the benchmark game. Nothing here has been tuned by eye yet;
// values marked "guess" have no documented source.

export const POST = {
  /** CAS sharpening, 0…1. */
  sharpness: 0.2,

  /** Nitro "kick": jumps to 1 on the frame the boost starts and falls at this rate per second (0.4 s). */
  kickDecay: 2.5,

  /** Bloom (needs an HDR scene target; the engine turns it off on an 8-bit one).
   *  intensity × (1 + boost·`boost` + kick·`kick` + surge·`surge`). */
  bloom: {
    intensity: 0.022,
    boost: 0.5,
    kick: 1,
    /** Guess: the design only names boost and kick. */
    surge: 0.25,
    /** Number of blur passes; the engine stops early when the image gets too small. */
    blurLevel: 16,
  },

  /** Vignette. intensity + boost·`boost` + surge·`surge`. `inner`…`outer` is the darkening band, in units
   *  of the half-screen (1 = edge of the screen). */
  vignette: {
    intensity: 0.35,
    boost: 0.12,
    /** Guess. */
    surge: 0.04,
    inner: 0.45,
    outer: 1.15,
    curvature: 0.5,
  },

  /** Colour grading. `tint` is a linear RGB multiplier; try a slightly warm one for the golden-hour look. */
  grading: {
    saturation: 1.1,
    contrast: 1.05,
    brightness: 1,
    tint: [1.05, 0.99, 0.9] as [number, number, number],
  },

  /** Chromatic fringing. intensity + boost·`boost` + kick·`kick` + surge·`surge`; the red/blue offset at the
   *  screen corner is about intensity / 4096 of the screen. Off (0) outside the nitro. */
  fringing: {
    intensity: 0,
    boost: 20,
    kick: 26,
    /** Guess. */
    surge: 8,
  },

  /** Auto exposure. The exposure correction stays within minEv…maxEv stops, so it can only brighten (the
   *  tunnel), never darken. `compensation` shifts the metered target, stops. Speeds are 1/s. */
  exposure: {
    /** `auto` meters the image with the engine's histogram effect (three extra passes and a read-back every
     *  frame). `tunnel` costs nothing: outdoors the metering sat at its lower limit anyway (EV 0), so the
     *  only place exposure ever moved was the snow gallery, and the game knows when the car is in it. */
    mode: 'tunnel' as 'tunnel' | 'auto',
    /** `tunnel` mode: stops added well inside the gallery. */
    tunnelEv: 0.5,
    enabled: true,
    minEv: 0,
    maxEv: 0.7,
    compensation: -1.2,
    speedLightToDark: 1.2,
    speedDarkToLight: 2.5,
    /** Share of the darkest and brightest pixels left out of the metering, and the weight of the centre. */
    lowPercent: 0.1,
    highPercent: 0.9,
    centerWeight: 0.5,
  },

  /** Volumetric fog lit by the sun, with shafts where the sun's shadow map says so. On when
   *  QUALITY.fogSteps > 0. This is a near-field effect; the far distance fog is RENDER.fogDensity. */
  fog: {
    /** Density at `heightBase`, 1/m, and how fast it thins with height, 1/m. */
    density: 4e-4,
    heightBase: 0,
    heightFalloff: 0.02,
    /** Brightness of the sunlit fog, and of the unlit part. */
    intensity: 0.6,
    ambientIntensity: 0.01,
    /** 0 = scatters evenly, towards 1 = glows only around the sun. */
    anisotropy: 0.75,
    /** The fog is marched this far from the camera, metres. */
    maxDistance: 260,
  },

  /** Lens flare of the sun. On when QUALITY.lensEffects is set. All elements sit on the sun (offset 0).
   *  `size` is the half-height of the element in half-screens; `aspect` stretches its width.
   *  The four shapes are drawn procedurally in src/render/post.ts (the engine package ships no shape
   *  textures), so their exact look differs from the benchmark game's. */
  flare: {
    intensity: 0.3,
    /** Resolution of the flare buffer relative to the scene. */
    scale: 0.5,
    /** Size of each generated shape texture, pixels (the star's thin spikes want 512). */
    shapeSize: 256,
    /** Radius around the sun in which occlusion is measured (fraction of screen height), and how long the
     *  flare takes to follow a change, seconds. */
    occlusionRadius: 0.02,
    occlusionFade: 0.15,
    elements: [
      { shape: 'glow_soft', size: 0.2, aspect: 1, color: [1, 0.8, 0.55], intensity: 0.12 },
      { shape: 'burst_star', size: 1.1, aspect: 1, color: [1, 0.93, 0.8], intensity: 0.7 },
      { shape: 'anamorphic_streak', size: 0.08, aspect: 18, color: [1, 1, 1], intensity: 0.7 },
      { shape: 'halo', size: 0.5, aspect: 1, color: [1, 0.9, 0.8], intensity: 0.06 },
    ] as { shape: FlareShape; size: number; aspect: number; color: [number, number, number]; intensity: number }[],
  },
};

export type FlareShape = 'glow_soft' | 'burst_star' | 'anamorphic_streak' | 'halo';
