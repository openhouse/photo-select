import {expect, it} from 'vitest';
import {GithubCacheScheduler} from '../src/githubCacheScheduler.js';

// Locked tokenizer: this prefix has 2,400 text tokens, requiring 2,280 cached.
const prefix = 'A "quoted" line.\n'.repeat(400);
const body = index => ({model: 'gpt-5.6-terra', service_tier: 'flex',
  prompt_cache_key: 'photo-select:github-v3:recovery',
  input: [{role: 'developer', content: [{type: 'input_text', text: prefix,
    prompt_cache_breakpoint: {mode: 'explicit'}}, {type: 'input_text', text: `Photo ${index}`}]}]});
const deferred = () => {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};};
function fixture({misses = [7], recover = {}, faultAt, fault, blockAt, signal, now} = {}) {
  const sent = [], progress = [], activeAtSend = [], entered = deferred(), gate = deferred(); let active = 0;
  const scheduler = new GithubCacheScheduler({signal, now, progress: line => progress.push(line), send: async request => {
    sent.push(structuredClone(request)); const n = sent.length; activeAtSend.push(++active);
    try {
      if (n === blockAt) {entered.resolve(); await gate.promise; signal?.throwIfAborted();}
      await Promise.resolve();
      if (n === faultAt && fault instanceof Error) throw fault;
      const result = {status: 'completed', service_tier: 'flex', output_text: `Selection ${n}`,
        usage: {input_tokens: 2600, input_tokens_details: {cached_tokens: n === 1 || misses.includes(n) ? 0 : 2400,
          cache_write_tokens: n === 1 ? 2400 : 0}}};
      if (n === faultAt) Object.assign(result, fault);
      if (recover[n]) Object.assign(result, recover[n]);
      return result;
    } finally {active--;}
  }});
  const run = (count = 20) => Promise.allSettled(Array.from({length: count}, (_, i) => scheduler.respond(body(i))));
  return {scheduler, sent, progress, activeAtSend, entered, gate, run};
}
const cache = result => result.value._photoSelectCache;

it('pauses a mixed reader wave for one new recovery batch before restoring parallel readers', async () => {
  const f = fixture({blockAt: 11}), pending = f.run();
  // Before the repair, the scheduler stops at ten sends, so do not wait on a gate it cannot reach.
  const reached = await Promise.race([f.entered.promise.then(() => true), pending.then(() => false)]);
  expect(reached).toBe(true);
  expect(f.sent).toHaveLength(11); expect(f.activeAtSend[10]).toBe(1);
  f.gate.resolve(); const results = await pending;
  expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  expect(f.sent).toEqual(Array.from({length: 20}, (_, i) => body(i)));
  expect(results.slice(0, 2).map(r => cache(r).role)).toEqual(['seed', 'probe']);
  expect(cache(results[6])).toMatchObject({role: 'reader', cachedTokens: 0, verified: false});
  expect(cache(results[10])).toMatchObject({role: 'recovery', recoveryAttempt: 1, verified: true});
  expect(results.slice(11).every(r => cache(r).role === 'reader')).toBe(true);
  expect(Math.max(...f.activeAtSend)).toBe(8);
  expect(f.progress.join('\n')).toContain('recovery 1/2');
  expect(f.progress.join('\n')).toContain('recovery confirmed');
});

it('uses a second new batch when the first recovery only writes the cache', async () => {
  const f = fixture({misses: [7, 11], recover: {11: {usage: {input_tokens: 2600,
    input_tokens_details: {cached_tokens: 0, cache_write_tokens: 2400}}}}});
  const results = await f.run();
  expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  expect(f.sent).toHaveLength(20); expect(new Set(f.sent.map(r => JSON.stringify(r))).size).toBe(20);
  expect(cache(results[10])).toMatchObject({role: 'recovery', recoveryAttempt: 1, verified: false});
  expect(cache(results[11])).toMatchObject({role: 'recovery', recoveryAttempt: 2, verified: true});
  expect(f.activeAtSend.slice(10, 12)).toEqual([1, 1]);
});

it.each([0, 128, 2279])('holds after two recovery batches below the unchanged coverage floor: %s', async cached => {
  const usage = {input_tokens: 2600, input_tokens_details: {cached_tokens: cached, cache_write_tokens: 2400 - cached}};
  const f = fixture({recover: {11: {usage}, 12: {usage}}}), results = await f.run();
  expect(f.sent).toHaveLength(12);
  expect(results.slice(0, 12).every(r => r.status === 'fulfilled')).toBe(true);
  expect(results.slice(12).every(r => r.status === 'rejected')).toBe(true);
  expect(results[11].value.output_text).toBe('Selection 12');
  expect(cache(results[11])).toMatchObject({recoveryAttempt: 2, requiredCachedTokens: 2280, verified: false});
  await expect(f.scheduler.respond(body(20))).rejects.toThrow(/recovery.*2/);
  expect(f.sent).toHaveLength(12);
});

it('does not create extra jobs when the missed wave completes all supplied work', async () => {
  const f = fixture(), results = await f.run(10);
  expect(results.every(r => r.status === 'fulfilled')).toBe(true); expect(f.sent).toHaveLength(10);
  const next = await f.scheduler.respond(body(10));
  expect(next._photoSelectCache).toMatchObject({role: 'recovery', recoveryAttempt: 1, verified: true});
  expect(f.sent).toHaveLength(11);
});

it.each([
  {name: 'billing', fault: Object.assign(new Error('billing'), {code: 'billing_hard_limit_reached'})},
  {name: 'wrong tier', fault: {service_tier: 'default'}},
  {name: 'incomplete response', fault: {status: 'incomplete'}},
  {name: 'missing usage', fault: {usage: undefined}},
])('never turns $name into cache recovery', async ({fault}) => {
  const f = fixture({faultAt: 7, fault}), results = await f.run();
  expect(f.sent).toHaveLength(10);
  expect(results.slice(10).every(r => r.status === 'rejected')).toBe(true);
  expect(f.progress.join('\n')).not.toContain('recovery 1/2');
});

it('cancels a pending recovery without submitting the second recovery or remaining readers', async () => {
  const abort = new AbortController(), f = fixture({blockAt: 11, signal: abort.signal}), pending = f.run();
  const reached = await Promise.race([f.entered.promise.then(() => true), pending.then(() => false)]);
  expect(reached).toBe(true); abort.abort(); f.gate.resolve();
  const results = await pending;
  expect(results.slice(0, 10).every(r => r.status === 'fulfilled')).toBe(true);
  expect(results.slice(10).every(r => r.status === 'rejected')).toBe(true); expect(f.sent).toHaveLength(11);
});

it('recovers an expired established cache but never releases parallel work on a write alone', async () => {
  let now = 1; const f = fixture({misses: [3], now: () => now});
  await f.scheduler.respond(body(0)); await f.scheduler.respond(body(1)); now += 21 * 60 * 1000;
  const results = await Promise.allSettled([f.scheduler.respond(body(2)), f.scheduler.respond(body(3))]);
  expect(results.every(r => r.status === 'fulfilled')).toBe(true);
  expect(cache(results[0])).toMatchObject({role: 'probe', verified: false});
  expect(cache(results[1])).toMatchObject({role: 'recovery', recoveryAttempt: 1, verified: true});
  expect(f.activeAtSend).toEqual([1, 1, 1, 1]);
});
