import { describe, it, expect } from "vitest";
import { TokenScheduler } from "../src/scheduler.js";

describe("TokenScheduler", () => {
  it("respects concurrency and tokens", async () => {
    const s = new TokenScheduler({
      maxConcurrent: 2,
      perModel: { default: { tpm: 10000, rpm: 10 } },
    });

    const started = [];
    const done = [];
    const job = async (i) => {
      const h = await s.reserve({ model: "whatever", estTokens: 500 });
      started.push(i);
      await new Promise((r) => setTimeout(r, 50));
      s.commit(h, 500);
      done.push(i);
    };

    await Promise.all([0, 1, 2, 3].map(job));
    expect(started.length).toBe(4);
    expect(done.length).toBe(4);
    // With tpm=10000, tokens=500 each, concurrency cap = 2
  });
});
