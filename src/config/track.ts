// Track definition. This segment list is the single source of truth for the circuit: the road, kerbs, walls,
// gantry, collision, laps and (later) props are all derived from the centreline it produces.
// Units: metres and degrees. Heading convention: clockwise seen from above, so right turns dominate.

export type TrackSegment =
  | {
      kind: 'straight';
      /** Length in metres. For `solve: true` this is only the initial guess. */
      length: number;
      /** Exactly two straights carry this flag: their lengths are solved so the loop closes. */
      solve?: boolean;
      /** Height gained over the segment, metres (negative = downhill). */
      rise?: number;
      name: string;
    }
  | {
      kind: 'arc';
      /** Centreline radius, metres. */
      radius: number;
      /** Turned angle in degrees, always positive. */
      angle: number;
      dir: 'left' | 'right';
      rise?: number;
      name: string;
    };

export const TRACK = {
  /** Seed for every procedural system that decorates the track. */
  seed: 20261125,
  /** Target spacing of centreline samples, metres. */
  sampleSpacing: 2,
  /** Half-width of the box filter that eases straight↔arc transitions, metres (applied 3×). */
  planSmoothing: 7,
  /** Half-width of the box filter on the height profile, metres (applied 3×). Gives gentle crests and dips. */
  heightSmoothing: 34,
  /** Half-width of the box filter on curvature used for banking, in samples. */
  curvatureSmoothing: 12,
  /** Road elevation at the start line, metres. */
  baseHeight: 6,

  /** Asphalt half width, metres. */
  halfWidth: 9,
  /** Kerb width outside the asphalt, metres. The wall face stands at halfWidth + kerbWidth. */
  kerbWidth: 1,
  /** Kerb outer-edge height above the asphalt, metres. */
  kerbHeight: 0.1,
  /** Length of one red or white kerb block, metres. */
  kerbBlock: 3,
  wallHeight: 1.1,
  wallThickness: 0.5,
  /** Road slab thickness below the surface, metres (visible where the ground falls away). */
  deckDepth: 1.4,

  /** Bank angle = clamp(curvature × bankGain, ±bankMax). Radians per (1/m), radians. */
  bankGain: 14,
  bankMax: (8 * Math.PI) / 180,

  /** Arc length of the start/finish line, metres from the first sample (the main straight starts at 0). */
  finishS: 200,
  /** The car spawns this far before the line (rolling start: the first crossing only starts the clock). */
  spawnBeforeFinish: 24,
  /** A lap only counts after the car has been inside this window of lap fraction. */
  halfLapWindow: [0.45, 0.55] as [number, number],

  /** Corners tighter than this get `>>` chevron boards on the outside, metres (used from M2 on). */
  chevronRadius: 170,

  segments: [
    { kind: 'straight', length: 600, solve: true, name: '湖边主直道' },
    { kind: 'arc', radius: 120, angle: 120, dir: 'right', name: '湖角高速右弯' },
    { kind: 'straight', length: 200, rise: 10, name: '爬坡引道' },
    { kind: 'arc', radius: 65, angle: 90, dir: 'left', rise: 5, name: '爬坡左弯' },
    { kind: 'straight', length: 50, rise: 2, name: 'S 弯连接段' },
    { kind: 'arc', radius: 55, angle: 70, dir: 'right', rise: 3, name: '爬坡右弯' },
    { kind: 'straight', length: 150, rise: 9, name: '走廊引道' },
    { kind: 'arc', radius: 150, angle: 58, dir: 'right', rise: 8, name: '防雪走廊' },
    { kind: 'straight', length: 240, rise: 13, name: '山口引道' },
    { kind: 'arc', radius: 36, angle: 172, dir: 'right', rise: 2, name: '山口发卡弯 1' },
    { kind: 'straight', length: 130, rise: 4, name: '坡顶直道' },
    { kind: 'arc', radius: 140, angle: 105, dir: 'left', name: '坡顶高速长左弯' },
    { kind: 'straight', length: 230, solve: true, rise: -11, name: '下坡引道' },
    { kind: 'arc', radius: 60, angle: 102, dir: 'right', rise: -5, name: '下坡右弯' },
    { kind: 'straight', length: 180, rise: -9, name: '观景台引道' },
    { kind: 'arc', radius: 38, angle: 150, dir: 'left', rise: -3, name: '山口发卡弯 2' },
    { kind: 'straight', length: 420, rise: -20, name: '下山直道' },
    { kind: 'arc', radius: 75, angle: 183, dir: 'right', rise: -8, name: '下山长右弯' },
  ] as TrackSegment[],
};

export type TrackConfig = typeof TRACK;
