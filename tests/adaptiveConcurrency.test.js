import { describe, expect, it } from 'vitest';
import { AdaptiveConcurrencyController } from '../src/core/adaptiveConcurrency.js';
const roomyHeaders = {
  'x-ratelimit-limit-requests': '100',
  'x-ratelimit-remaining-requests': '99',
  'x-ratelimit-limit-tokens': '100000',
  'x-ratelimit-remaining-tokens': '99000',
};
describe('AdaptiveConcurrencyController', () => {
  it('keeps the queue moving and increases its window after cache hits', async () => {
    const controller = new AdaptiveConcurrencyController({
      minConcurrency: 2, maxConcurrency: 4, initialConcurrency: 2,
      successesPerIncrease: 1, cacheKeyRequestsPerMinute: Infinity,
    });
    let active = 0;
    let maxActive = 0;
    const results = await controller.run([0, 1, 2, 3, 4, 5], async (item) => {
      maxActive = Math.max(maxActive, ++active);
      await new Promise((resolve) => setTimeout(resolve, item < 2 ? 15 : 2));
      active -= 1;
      return {
        value: item * 10,
        observation: { cacheHit: true, estimatedTokens: 100, headers: roomyHeaders },
      };
    }, { cacheKey: 'shared' });
    expect(results).toEqual([0, 10, 20, 30, 40, 50]);
    expect(maxActive).toBeGreaterThan(2);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(controller.snapshot()).toMatchObject({
      targetConcurrency: 4,
      cacheHits: 6,
      cacheMisses: 0,
      maxObservedInFlight: maxActive,
    });
  });
  it.each([
    ['temporary limit', { error: { status: 429, headers: { 'retry-after': '2' } } },
      { targetConcurrency: 4, blockedUntilMs: 12_000, reductions: 1 }],
    ['cache miss', { cacheHit: false }, { targetConcurrency: 1, cacheMisses: 1 }],
    ['token headroom', { cacheHit: true, estimatedTokens: 200_000, headers: {
      ...roomyHeaders, 'x-ratelimit-limit-tokens': '1000000',
      'x-ratelimit-remaining-tokens': '300000',
    } }, { targetConcurrency: 1, headerConcurrencyCap: 1 }],
  ])('reduces concurrency for %s', (_case, observation, expected) => {
    const controller = new AdaptiveConcurrencyController({
      minConcurrency: 1,
      maxConcurrency: 8,
      initialConcurrency: observation.error ? 8 : 6,
      cacheKeyRequestsPerMinute: Infinity,
      now: () => 10_000,
    });
    controller.observe(observation);
    expect(controller.snapshot()).toMatchObject(expected);
  });
  it('paces starts sharing one prompt-cache key', async () => {
    let now = 0;
    const starts = [];
    const controller = new AdaptiveConcurrencyController({
      minConcurrency: 3, maxConcurrency: 3, cacheKeyRequestsPerMinute: 2, now: () => now,
      sleep: async (ms) => { now += ms; },
    });
    await controller.run(['a', 'b', 'c'], async (value) => {
      starts.push(now);
      return { value, observation: { cacheHit: true, estimatedTokens: 1 } };
    }, { cacheKey: 'shared' });
    expect(starts).toEqual([0, 30_000, 60_000]);
  });
});
