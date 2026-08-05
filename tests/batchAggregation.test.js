import { describe, expect, it } from 'vitest';
import {
  partitionBatchItems,
  planCacheSeededBatches,
} from '../src/core/batchAggregation.js';

describe('partitionBatchItems', () => {
  it('preserves order while enforcing request-count and byte limits', () => {
    const items = [
      { id: 'a', jsonl: 'aaaa\n' },
      { id: 'b', jsonl: 'bbbb\n' },
      { id: 'c', jsonl: 'cccc\n' },
    ];

    expect(
      partitionBatchItems(items, { maxRequests: 2, maxBytes: 10 })
        .map((partition) => partition.map((item) => item.id))
    ).toEqual([['a', 'b'], ['c']]);
  });

  it('places one compatible cache seed before partitioned readers', () => {
    const items = [
      { id: 'a', jsonl: 'aaaa\n', promptCacheKey: 'shared' },
      { id: 'b', jsonl: 'bbbb\n', promptCacheKey: 'shared' },
      { id: 'c', jsonl: 'cccc\n', promptCacheKey: 'shared' },
    ];

    const plan = planCacheSeededBatches(items, {
      maxRequests: 2,
      maxBytes: 10,
    });

    expect(plan.seeded).toBe(true);
    expect(
      plan.batches.map((partition) => partition.map((item) => item.id))
    ).toEqual([['a'], ['b', 'c']]);
  });

  it('does not seed a cohort containing different cache keys', () => {
    const plan = planCacheSeededBatches([
      { id: 'a', jsonl: 'aaaa\n', promptCacheKey: 'first' },
      { id: 'b', jsonl: 'bbbb\n', promptCacheKey: 'second' },
    ], { maxRequests: 2, maxBytes: 10 });

    expect(plan.seeded).toBe(false);
    expect(
      plan.batches.map((partition) => partition.map((item) => item.id))
    ).toEqual([['a', 'b']]);
  });
});
