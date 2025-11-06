export class SimpleSemaphore {
  constructor(max = 1) {
    if (!Number.isFinite(max) || max <= 0) {
      throw new Error(`SimpleSemaphore requires max >= 1 (received ${max})`);
    }
    this.max = max;
    this.inUse = 0;
    this.queue = [];
  }

  async run(fn) {
    if (typeof fn !== "function") {
      throw new TypeError("SimpleSemaphore.run expects a function");
    }
    if (this.inUse >= this.max) {
      await new Promise((resolve) => this.queue.push(resolve));
    }
    this.inUse++;
    try {
      return await fn();
    } finally {
      this.inUse = Math.max(0, this.inUse - 1);
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export default SimpleSemaphore;
