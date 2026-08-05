import {describe, expect, it} from 'vitest';
import {mapWithConcurrency} from './concurrency';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return {promise, resolve};
}

describe('mapWithConcurrency', () => {
  it('returns results in input order, not completion order', async () => {
    const results = await mapWithConcurrency([30, 20, 10], 3, async (ms) => {
      await new Promise((done) => setTimeout(done, ms));
      return ms;
    });
    expect(results).toEqual([30, 20, 10]);
  });

  it('never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({length: 20}, (_, i) => i), 5, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((done) => setTimeout(done, 1));
      running--;
      return null;
    });
    expect(peak).toBe(5);
  });

  it('runs everything even when there are more items than workers', async () => {
    const seen: number[] = [];
    await mapWithConcurrency(Array.from({length: 50}, (_, i) => i), 4, async (item) => {
      seen.push(item);
      return item;
    });
    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
  });

  // The reason for a shared cursor rather than fixed slices: one slow item must
  // not hold back work the other workers could be doing.
  it('keeps other workers going while one item hangs', async () => {
    const stuck = deferred<void>();
    const finished: number[] = [];
    const all = mapWithConcurrency([0, 1, 2, 3, 4], 2, async (item) => {
      if (item === 0) {
        await stuck.promise;
      }
      finished.push(item);
      return item;
    });

    await new Promise((done) => setTimeout(done, 5));
    expect(finished).toEqual([1, 2, 3, 4]);

    stuck.resolve();
    expect(await all).toEqual([0, 1, 2, 3, 4]);
  });

  it('handles an empty list without starting a worker', async () => {
    let started = false;
    expect(await mapWithConcurrency([], 5, async () => {
      started = true;
      return null;
    })).toEqual([]);
    expect(started).toBe(false);
  });

  it('does not start more workers than there are items', async () => {
    let peak = 0;
    let running = 0;
    await mapWithConcurrency([1, 2], 10, async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((done) => setTimeout(done, 1));
      running--;
      return null;
    });
    expect(peak).toBe(2);
  });
});
