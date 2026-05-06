import { describe, it, expect, afterEach } from "vitest";
import { clampToContextWindow, computeMaxOutputTokens, computeOutputBudget, estimateInputTokens } from "../src/tokenEstimate.js";
const ENV_KEYS = ["PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", "PHOTO_SELECT_MAX_OUTPUT_DEFAULT", "PHOTO_SELECT_CONTEXT_WINDOW_DEFAULT", "PHOTO_SELECT_CONTEXT_WINDOW_TOKENS", "PHOTO_SELECT_CONTEXT_SAFETY_TOKENS", "PHOTO_SELECT_MODEL_CONTEXT_WINDOW"];

describe("adaptive tokens", () => {
  afterEach(() => { for (const key of ENV_KEYS) delete process.env[key]; });
  it("scales output budgets for effort, context, curators, retries, and minutes", () => {
    const low = computeOutputBudget({ model: "gpt-5", effort: "low", minutesMax: 12, decisionsCount: 10, estimatedInputTokens: 12000, promptChars: 5000 });
    const xhigh = computeOutputBudget({ model: "gpt-5.4", effort: "xhigh", verbosity: "high", minutesMax: 77, decisionsCount: 10, imageCount: 10, curatorCount: 40, baseCuratorCount: 30, dynamicCuratorCount: 10, estimatedInputTokens: 255000, promptChars: 937000 });
    expect([xhigh.maxOutputTokens >= 64000, xhigh.maxOutputTokens > low.maxOutputTokens, xhigh.visibleEstimate > low.visibleEstimate, xhigh.reasoningReserve > 0, xhigh.complexityReserve > 0, low.maxOutputTokens >= 16384]).toEqual([true, true, true, true, true, true]);

    const base = computeOutputBudget({ effort: "high", minutesMax: 12, decisionsCount: 10, estimatedInputTokens: 12000, curatorCount: 2 });
    expect([computeOutputBudget({ effort: "high", minutesMax: 12, decisionsCount: 10, estimatedInputTokens: 255000, curatorCount: 2 }).maxOutputTokens >= base.maxOutputTokens, computeOutputBudget({ effort: "high", minutesMax: 12, decisionsCount: 10, estimatedInputTokens: 12000, curatorCount: 40 }).maxOutputTokens >= base.maxOutputTokens, computeOutputBudget({ effort: "high", minutesMax: 12, decisionsCount: 10, estimatedInputTokens: 12000, curatorCount: 40, baseCuratorCount: 20, dynamicCuratorCount: 20 }).maxOutputTokens >= base.maxOutputTokens, computeOutputBudget({ effort: "high", minutesMax: 77, decisionsCount: 10, estimatedInputTokens: 12000, curatorCount: 2 }).visibleEstimate > base.visibleEstimate]).toEqual([true, true, true, true]);

    const first = computeOutputBudget({ effort: "high", estimatedInputTokens: 12000, attempt: 1 });
    expect(computeOutputBudget({ effort: "high", estimatedInputTokens: 12000, attempt: 2, previousIncompleteTokens: first.maxOutputTokens }).maxOutputTokens).toBeGreaterThan(first.maxOutputTokens);
  });

  it("clamps to caps/context and keeps compatibility helpers", () => {
    process.env.PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP = "70000";
    expect(computeOutputBudget({ model: "gpt-5.4", effort: "xhigh", estimatedInputTokens: 255000, minutesMax: 77, curatorCount: 40 }).maxOutputTokens).toBeLessThanOrEqual(70000);
    const clamped = computeOutputBudget({ model: "gpt-5", effort: "xhigh", estimatedInputTokens: 255000, modelContextWindow: 300000 });
    expect([clamped.maxOutputTokens <= 37000, /constrained|clamped/.test(clamped.warnings.join(" "))]).toEqual([true, true]);
    Object.assign(process.env, { PHOTO_SELECT_CONTEXT_WINDOW_TOKENS: "10000", PHOTO_SELECT_CONTEXT_SAFETY_TOKENS: "2000" });
    expect([clampToContextWindow({ desiredMaxOutputTokens: 5000, estimatedInputTokens: 7000 }), clampToContextWindow({ desiredMaxOutputTokens: 5000, estimatedInputTokens: 12000 })]).toEqual([1000, 0]); delete process.env.PHOTO_SELECT_CONTEXT_WINDOW_TOKENS; expect(computeMaxOutputTokens({ effort: "xhigh" })).toBeGreaterThanOrEqual(64000);
    const low = estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5, imageDetail: "low" });
    expect(estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5, imageDetail: "high" })).toBeGreaterThan(low);
  });
});
