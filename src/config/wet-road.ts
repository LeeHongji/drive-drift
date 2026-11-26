// Wet asphalt look (docs/design/rendering-and-camera.md §6). Lengths in metres, sizes in pixels.

export const WET_ROAD = {
  /** Road length covered by one repeat of the base colour texture. Holds one centre-line dash. */
  tileLength: 12,
  /** Centre-line dash length within each tile, edge line distance from the asphalt edge, and paint width. */
  dashLength: 4,
  edgeLineInset: 0.45,
  lineWidth: 0.15,
  /** 1024² over 18 × 12 m is 1.2–1.8 cm per pixel; finer grain comes from the normal map. (2048² cost 21 MB.) */
  diffuseSize: 1024,
  glossSize: 512,
  normalSize: 512,
  anisotropy: 16,

  /** Gloss range the map spans: drier patches … standing water. */
  glossMin: 0.42,
  glossMax: 0.98,
  /** Width of the polished wheel tracks, as a fraction of the road width (gaussian sigma). */
  trackPolishWidth: 0.035,
  /** Gloss map repeats along the road relative to the base tile (0.2 → one repeat per 60 m). */
  glossTilingAlong: 0.2,
  /** Fresnel reflectivity of the surface (water film over tarmac). */
  reflectivity: 0.75,

  /** Asphalt grain normal: repeats across and along one base tile, and strength. */
  normalTiling: [9, 6] as [number, number],
  grainBumpiness: 0.55,

  /** Rain ripples: frame count and size, drops per tile, loop time in seconds. */
  rippleFrames: 16,
  rippleSize: 128,
  rippleDrops: 16,
  rippleLoop: 1.1,
  /** Largest ring radius as a fraction of the ripple tile. */
  rippleRadius: 0.16,
  /** Repeats across and along one base tile: 30 × 20 makes a ripple tile 0.6 m, so rings reach ~0.2 m across. */
  rippleTiling: [30, 20] as [number, number],
  rippleBumpiness: 0.3,
};
