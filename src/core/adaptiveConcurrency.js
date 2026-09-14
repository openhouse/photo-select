import { setTimeout as defaultSleep } from 'node:timers/promises';

const CAPACITY_HEADERS = {
  limitRequests: 'x-ratelimit-limit-requests', remainingRequests: 'x-ratelimit-remaining-requests',
  limitTokens: 'x-ratelimit-limit-tokens', remainingTokens: 'x-ratelimit-remaining-tokens',
};
function getHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name);
  return key ? headers[key] : undefined;
}
export function readRateLimitSnapshot(headers) {
  return Object.fromEntries(Object.entries(CAPACITY_HEADERS).flatMap(([field, name]) => {
    const value = Number(getHeader(headers, name));
    return Number.isFinite(value) && value >= 0 ? [[field, value]] : [];
  }));
}
function transient(error) {
  const status = Number(error?.status ?? error?.statusCode);
  return [429, 502, 503].includes(status) ||
    ['ETIMEDOUT', 'ECONNRESET'].includes(error?.code);
}
export class AdaptiveConcurrencyController {
  constructor(options = {}) {
    const { minConcurrency = 1, maxConcurrency = 10,
      initialConcurrency = minConcurrency, successesPerIncrease = 2,
      cacheKeyRequestsPerMinute = 14, now = Date.now, sleep = defaultSleep } = options;
    this.minConcurrency = Math.max(1, Math.floor(minConcurrency));
    this.maxConcurrency = Math.max(this.minConcurrency, Math.floor(maxConcurrency));
    this.targetConcurrency = Math.min(this.maxConcurrency,
      Math.max(this.minConcurrency, Math.floor(initialConcurrency)));
    this.successesPerIncrease = Math.max(1, Math.floor(successesPerIncrease));
    this.cacheKeyIntervalMs = Number.isFinite(cacheKeyRequestsPerMinute)
      ? Math.ceil(60_000 / Math.max(1, cacheKeyRequestsPerMinute)) : 0;
    this.now = now;
    this.sleep = sleep;
    this.lastStartByCacheKey = new Map();
    this.headerConcurrencyCap = this.maxConcurrency;
    this.blockedUntilMs = 0;
    this.successStreak = 0;
    this.inFlight = 0;
    this.rateLimits = {};
    this.metrics = { launched: 0, completed: 0, cacheHits: 0, cacheMisses: 0,
      increases: 0, reductions: 0, maxObservedInFlight: 0 };
  }
  observe({ cacheHit, headers, estimatedTokens, error } = {}) {
    const limits = readRateLimitSnapshot(headers || error?.headers);
    if (Object.keys(limits).length) {
      this.rateLimits = limits;
      const requestCap = Number.isFinite(limits.remainingRequests)
        ? Math.floor(limits.remainingRequests) : this.maxConcurrency;
      const tokenCap = Number.isFinite(limits.remainingTokens) && estimatedTokens > 0
        ? Math.floor(limits.remainingTokens / estimatedTokens) : this.maxConcurrency;
      this.headerConcurrencyCap = Math.max(this.minConcurrency,
        Math.min(this.maxConcurrency, requestCap, tokenCap));
      this.targetConcurrency = Math.min(
        this.targetConcurrency, this.headerConcurrencyCap);
    }
    if (cacheHit === false) {
      this.metrics.cacheMisses += 1;
      if (this.targetConcurrency > this.minConcurrency) this.metrics.reductions += 1;
      this.targetConcurrency = this.minConcurrency;
      this.successStreak = 0;
    } else if (cacheHit === true) {
      this.metrics.cacheHits += 1;
    }
    if (error && transient(error)) {
      const reduced = Math.max(this.minConcurrency,
        Math.floor(this.targetConcurrency / 2));
      if (reduced < this.targetConcurrency) this.metrics.reductions += 1;
      this.targetConcurrency = reduced;
      this.successStreak = 0;
      const retryAfter = Number(getHeader(error.headers, 'retry-after')) * 1000;
      if (retryAfter > 0) {
        this.blockedUntilMs = Math.max(this.blockedUntilMs, this.now() + retryAfter);
      }
      return;
    }
    if (cacheHit === true && ++this.successStreak >= this.successesPerIncrease) {
      const ceiling = Math.min(this.maxConcurrency, this.headerConcurrencyCap);
      if (this.targetConcurrency < ceiling) {
        this.targetConcurrency += 1;
        this.metrics.increases += 1;
      }
      this.successStreak = 0;
    }
  }
  snapshot() {
    return {
      minConcurrency: this.minConcurrency, maxConcurrency: this.maxConcurrency,
      targetConcurrency: this.targetConcurrency,
      headerConcurrencyCap: this.headerConcurrencyCap,
      blockedUntilMs: this.blockedUntilMs, rateLimits: this.rateLimits,
      ...this.metrics,
    };
  }
  async #waitToStart(cacheKey) {
    const blockedFor = this.blockedUntilMs - this.now();
    if (blockedFor > 0) await this.sleep(blockedFor);
    if (!cacheKey || !this.cacheKeyIntervalMs) return;
    const last = this.lastStartByCacheKey.get(cacheKey);
    const wait = last === undefined ? 0 : last + this.cacheKeyIntervalMs - this.now();
    if (wait > 0) await this.sleep(wait);
    this.lastStartByCacheKey.set(cacheKey, this.now());
  }
  async run(items, worker, { cacheKey } = {}) {
    if (!items.length) return [];
    const results = new Array(items.length);
    let next = 0, active = 0, settled = 0, firstError, pumping = false;
    return new Promise((resolve, reject) => {
      const finish = () => {
        if (firstError && !active) reject(firstError);
        else if (settled === items.length) resolve(results);
      };
      const pump = async () => {
        if (pumping) return;
        pumping = true;
        while (!firstError && next < items.length && active < this.targetConcurrency) {
          await this.#waitToStart(cacheKey);
          if (firstError) break;
          const index = next++;
          active += 1; this.inFlight += 1; this.metrics.launched += 1;
          this.metrics.maxObservedInFlight = Math.max(
            this.metrics.maxObservedInFlight, this.inFlight);
          Promise.resolve(worker(items[index], index))
            .then(({ value, observation }) => {
              results[index] = value;
              this.observe(observation);
            })
            .catch((error) => {
              this.observe({ ...(error?.adaptiveObservation || {}), error });
              firstError ||= error;
            })
            .finally(() => {
              active -= 1; this.inFlight -= 1; settled += 1;
              this.metrics.completed += 1;
              finish();
              void pump();
            });
        }
        pumping = false;
        finish();
      };
      void pump();
    });
  }
}
