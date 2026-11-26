// Seeded 2D value noise and the fractal sums built on it. Pure and integer-hashed (no Math.sin), so the
// landscape is bit-for-bit reproducible across browsers and in Node tests.

function hash2(x: number, z: number, seed: number): number {
  let h = (Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ seed) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise in [0, 1) with smoothstep interpolation; one lattice cell per unit. */
export function vnoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const xf = x - xi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi, seed);
  const b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed);
  const d = hash2(xi + 1, zi + 1, seed);
  return a + (b - a) * u + (c - a + (a - b - c + d) * u) * v;
}

/** Fractal sum of value noise, normalised to [0, 1). */
export function fbm(x: number, z: number, octaves: number, seed: number, lacunarity = 2.07, gain = 0.5): number {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x + o * 17.3, z - o * 9.1, seed + o * 1013);
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    z *= lacunarity;
  }
  return sum / norm;
}

/**
 * Ridged multifractal in [0, 1): sharp crests where the noise crosses its midline, with each octave weighted
 * by the one before it so detail gathers on the ridges and valleys stay smooth.
 */
export function ridged(x: number, z: number, octaves: number, seed: number, lacunarity = 2.03, gain = 0.56): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let weight = 1;
  for (let o = 0; o < octaves; o++) {
    let r = 1 - Math.abs(2 * vnoise(x + o * 5.3, z + o * 2.1, seed + o * 7919) - 1);
    r = r * Math.sqrt(r);
    sum += amp * r * weight;
    norm += amp;
    weight = Math.min(1, r * 1.6);
    amp *= gain;
    x *= lacunarity;
    z *= lacunarity;
  }
  return sum / norm;
}
