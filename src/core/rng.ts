/** Seeded PRNG (mulberry32). Every procedural system draws from one of these so results are reproducible. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  /** Independent stream derived from this one, so adding draws in one system does not shift another. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}
