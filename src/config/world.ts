// Landscape and trackside dressing (docs/design/track-and-world.md §3 steps 5–9). Everything the world
// generator can be tuned with lives here. Units: metres, radians, seconds; colours are linear RGB 0…1.
// All of it is derived from the track centreline and TRACK.seed, so the same config gives the same world.

type Rgb = [number, number, number];

/** sRGB hex → linear RGB, for colours that are easier to pick as hex. */
function hex(h: string): Rgb {
  const n = parseInt(h.slice(1), 16);
  const c = (v: number): number => Math.pow(v / 255, 2.2);
  return [c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)];
}

export const WORLD = {
  terrain: {
    /** Fine grid cell near the track, metres. */
    cell: 4,
    /** Far grid cell = cell × coarseRatio (the two grids share vertices along their seam). */
    coarseRatio: 4,
    /** The fine grid covers the track's bounding box plus this margin, metres. */
    innerMargin: 200,
    /** The far grid extends this much further on every side, metres. */
    outerMargin: 1400,
    /** Width of the band at the edge of the fine grid where it eases onto the far grid's surface, metres. */
    seamBand: 48,
    /** Cells per render chunk (fine and far), so chunks can be frustum-culled. */
    chunkCells: 80,
    chunkCellsFar: 64,

    /** Conforming to the road: the ground sits `drop` below the banked road plane out to `flatDist` from the
     *  centreline and returns to the natural height by `blendDist`. */
    drop: 0.6,
    flatDist: 20,
    blendDist: 70,
    /** The road's bank is extrapolated sideways only this far when flattening, metres. */
    bankReach: 14,
    /** Ground lower than the road is filled up to it only when the gap is small: fully below `fillFull`,
     *  not at all above `fillNone` (the road then crosses on a viaduct with piers), metres. */
    fillFull: 3,
    fillNone: 9,
    /** Radius of the per-sample stamp that builds the distance field, metres (≥ blendDist + 2 cells). */
    stampRadius: 84,

    /** Guide grid cell (smooth "follow the road's height" surface and far distance field), metres. */
    guideCell: 32,
    /** Softening length of the inverse-distance weights behind the guide surface, metres. */
    guideSoftness: 34,

    /** Rolling hills: fbm wavelength (metres) and amplitude near the track / far from it (± metres). */
    hillWavelength: 430,
    hillAmpNear: 9,
    hillAmpFar: 34,
    /** Distance from the track over which the hill amplitude grows from near to far, metres. */
    hillNear: 40,
    hillFar: 380,
    /** Small-scale roughness on open ground: wavelength and amplitude, metres. */
    bumpWavelength: 46,
    bumpAmp: 1.1,
    /** Ravines the road bridges on piers. Each is cut across the track at arc length `s` (metres), running
     *  `reach` metres to either side; `halfWidth` is half its width at the rim, `depth` its depth, metres.
     *  Keep them on straights and away from the gallery and the start line. */
    ravines: [
      { s: 1640, halfWidth: 38, depth: 17, reach: 130 },
      { s: 2350, halfWidth: 34, depth: 15, reach: 120 },
      { s: 3000, halfWidth: 44, depth: 18, reach: 150 },
    ],
    /** How far a ravine's course wanders sideways away from the road, metres. */
    ravineWander: 22,

    /** Mountain ring: starts rising this far from the track and is at full height by ringFull, metres. */
    ringStart: 230,
    ringFull: 1050,
    /** Height of the ring's base swell, the rolling part and the ridged peaks, metres. */
    ringBase: 70,
    ringRoll: 120,
    peakHeight: 360,
    /** Ridged noise base wavelength and domain-warp reach, metres. */
    ridgeWavelength: 520,
    warp: 130,
    /** Dolomite terraces: cliff bands every `terraceStep` metres of height, blended in by `terraceMix` 0…1. */
    terraceStep: 58,
    terraceMix: 0.5,
    /** The ring is lowered around the sun's azimuth so the low sun is not behind a mountain:
     *  full gap within sunGapInner degrees of it, none beyond sunGapOuter; height factor inside the gap. */
    sunGapInner: 26,
    sunGapOuter: 58,
    sunGapHeight: 0.1,

    /** Terrain casts sun shadows (costs one more pass per cascade; off like M1). */
    castShadows: false,
    /** Terrain surface gloss. */
    gloss: 0.12,
    /** World size of one repeat of the ground detail texture, metres, and its contrast 0…1. */
    detailTile: 23,
    detailContrast: 0.34,
  },

  /** Ground colours (linear). */
  palette: {
    meadowLush: [0.06, 0.13, 0.028] as Rgb,
    meadowDry: [0.2, 0.18, 0.07] as Rgb,
    /** Dark conifer forest painted on the foothills where no tree meshes stand. */
    forest: [0.022, 0.048, 0.022] as Rgb,
    alpine: [0.15, 0.17, 0.075] as Rgb,
    /** Pale dolomite, its darker strata, and scree below the cliffs. */
    rock: [0.44, 0.41, 0.36] as Rgb,
    rockDark: [0.28, 0.26, 0.23] as Rgb,
    scree: [0.36, 0.33, 0.29] as Rgb,
    earth: [0.11, 0.09, 0.06] as Rgb,
    snow: [0.78, 0.8, 0.84] as Rgb,
    /** Gravel verge beside the walls, pebble beach, and the lake bed seen through shallow water. */
    verge: [0.27, 0.25, 0.22] as Rgb,
    shore: [0.36, 0.33, 0.28] as Rgb,
    lakeBed: [0.03, 0.06, 0.06] as Rgb,
  },
  /** Where the ground colours change. */
  zones: {
    /** Rock replaces grass as the slope (1 − normal.y) goes from rockSlope0 to rockSlope1. */
    rockSlope0: 0.1,
    rockSlope1: 0.26,
    /** Gravel verge: full at vergeNear metres from the centreline, gone by vergeFar. */
    vergeNear: 11,
    vergeFar: 17,
    /** Forest colour between the foothills' start and the treeline (height above the lake, metres). */
    treeline: 175,
    treelineBlend: 45,
    /** Snow above this height over the lake on slopes gentler than snowSlope, metres. */
    snowLine: 410,
    snowBlend: 70,
    snowSlope: 0.42,
    /** Pebble beach up to this far above the water, metres. */
    shoreHeight: 0.9,
  },

  lake: {
    /** The lake lies on the outside of the circuit along this segment (TRACK.segments[].name). */
    segment: '湖边主直道',
    /** Water level = lowest road height along that segment − levelBelowRoad, metres. */
    levelBelowRoad: 2.6,
    /** Lake bed depth below the water, metres. */
    depth: 6,
    /** The bank starts falling this far from the centreline and reaches the bed shoreWidth further out. */
    shoreStart: 13,
    shoreWidth: 40,
    /** Basin outline: ellipses in the segment's frame. `along` is measured from the segment's midpoint in the
     *  driving direction, `out` toward the outside of the circuit; radii in metres. */
    basins: [
      { along: 20, out: 400, rAlong: 640, rOut: 480 },
      { along: -610, out: 30, rAlong: 260, rOut: 330 },
    ],
    /** Width of the far shore's slope as a fraction of the basin radius, and its outline wobble (fraction). */
    edge: 0.16,
    wobble: 0.1,
    /** Mountains climb away from the far shore: at the waterline they stand at farShoreHeight of their full
     *  height, reaching it farShoreRise basin radii further out. */
    farShoreHeight: 0.14,
    farShoreRise: 0.55,
    /** Natural ground outside the lake never drops closer than this to the water level, metres; minClear is
     *  the hard floor that also holds where the road's bank pushes the ground down. */
    minAbove: 1.2,
    minClear: 0.35,
    /** Water: reflection tint (linear), gloss, ripple normal strength, ripple size (m) and drift (m/s). */
    color: [0.36, 0.5, 0.56] as Rgb,
    /** Mostly metallic: the sheet mirrors the sky and mountains, tinted by `color`. A dielectric water
     *  surface only reflects at grazing angles and reads as dark mud from the road. */
    metalness: 0.85,
    gloss: 0.93,
    ripple: 0.22,
    rippleTile: 14,
    rippleSpeed: [0.35, 0.22] as [number, number],
    /** How often the ripple offset is pushed to the material, per second. */
    rippleRate: 20,
    /** The water plane reaches this far beyond the basin's bounding box, metres. */
    planeMargin: 80,
  },

  trees: {
    /** Hard cap (design budget ≤ 400). */
    maxCount: 400,
    /** One cluster slot per side every clusterSpacing metres of track; `fill` of them are used. */
    clusterSpacing: 22,
    fill: 0.78,
    /** Cluster centre distance from the centreline, metres. */
    latMin: 26,
    latMax: 150,
    /** Trees per cluster: 1 … clusterMax (skewed toward few). */
    clusterMax: 7,
    /** Minimum distance from the centreline, between trees, and height above the lake, metres. */
    minTrackDist: 19,
    minSpacing: 6.5,
    minAboveLake: 0.9,
    /** No trees on ground steeper than this gradient (rise over run). */
    maxSlope: 0.75,
    /** Uniform scale range, and extra height-only jitter (±). */
    scaleMin: 0.85,
    scaleMax: 1.5,
    heightJitter: 0.12,
    /** Instancing groups are split into square cells of this size so they can be culled, metres. */
    cell: 420,
    /** Trunk sinks this far into the ground so slopes do not expose its base, metres. */
    sink: 0.4,
    /** Species colours (linear): spruce, golden larch, broadleaf; `Dark` is the shaded inside of the crown. */
    spruce: [0.03, 0.075, 0.03] as Rgb,
    spruceDark: [0.008, 0.022, 0.012] as Rgb,
    larch: [0.42, 0.25, 0.035] as Rgb,
    larchDark: [0.14, 0.075, 0.015] as Rgb,
    broadleaf: [0.1, 0.17, 0.03] as Rgb,
    broadleafDark: [0.025, 0.05, 0.012] as Rgb,
    bark: [0.1, 0.075, 0.055] as Rgb,
    gloss: 0.18,
  },

  grass: {
    /** Our blades are several times wider than real ones, so only this fraction of QUALITY.grassDensity
     *  (blades per m²) is planted in the finest ring; coverage stays the same. */
    densityScale: 0.125,
    /** Side of a tile in the finest ring, metres. Each coarser ring doubles it and quarters the density. */
    tile: 16,
    /** Blades per tuft (one tuft = one instance). */
    blades: 12,
    /** The innermost `detailRings` rings use 3-triangle blades, the rest single triangles. */
    detailRings: 1,
    /** Blade size in the finest ring, metres; each coarser ring multiplies the width by `widen` (capped at
     *  maxWidth) and grows 15 % taller. */
    height: 0.55,
    heightJitter: 0.4,
    width: 0.1,
    widen: 1.9,
    maxWidth: 0.7,
    /** Radius of a tuft as a fraction of the spacing between tufts (≥ 0.5 leaves no bare gaps). */
    spreadFactor: 0.6,
    /** No grass closer than this to the centreline (outer wall face + margin); thin until fadeDist. */
    minTrackDist: 11.3,
    fadeDist: 17,
    /** No grass on ground steeper than this gradient, within this height of the lake, or above this height
     *  over the lake (rock and snow country), metres. */
    maxSlope: 0.55,
    minAboveLake: 0.35,
    maxAboveLake: 190,
    /** New tiles built per frame while the car moves (the rest wait a frame). */
    buildsPerFrame: 3,
    /** Colours (linear): blade base and tip for lush and dry blades; share of dry blades in a tuft. */
    lushBase: [0.02, 0.048, 0.01] as Rgb,
    lushTip: [0.1, 0.2, 0.04] as Rgb,
    dryBase: [0.07, 0.06, 0.022] as Rgb,
    dryTip: [0.36, 0.3, 0.11] as Rgb,
    dryShare: 0.3,
    gloss: 0.16,
  },

  banners: {
    /** Banners run through every corner (radius under cornerRadius) plus this lead-in/out, metres. */
    cornerRadius: 260,
    lead: 24,
    /** One board's length along the wall and the strip's bottom/top above the road plane, metres. */
    boardLength: 6,
    bottom: 0.2,
    top: 1.04,
    /** Stand-off from the wall face so the two never z-fight, metres. */
    standOff: 0.03,
    emissive: 0.12,
    /** Fictional sponsors: [name, background, text colour]. No real brands. */
    sponsors: [
      ['TORNANTE', '#d7f205', '#101210'],
      ['CIMADORO', '#101216', '#f4f4f0'],
      ['DERAPATA', '#ff8a1f', '#14110d'],
      ['LAGOSCURO', '#0f3b46', '#e9f4f2'],
      ['NIVALE GOMME', '#f1efe8', '#b3261e'],
      ['APICE NOVE', '#14110d', '#ff8a1f'],
      ['VENTOSUD', '#b3261e', '#f6f1e6'],
      ['DRIVE CUP', '#f1efe8', '#101210'],
    ] as [string, string, string][],
  },

  chevrons: {
    /** One board every `spacing` metres on the outside of corners tighter than TRACK.chevronRadius. */
    spacing: 16,
    /** Board size, and the gap between the wall top and the board's lower edge, metres. */
    width: 3,
    height: 1.5,
    lift: 0.25,
    /** Arrow and background colours (sRGB hex) and glow strength. */
    arrow: '#ff8a1f',
    background: '#0c0c0e',
    emissive: 2.2,
  },

  lamps: {
    /** One lamp every `spacing` metres, alternating sides. */
    spacing: 48,
    /** Pole height, how far the arm reaches over the road, and pole radius at the base, metres. */
    height: 8.6,
    reach: 2.6,
    radius: 0.13,
    /** Lens glow colour (linear) and strength. */
    glow: [1.0, 0.72, 0.42] as Rgb,
    emissive: 3.5,
  },

  posts: {
    /** A marker post on both wall tops every `spacing` metres. */
    spacing: 100,
    /** Post width and height above the wall top, metres. */
    width: 0.22,
    height: 0.75,
  },

  piers: {
    /** A pier is considered every `spacing` metres and built where the road is more than minGap above the
     *  ground under it. */
    spacing: 24,
    minGap: 4.5,
    /** Where the ground is below the deck by less than this, the gap is walled in as an abutment; deeper
     *  than this the span is left open, metres. */
    abutmentMax: 6.5,
    /** Two columns at ± columnOffset from the centreline, columnSize square, buried `bury` into the ground. */
    columnOffset: 6,
    columnSize: 1.8,
    bury: 3,
    /** Cap beam: length across the road, depth, and length along the road, metres. */
    capWidth: 21,
    capDepth: 1.4,
    capLength: 2.2,
  },

  gallery: {
    /** The snow gallery covers this segment (TRACK.segments[].name). */
    segment: '防雪走廊',
    /** tunnelFactor ramps over this length centred on each portal, metres. */
    portalBlend: 30,
    /** Which side has the arched openings: 'auto' picks the side facing the sun (RENDER.sunAzimuth). */
    openSide: 'auto' as 'auto' | 'left' | 'right',
    /** Target length of one bay (a pier plus an arched opening); adjusted so bays fill the gallery exactly. */
    bayLength: 7.5,
    /** Width of the pier between two openings, along the track, metres. */
    pierWidth: 1.7,
    /** Thickness of the arcade wall, the closed wall and the roof slab, metres. */
    arcadeThickness: 0.9,
    wallThickness: 0.7,
    roofThickness: 0.8,
    /** Ceiling height, the height where the arches start to curve, and their crown, above the road plane. */
    ceiling: 6.6,
    spring: 3.4,
    crown: 5.8,
    /** Segments per arch curve. */
    archSegments: 10,
    /** Ceiling ribs: one per bay, this deep and this wide, metres. */
    ribDepth: 0.45,
    ribWidth: 0.5,
    /** Concrete colours (linear): sunlit outside, shaded inside. */
    concrete: [0.3, 0.29, 0.28] as Rgb,
    interior: [0.2, 0.2, 0.21] as Rgb,
    /** Neon strips on the closed wall: [colour (linear), bottom, top above the road plane]. */
    neon: [
      { color: hex('#d7f205'), bottom: 1.95, top: 2.13 },
      { color: hex('#ff8a1f'), bottom: 5.35, top: 5.5 },
    ],
    neonEmissive: 5,
    /** Coloured fill lights along the closed wall (0 = none): intensity, range (m), height (m). */
    lightCount: 5,
    lightIntensity: 1.2,
    lightRange: 24,
    lightHeight: 3.2,
    /** The hillside behind the closed wall rises to roof level between these distances from the centreline. */
    hillStart: 17.5,
    hillFull: 34,
  },
};

export type WorldConfig = typeof WORLD;
