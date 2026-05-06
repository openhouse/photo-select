import { describe, it, expect, afterEach } from "vitest";
import { computeMaxOutputTokens, computeOutputBudget, clampToContextWindow, estimateInputTokens } from "../src/tokenEstimate.js";

describe("adaptive tokens", () => {
  afterEach(() => {
    for (const key of ["PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", "PHOTO_SELECT_CONTEXT_WINDOW_TOKENS"]) delete process.env[key];
  });

  it("scales xhigh large-context budgets and exposes details", () => {
    const b = computeOutputBudget({ model: "gpt-5.4", reasoningEffort: "xhigh", verbosity: "high", minutesMax: 77, decisionsCount: 10, imageCount: 10, finalCuratorCount: 40, addedCuratorCount: 10, estimatedInputTokens: 255000, contextChars: 937000 });
    expect(b.maxOutputTokens).toBeGreaterThanOrEqual(64000);
    expect(b.visibleEstimate).toBeGreaterThan(0);
    expect(b.reasoningReserve).toBeGreaterThan(0);
    expect(b.complexityReserve).toBeGreaterThan(0);
  });

  it("keeps low small-context budgets lower while respecting the floor", () => {
    const low = computeOutputBudget({ reasoningEffort: "low", minutesMax: 12, decisionsCount: 10, estimatedInputTokens: 12000, contextChars: 5000 });
    const xhigh = computeOutputBudget({ reasoningEffort: "xhigh", minutesMax: 12, decisionsCount: 10 });
    expect(low.maxOutputTokens).toBeGreaterThanOrEqual(16384);
    expect(low.maxOutputTokens).toBeLessThan(xhigh.maxOutputTokens);
  });

  it("increases for input, curators, dynamic curators, minutes, and retries", () => {
    const base = computeMaxOutputTokens({ effort: "high", minutesMax: 12, decisionsCount: 10, estimatedInputTokens: 1000, curatorCount: 2 });
    expect(computeMaxOutputTokens({ effort: "high", minutesMax: 20, decisionsCount: 10, estimatedInputTokens: 250000, curatorCount: 40, dynamicCuratorCount: 10 })).toBeGreaterThan(base);
    expect(computeMaxOutputTokens({ effort: "low", minutesMax: 12, decisionsCount: 10, previousIncompleteTokens: base })).toBeGreaterThan(base);
    expect(computeMaxOutputTokens({ effort: "low", minutesMax: 12, decisionsCount: 10, attempt: 2 })).toBeGreaterThan(computeMaxOutputTokens({ effort: "low", minutesMax: 12, decisionsCount: 10 }));
  });

  it("respects caps and context clamps without going negative", () => {
    process.env.PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP = "70000";
    expect(computeOutputBudget({ model: "gpt-5.4", reasoningEffort: "xhigh", estimatedInputTokens: 255000, minutesMax: 77, decisionsCount: 10, finalCuratorCount: 40 }).maxOutputTokens).toBe(70000);
    const constrained = computeOutputBudget({ reasoningEffort: "xhigh", estimatedInputTokens: 255000, modelContextWindow: 300000, minutesMax: 77, decisionsCount: 10 });
    expect(constrained.maxOutputTokens).toBeLessThanOrEqual(37000);
    expect(constrained.warnings.length).toBeGreaterThan(0);
    process.env.PHOTO_SELECT_CONTEXT_WINDOW_TOKENS = "10000";
    expect(clampToContextWindow({ desiredMaxOutputTokens: 65536, estimatedInputTokens: 999999 })).toBe(0);
  });

  it("estimates high-detail image input tokens", () => {
    expect(estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5, imageDetail: "high" })).toBeGreaterThan(0);
  });
});
