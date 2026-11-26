// S4: best lap and best chain survive a page reload (localStorage). Failing storage is not an error.

import { SCORING } from '../config/scoring';

export interface Bests {
  lap: number | null;
  chain: number;
}

export function loadBests(): Bests {
  try {
    const raw = SCORING.persistBests ? localStorage.getItem(SCORING.storageKey) : null;
    if (raw) {
      const v = JSON.parse(raw) as Partial<Bests>;
      return { lap: typeof v.lap === 'number' ? v.lap : null, chain: typeof v.chain === 'number' ? v.chain : 0 };
    }
  } catch {
    // Private mode or a corrupt entry: start fresh.
  }
  return { lap: null, chain: 0 };
}

export function saveBests(b: Bests): void {
  if (!SCORING.persistBests) return;
  try {
    localStorage.setItem(SCORING.storageKey, JSON.stringify(b));
  } catch {
    // Storage full or blocked: bests then last for this session only.
  }
}
