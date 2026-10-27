import { describe, expect, it } from 'vitest';
const module = await import('../src/core/hostedConcurrency.js').catch(() => null);
function pool(options) { expect(module?.HostedConcurrencyController).toBeTypeOf('function'); return new module.HostedConcurrencyController(options); }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('shared hosted request admission', () => {
  it('enforces one global fixed ceiling across independent submissions and releases permits', async () => {
    const gate = pool({ maxConcurrency: 2 }), releases = Array.from({ length: 5 }, deferred), starts = [];
    const work = releases.map((release, index) => gate.run(async () => { starts.push(index); await release.promise; return index; }));
    await flush(); expect(starts).toEqual([0, 1]);
    releases[1].resolve(); await flush(); expect(starts).toEqual([0, 1, 2]);
    releases[0].resolve(); await flush(); expect(starts).toEqual([0, 1, 2, 3]);
    releases[2].resolve(); releases[3].resolve(); await flush(); releases[4].resolve();
    expect(await Promise.all(work)).toEqual([0, 1, 2, 3, 4]);
    expect(gate.snapshot()).toMatchObject({ inFlight: 0, launched: 5, completed: 5, maxObservedInFlight: 2 });
  });
  it('starts adaptive work at the minimum and grows only after two valid replies', async () => {
    const gate = pool({ maxConcurrency: 3, adaptive: true }), releases = Array.from({ length: 6 }, deferred), starts = [];
    const work = releases.map((release, index) => gate.run(async () => { starts.push(index); await release.promise; gate.observe({ status: 200, outcome: 'valid' }); }));
    await flush(); expect(starts).toEqual([0]);
    releases[0].resolve(); await flush(); expect(starts).toEqual([0, 1]);
    releases[1].resolve(); await flush(); expect(starts).toEqual([0, 1, 2, 3]);
    expect(gate.snapshot().targetConcurrency).toBe(2);
    releases[2].resolve(); releases[3].resolve(); await flush(); releases[4].resolve(); releases[5].resolve(); await Promise.all(work);
    expect(gate.snapshot()).toMatchObject({ targetConcurrency: 3, maxObservedInFlight: 3, increases: 2 });
  });
  it('does not treat a parseable but invalid reply as a success or invent cache evidence', () => {
    const gate = pool({ maxConcurrency: 4, adaptive: true });
    for (let i = 0; i < 8; i++) gate.observe({ status: 200, outcome: 'invalid-contract' });
    expect(gate.snapshot()).toMatchObject({ targetConcurrency: 1, increases: 0 });
    expect(gate.snapshot()).not.toHaveProperty('cacheHits');
  });
  it('halves adaptive capacity on rejection and honors a bounded shared cooldown', async () => {
    let now = 1000; const sleeping = deferred(); const waits = [];
    const gate = pool({ maxConcurrency: 4, adaptive: true, now: () => now, sleep: async ms => { waits.push(ms); await sleeping.promise; } });
    for (let i = 0; i < 6; i++) gate.observe({ status: 200, outcome: 'valid' });
    expect(gate.snapshot().targetConcurrency).toBe(4);
    gate.observe({ status: 429, outcome: 'rejected', retryAfterMs: 2000 });
    expect(gate.snapshot()).toMatchObject({ targetConcurrency: 2, blockedUntilMs: 3000, reductions: 1 });
    let started = false; const work = gate.run(() => { started = true; }); await flush();
    expect(started).toBe(false); expect(waits).toEqual([2000]);
    now = 3000; sleeping.resolve(); await work; expect(started).toBe(true);
  });
  it('rejects queued and future work on a billing stop while an active reply can finish', async () => {
    const gate = pool(), active = deferred(), calls = [];
    const first = gate.run(async () => { calls.push('first'); await active.promise; return 'recorded'; });
    const held = gate.run(() => { calls.push('queued'); }).catch(error => error.code);
    await flush(); const billing = Object.assign(new Error('Billing hold.'), { code: 'BILLING_LIMIT' }); gate.stop(billing);
    expect(await held).toBe('BILLING_LIMIT');
    await expect(gate.run(() => calls.push('future'))).rejects.toMatchObject({ code: 'BILLING_LIMIT' });
    active.resolve(); expect(await first).toBe('recorded'); expect(calls).toEqual(['first']);
    expect(gate.snapshot()).toMatchObject({ stopped: true, queued: 0, inFlight: 0 });
  });
  it('latches a failed admitted task before dispatching another queued task', async () => {
    const gate = pool(), calls = [], failure = Object.assign(new Error('Held.'), { code: 'XIAOMI_HELD' });
    const first = gate.run(() => { calls.push('first'); throw failure; }).catch(error => error.code);
    const queued = gate.run(() => calls.push('queued')).catch(error => error.code);
    expect(await Promise.all([first, queued])).toEqual(['XIAOMI_HELD', 'XIAOMI_HELD']); expect(calls).toEqual(['first']);
  });
  it('honors the requested fifty-request ceiling without admitting a fifty-first request', async () => {
    const gate = pool({ maxConcurrency: 50 }), release = deferred(); let starts = 0;
    const requests = Array.from({ length: 51 }, () => gate.run(async () => { starts++; await release.promise; }));
    await flush(); expect(starts).toBe(50); expect(gate.snapshot().queued).toBe(1);
    release.resolve(); await Promise.all(requests);
    expect(gate.snapshot()).toMatchObject({ launched: 51, completed: 51, inFlight: 0, maxObservedInFlight: 50 });
  });
  it('does not exceed a thirty-second cooldown and cancels queued work during that cooldown', async () => {
    let requested; let aborted = false;
    const gate = pool({ now: () => 1000, sleep: (ms, signal) => new Promise((resolve, reject) => { requested = ms; signal.addEventListener('abort', () => { aborted = true; reject(new Error('Cancelled wait.')); }); }) });
    gate.observe({ status: 429, retryAfterMs: 120000 });
    const queued = gate.run(() => { throw new Error('Must never execute.'); }).catch(error => error.code);
    await flush(); expect(requested).toBe(30000);
    gate.stop(Object.assign(new Error('Held.'), { code: 'XIAOMI_HELD' }));
    expect(await queued).toBe('XIAOMI_HELD'); expect(aborted).toBe(true);
    expect(gate.snapshot()).toMatchObject({ inFlight: 0, queued: 0, stopped: true });
  });
  it('never reduces adaptive work below its selected minimum', () => {
    const gate = pool({ minConcurrency: 2, maxConcurrency: 5, adaptive: true });
    gate.observe({ status: 429 }); gate.observe({ status: 503 });
    expect(gate.snapshot()).toMatchObject({ targetConcurrency: 2, reductions: 0 });
  });
  it('rechecks a billing latch for admitted work that has not yet submitted', async () => {
    const gate = pool({ maxConcurrency: 2 }), prepared = deferred(); let submissions = 0;
    const work = gate.run(async () => { await prepared.promise; gate.assertRunning(); submissions++; }).catch(error => error.code);
    await flush(); gate.stop(Object.assign(new Error('Billing hold.'), { code: 'BILLING_LIMIT' })); prepared.resolve();
    expect(await work).toBe('BILLING_LIMIT'); expect(submissions).toBe(0);
  });
  it.each([{ maxConcurrency: 0 }, { maxConcurrency: 51 }, { maxConcurrency: 2.5 }, { maxConcurrency: 3, minConcurrency: 4 }, { minConcurrency: 0 }])('rejects invalid capacity before any work ($maxConcurrency/$minConcurrency)', options => {
    expect(() => pool(options)).toThrow(/concurrency|capacity/i);
  });
});
