import { describe, it, expect } from "vitest";
import { pickRandom } from "../src/imageSelector.js";

describe("pickRandom", () => {
  it("returns no more than requested items", () => {
    const arr = [...Array(20).keys()];
    const result = pickRandom(arr, 10);
    expect(result.length).toBeLessThanOrEqual(10);
  });

  it("returns every item when array shorter than count", () => {
    const arr = [1, 2, 3];
    expect(pickRandom(arr, 10)).toHaveLength(3);
  });
});
