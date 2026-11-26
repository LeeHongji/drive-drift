// Speed blur and lens droplets (docs/design/rendering-and-camera.md §5).

export const LENS = {
  /** Radial blur strength (fraction of the distance to the screen centre) per unit of boost and surge. */
  blurBoost: 0.11,
  blurSurge: 0.05,
  /** Speed-line brightness: from speed alone (× speedRatio²), from boost, and from surge. */
  streaksSpeed: 0.05,
  streaksBoost: 0.16,
  streaksSurge: 0.1,
  /** Droplet coverage at rest and what full speed adds (0…1 scales the bead height). */
  dropletsBase: 0.6,
  dropletsSpeed: 0.4,
  /** How fast the lens dries inside the gallery and gets wet again outside, 1/s. */
  dryRate: 0.5,
  wetRate: 0.8,
};
