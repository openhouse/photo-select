import { describe, it, expect } from "vitest";
import { computeMaxOutputTokens, estimateInputTokens } from "../src/tokenEstimate.js";

describe("adaptive tokens", () => {
  it("computes max_output_tokens with headroom", () => {
    const cap = computeMaxOutputTokens({
      minutesCount: 6,
      decisionsCount: 10,
      effort: "medium",
    });
    expect(cap).toBe(8192);
  });
  it("estimates input tokens", () => {
    const n = estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5 });
    expect(n).toBeGreaterThan(0);
  });
});
