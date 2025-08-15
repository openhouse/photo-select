import { describe, it, expect } from "vitest";
import { computeMaxOutputTokens, estimateInputTokens } from "../src/tokenEstimate.js";

describe("adaptive tokens", () => {
  it("computes bounded max_output_tokens", () => {
    const cap = computeMaxOutputTokens({ fileCount: 10, minutesMax: 6 });
    expect(cap).toBeGreaterThanOrEqual(768);
    expect(cap).toBeLessThanOrEqual(2048);
  });
  it("estimates input tokens", () => {
    const n = estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5 });
    expect(n).toBeGreaterThan(0);
  });
});
