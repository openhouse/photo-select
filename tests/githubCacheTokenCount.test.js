import {expect, it} from 'vitest';
import {GithubCacheScheduler} from '../src/githubCacheScheduler.js';
import {validateGithubBrief} from '../src/core/githubBrief.js';

// Hand-checked with the locked o200k_base tokenizer: 2,400 text tokens,
// but 2,801 when JSON.stringify adds quote and newline escapes.
const prefix = 'A "quoted" line.\n'.repeat(400);
const body = index => ({model: 'gpt-5.6-terra', service_tier: 'flex',
  prompt_cache_key: 'photo-select:github-v3:quoted-context',
  input: [{role: 'developer', content: [{type: 'input_text', text: prefix,
    prompt_cache_breakpoint: {mode: 'explicit'}}, {type: 'input_text', text: `Image ${index}`}]}],
});
function fixture({warm = false, seedWrite = 2400, missAt = 0, missingUsage = false, missTokens = 0} = {}) {
  const sent = [], progress = [];
  const scheduler = new GithubCacheScheduler({progress: line => progress.push(line), send: async request => {
    sent.push(structuredClone(request));
    const index = sent.length, miss = index === missAt;
    return {status: 'completed', service_tier: 'flex',
      usage: miss && missingUsage ? undefined : {input_tokens: 2600, input_tokens_details: {
        cached_tokens: miss ? missTokens : index === 1 && !warm ? 0 : 2400,
        cache_write_tokens: index === 1 && !warm ? seedWrite : miss ? 2400 - missTokens : 0,
      }}, output_text: `Completed ${index}`};
  }});
  const run = () => Promise.allSettled(Array.from({length: 20}, (_, index) => scheduler.respond(body(index))));
  return {scheduler, sent, progress, run};
}

it('releases quoted-context seed, probe and readers using text tokens without changing requests', async () => {
  const f = fixture(), results = await f.run();
  expect(results.every(result => result.status === 'fulfilled')).toBe(true);
  expect(f.sent).toHaveLength(20);
  expect(f.sent).toEqual(Array.from({length: 20}, (_, index) => body(index)));
  expect(results.slice(0, 3).map(result => result.value._photoSelectCache.role)).toEqual(['seed', 'probe', 'reader']);
  for (const result of results) expect(result.value._photoSelectCache).toMatchObject({prefixTokens: 2400, requiredCachedTokens: 2280});
  expect(results[0].value._photoSelectCache.verified).toBe(false); // A write alone is never a hit.
  expect(results[1].value._photoSelectCache.verified).toBe(true);
  expect(f.progress.join('\n')).toContain('prefix=2400 required=2280');
  expect(validateGithubBrief(prefix).textTokens).toBe(2801); // Conservative input budget is separate.
});
it('recognizes a warm cache measured in actual text tokens without buying another seed', async () => {
  const f = fixture({warm: true}), results = await f.run();
  expect(results.every(result => result.status === 'fulfilled')).toBe(true);
  expect(results.slice(0, 2).map(result => result.value._photoSelectCache.role)).toEqual(['seed', 'reader']);
  expect(f.sent).toHaveLength(20);
  expect(results.every(result => result.value._photoSelectCache.writeTokens === 0)).toBe(true);
});
it.each([{missTokens: 0}, {missTokens: 128}, {missingUsage: true}])('still holds queued work on a real probe miss or missing usage: %j', async options => {
  const f = fixture({missAt: 2, ...options}), results = await f.run();
  expect(f.sent).toHaveLength(2);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(2);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(18);
  expect(results[1].value.output_text).toBe('Completed 2');
  expect(results[1].value._photoSelectCache.verified).toBe(false);
  await expect(f.scheduler.respond(body(20))).rejects.toThrow(/cache probe/);
});
it('holds a seed that writes less than 95 percent of the actual prefix', async () => {
  const f = fixture({seedWrite: 2279}), results = await f.run();
  expect(f.sent).toHaveLength(1);
  expect(results[0].status).toBe('fulfilled');
  expect(results.slice(1).every(result => result.status === 'rejected')).toBe(true);
});
it('preserves a completed reader wave but stops the next wave below the unchanged coverage floor', async () => {
  const f = fixture({missAt: 3, missTokens: 2279}), results = await f.run();
  expect(f.sent).toHaveLength(10);
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(10);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(10);
});
