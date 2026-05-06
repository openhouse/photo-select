import { afterEach, describe, expect, it } from "vitest";
import { clampToContextWindow, computeMaxOutputTokens, computeOutputBudget, estimateInputTokens } from "../src/tokenEstimate.js";

const clearEnv = () => ["PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", "PHOTO_SELECT_CONTEXT_WINDOW_TOKENS"].forEach((k) => delete process.env[k]);
const large = { model: "gpt-5.4", effort: "xhigh", verbosity: "high", minutesMax: 77, decisionsCount: 10, imageCount: 10, curatorCount: 40, baseCuratorCount: 30, dynamicCuratorCount: 10, estimatedInputTokens: 255000, contextChars: 937000 };

describe("adaptive tokens", () => {
  afterEach(clearEnv);

  it("scales xhigh large-context budgets and exposes metadata", () => {
    const b = computeOutputBudget(large);
    expect(b.maxOutputTokens).toBeGreaterThanOrEqual(64000);
    expect(b.visibleEstimate).toBeGreaterThan(0);
    expect(b.reasoningReserve).toBeGreaterThan(0);
    expect(b.complexityReserve).toBeGreaterThan(0);
  });

  it("scales with effort, input, curators, dynamic curators, retries, and minutes", () => {
    const small = computeOutputBudget({ effort: "low", minutesMax: 12, decisionsCount: 5, estimatedInputTokens: 12000, curatorCount: 4 });
    const medium = computeOutputBudget({ effort: "medium", minutesMax: 12, decisionsCount: 5, estimatedInputTokens: 12000, curatorCount: 4 });
    const larger = computeOutputBudget({ effort: "medium", minutesMax: 60, decisionsCount: 5, estimatedInputTokens: 150000, curatorCount: 24, baseCuratorCount: 4, dynamicCuratorCount: 20 });
    const retry = computeOutputBudget({ ...larger, model: "gpt-5.4", attempt: 2, previousIncompleteTokens: larger.maxOutputTokens });
    expect(small.maxOutputTokens).toBeGreaterThanOrEqual(8192);
    expect(medium.maxOutputTokens).toBeGreaterThan(small.maxOutputTokens);
    expect(larger.visibleEstimate).toBeGreaterThan(medium.visibleEstimate);
    expect(larger.maxOutputTokens).toBeGreaterThan(medium.maxOutputTokens);
    expect(retry.maxOutputTokens).toBeGreaterThan(larger.maxOutputTokens);
  });

  it("respects cap and context clamps without going negative", () => {
    process.env.PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP = "70000";
    expect(computeOutputBudget(large).maxOutputTokens).toBeLessThanOrEqual(70000);
    const clamped = computeOutputBudget({ ...large, modelContextWindow: 300000 });
    expect(clamped.maxOutputTokens).toBeLessThanOrEqual(37000);
    expect(clamped.maxOutputTokens).toBeGreaterThanOrEqual(0);
    expect(clamped.constrained).toBe(true);
    process.env.PHOTO_SELECT_CONTEXT_WINDOW_TOKENS = "1000";
    expect(clampToContextWindow({ desiredMaxOutputTokens: 5000, estimatedInputTokens: 5000 })).toBe(0);
  });

  it("keeps wrappers and high-detail image estimates working", () => {
    expect(computeMaxOutputTokens({ effort: "xhigh" })).toBeGreaterThanOrEqual(64000);
    expect(estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5, imageDetail: "high" })).toBeGreaterThan(estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5, imageDetail: "low" }));
  });
});
