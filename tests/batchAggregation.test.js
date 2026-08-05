import { describe, expect, it } from 'vitest';
import { partitionBatchItems } from '../src/core/batchAggregation.js';

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
});
