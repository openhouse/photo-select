// src/scheduler.js
import { setTimeout as sleep } from "node:timers/promises";

/** Small semaphore for in-flight requests (process-wide). */
class Semaphore {
  constructor(max) {
    this.max = max;
    this.inUse = 0;
    this.q = [];
  }
  async acquire() {
    if (this.inUse < this.max) {
      this.inUse++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.q.push(() => {
        this.inUse++;
        resolve(() => this.release());
      });
    });
  }
  release() {
    this.inUse = Math.max(0, this.inUse - 1);
    const next = this.q.shift();
    if (next) next();
  }
}

/** Token bucket: refills tokens at ratePerSec, max 'capacity'. */
class TokenBucket {
  constructor({ ratePerSec, capacity }) {
    this.ratePerSec = ratePerSec;
    this.capacity = capacity;
    this.tokens = capacity;
    this.last = Date.now();
  }
  _refill() {
    const now = Date.now();
    const delta = Math.max(0, now - this.last) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + delta * this.ratePerSec);
    this.last = now;
  }
  /** Try to consume n tokens; return ms to wait if not enough. */
  tryTake(n) {
    this._refill();
    const short = n - this.tokens;
    if (short <= 0) {
      this.tokens -= n;
      return 0;
    }
    // time until shortfall refills
    return Math.ceil((short / this.ratePerSec) * 1000);
  }
  /** Wait until n tokens are available; consume them. */
  async take(n, signal) {
    for (;;) {
      const wait = this.tryTake(n);
      if (wait === 0) return;
      if (signal?.aborted) throw new Error("aborted");
      await sleep(wait, undefined, { signal }).catch(() => {});
    }
  }
  /** Credit back tokens (on failure/cancel). */
  giveBack(n) {
    this._refill();
    this.tokens = Math.min(this.capacity, this.tokens + n);
  }
}

/** Sliding window for RPM: at most 'capacity' events per windowMs. */
class SlidingWindow {
  constructor({ capacity, windowMs }) {
    this.capacity = capacity;
    this.windowMs = windowMs;
    this.events = [];
  }
  _prune(now = Date.now()) {
    const cutoff = now - this.windowMs;
    while (this.events.length && this.events[0] <= cutoff) this.events.shift();
  }
  /** Returns ms to wait if window is full. */
  tryTake() {
    const now = Date.now();
    this._prune(now);
    if (this.events.length < this.capacity) {
      this.events.push(now);
      return 0;
    }
    const nextFreeAt = this.events[0] + this.windowMs;
    const wait = Math.max(0, nextFreeAt - now);
    // Reserve the slot in the future to avoid thundering herd.
    this.events.push(nextFreeAt);
    return wait;
  }
  async take(signal) {
    for (;;) {
      const wait = this.tryTake();
      if (wait === 0) return;
      if (signal?.aborted) throw new Error("aborted");
      await sleep(wait, undefined, { signal }).catch(() => {});
    }
  }
}

/** Per-model budget bundle. */
class ModelBudget {
  constructor({ tpm, rpm, burstWindowSec }) {
    const ratePerSec = tpm / 60;               // tokens per second
    const capacity   = Math.max(ratePerSec * burstWindowSec, tpm / 120);
    this.tpm = new TokenBucket({ ratePerSec, capacity });
    this.rpm = new SlidingWindow({ capacity: rpm, windowMs: 60_000 });
  }
}

/**
 * Central scheduler (singleton). Limits concurrency, RPM, and TPM per model.
 * Usage:
 *   const release = await scheduler.reserve({ model, estTokens });
 *   try { const rsp = await fn(); scheduler.commit(release, actualTokens); }
 *   catch(e){ scheduler.cancel(release); throw e; }
 */
