// Handling regression: every replay in tests/replays must stay inside its expected ranges.
// After a deliberate tuning change, update the ranges in the JSON and say why in the change description.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runReplay, type Replay } from './replay-runner';

const dir = join(__dirname, 'replays');
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('._'));

describe('input replays', () => {
  it('finds the replay files', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });
  for (const file of files) {
    const replay = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Replay;
    it(`${replay.scenario} ${replay.name}`, () => {
      const { metrics, probes } = runReplay(replay);
      for (const [metric, [lo, hi]] of Object.entries(replay.expect)) {
        const v = metrics[metric];
        expect(v, `${metric} = ${v}, expected ${lo}…${hi}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${metric} = ${v}, expected ${lo}…${hi}`).toBeLessThanOrEqual(hi);
      }
      (replay.probes ?? []).forEach(([metric, at, lo, hi], i) => {
        const v = probes[i];
        expect(v, `${metric} at ${at}s = ${v}, expected ${lo}…${hi}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${metric} at ${at}s = ${v}, expected ${lo}…${hi}`).toBeLessThanOrEqual(hi);
      });
    });
  }
});
