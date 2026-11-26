// Small scalar helpers shared by the simulation. No engine imports: this file must run headless.

export const DEG = Math.PI / 180;
export const KMH = 1 / 3.6; // km/h → m/s

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const sign = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wrap an angle to (−π, π]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % (2 * Math.PI);
  if (a <= 0) a += 2 * Math.PI;
  return a - Math.PI;
}

/** Move `current` toward `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  return current + clamp(target - current, -maxDelta, maxDelta);
}

/** Frame-rate independent exponential smoothing factor for a rate in 1/s. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Positive modulo. */
export const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Deterministic 1D value noise in [0, 1], C1-continuous. */
export function valueNoise(x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number): number => {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  return lerp(h(i), h(i + 1), f * f * (3 - 2 * f));
}