export class TokenScheduler {
  constructor({
    maxConcurrent = numEnv("PHOTO_SELECT_MAX_CONCURRENT", 10),
    burstWindowSec = numEnv("PHOTO_SELECT_BURST_WINDOW_SEC", 15),
    // Per-model soft budgets (you can set lower than org hard limits)
    perModel = {},
    globalTpm = optNumEnv("PHOTO_SELECT_TPM_SOFT_CAP"),
    globalRpm = optNumEnv("PHOTO_SELECT_RPM_SOFT_CAP"),
  } = {}) {
    this.sem = new Semaphore(maxConcurrent);
    this.burstWindowSec = burstWindowSec;
    this.models = new Map();
    this.perModel = perModel; // { 'gpt-5': { tpm, rpm }, 'gpt-5-mini': {...}, ... }
    if (globalTpm || globalRpm) {
      this.global = {
        tpm: globalTpm
          ? new TokenBucket({
              ratePerSec: globalTpm / 60,
              capacity: Math.max(
                (globalTpm / 60) * burstWindowSec,
                globalTpm / 120,
              ),
            })
          : null,
        rpm: globalRpm
          ? new SlidingWindow({ capacity: globalRpm, windowMs: 60_000 })
          : null,
      };
    }
  }

  _ensure(model) {
    if (!this.models.has(model)) {
      const cfg = this.perModel[model] || this.perModel["default"];
      if (!cfg) throw new Error(`No scheduler budget configured for model: ${model}`);
      this.models.set(
        model,
        new ModelBudget({
          tpm: cfg.tpm,
          rpm: cfg.rpm,
          burstWindowSec: this.burstWindowSec,
        }),
      );
    }
    return this.models.get(model);
  }

  /** Reserve concurrency + RPM + TPM (based on estimated tokens). */
  async reserve({ model, estTokens, abortSignal } = {}) {
    if (!Number.isFinite(estTokens) || estTokens <= 0) {
      throw new Error(`invalid estTokens: ${estTokens}`);
    }
    const releaseSem = await this.sem.acquire(); // concurrency gate
    const budget = this._ensure(model);
    try {
      const waits = [
        budget.rpm.take(abortSignal), // request slot
        budget.tpm.take(estTokens, abortSignal), // token slot
      ];
      if (this.global?.rpm) waits.push(this.global.rpm.take(abortSignal));
      if (this.global?.tpm)
        waits.push(this.global.tpm.take(estTokens, abortSignal));
      await Promise.all(waits);
      return { releaseSem, budget, estTokens };
    } catch (e) {
      releaseSem(); // free concurrency if we failed to reserve
      throw e;
    }
  }

  /** Finalize a reservation, charging actualTokens (credit or extra debit). */
  commit(handle, actualTokens) {
    if (!handle) return;
    const delta =
      (Number.isFinite(actualTokens) ? actualTokens : handle.estTokens) -
      handle.estTokens;
    if (delta < 0) {
      handle.budget.tpm.giveBack(-delta); // credit back
      if (this.global?.tpm) this.global.tpm.giveBack(-delta);
    }
    // If delta > 0 we "owe" tokens; we don't block here, just let the bucket go negative by not refunding
    handle.releaseSem();
  }

  /** Cancel a reservation (e.g., request errored before being sent). */
  cancel(handle) {
    if (!handle) return;
    handle.budget.tpm.giveBack(handle.estTokens);
    if (this.global?.tpm) this.global.tpm.giveBack(handle.estTokens);
    handle.releaseSem();
  }
}

function numEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function optNumEnv(name) {
  const v = process.env[name];
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Create a process-wide singleton with sane defaults. */
export const scheduler = new TokenScheduler({
  maxConcurrent: numEnv("PHOTO_SELECT_MAX_CONCURRENT", 10),
  burstWindowSec: numEnv("PHOTO_SELECT_BURST_WINDOW_SEC", 15),
  perModel: {
    // Soft budgets — feel free to lower from your org hard caps:
    // Your org: gpt-5 → 40,000,000 TPM, 15,000 RPM
    "gpt-5": {
      tpm: numEnv("PHOTO_SELECT_TPM_GPT5", 2_000_000),
      rpm: numEnv("PHOTO_SELECT_RPM_GPT5", 600),
    },
    "gpt-5-mini": {
      tpm: numEnv("PHOTO_SELECT_TPM_GPT5_MINI", 4_000_000),
      rpm: numEnv("PHOTO_SELECT_RPM_GPT5_MINI", 900),
    },
    default: {
      tpm: numEnv("PHOTO_SELECT_TPM_DEFAULT", 500_000),
      rpm: numEnv("PHOTO_SELECT_RPM_DEFAULT", 300),
    },
  },
});
