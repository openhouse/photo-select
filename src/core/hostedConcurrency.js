import { setTimeout as pause } from 'node:timers/promises';

/** One admission queue shared by all batches, phases and repairs in a hosted run. */
export class HostedConcurrencyController {
  constructor({ minConcurrency = 1, maxConcurrency = 1, adaptive = false, now = Date.now,
    sleep = (milliseconds, signal) => pause(milliseconds, undefined, { signal }) } = {}) {
    if (![minConcurrency, maxConcurrency].every(n => Number.isInteger(n) && n >= 1 && n <= 50) || minConcurrency > maxConcurrency) throw new Error('Hosted concurrency must be integers from 1 to 50, with minimum at most maximum.');
    Object.assign(this, { minConcurrency, maxConcurrency, adaptive, now, sleep });
    this.targetConcurrency = adaptive ? minConcurrency : maxConcurrency;
    this.queue = []; this.inFlight = 0; this.failure = null; this.wake = null;
    this.blockedUntilMs = 0; this.successStreak = 0;
    this.metrics = { launched: 0, completed: 0, maxObservedInFlight: 0, increases: 0, reductions: 0 };
  }
  run(work) {
    if (this.failure) return Promise.reject(this.failure);
    if (typeof work !== 'function') return Promise.reject(new TypeError('Hosted work must be a function.'));
    return new Promise((resolve, reject) => { this.queue.push({ work, resolve, reject }); this.pump(); });
  }
  assertRunning() { if (this.failure) throw this.failure; }
  observe({ status, outcome, retryAfterMs } = {}) {
    if (this.failure) return;
    if ([429, 502, 503].includes(status)) {
      const reduced = this.adaptive ? Math.max(this.minConcurrency, Math.floor(this.targetConcurrency / 2)) : this.targetConcurrency;
      if (reduced < this.targetConcurrency) this.metrics.reductions++;
      this.targetConcurrency = reduced; this.successStreak = 0;
      if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) this.blockedUntilMs = Math.max(this.blockedUntilMs, this.now() + Math.min(30000, retryAfterMs));
    } else if (outcome === 'valid' && status === 200 && this.adaptive) {
      if (++this.successStreak >= 2) {
        if (this.targetConcurrency < this.maxConcurrency) { this.targetConcurrency++; this.metrics.increases++; }
        this.successStreak = 0;
      }
    } else if (outcome !== 'valid') this.successStreak = 0;
    this.pump();
  }
  stop(error) {
    if (this.failure) return;
    this.failure = error || Object.assign(new Error('Hosted run held before further submission.'), { code: 'HOSTED_HELD' });
    this.wake?.abort(); this.wake = null;
    for (const queued of this.queue.splice(0)) queued.reject(this.failure);
  }
  snapshot() {
    return { minConcurrency: this.minConcurrency, maxConcurrency: this.maxConcurrency,
      targetConcurrency: this.targetConcurrency, inFlight: this.inFlight, queued: this.queue.length,
      stopped: Boolean(this.failure), blockedUntilMs: this.blockedUntilMs, ...this.metrics };
  }
  pump() {
    if (this.failure || !this.queue.length || this.inFlight >= this.targetConcurrency) return;
    const delay = this.blockedUntilMs - this.now();
    if (delay > 0) {
      if (!this.wake) {
        const wake = new AbortController(); this.wake = wake;
        Promise.resolve().then(() => this.sleep(delay, wake.signal)).then(() => {
          if (this.wake === wake) this.wake = null;
          this.pump();
        }).catch(error => { if (!wake.signal.aborted) this.stop(error); });
      }
      return;
    }
    while (!this.failure && this.queue.length && this.inFlight < this.targetConcurrency) {
      const item = this.queue.shift(); this.inFlight++; this.metrics.launched++;
      this.metrics.maxObservedInFlight = Math.max(this.metrics.maxObservedInFlight, this.inFlight);
      const release = () => { this.inFlight--; this.metrics.completed++; this.pump(); };
      Promise.resolve().then(() => { if (this.failure) throw this.failure; return item.work(); })
        .then(value => { release(); item.resolve(value); }, error => { this.stop(error); release(); item.reject(error); });
    }
  }
}
