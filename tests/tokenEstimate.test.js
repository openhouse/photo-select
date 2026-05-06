import { describe, it, expect, afterEach } from "vitest";
import {
  clampToContextWindow,
  computeMaxOutputTokens,
  computeOutputBudget,
  estimateInputTokens,
} from "../src/tokenEstimate.js";

const restoreEnv = (keys) => {
  for (const key of keys) delete process.env[key];
};

describe("adaptive tokens", () => {
  afterEach(() => restoreEnv([
    "PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP",
    "PHOTO_SELECT_CONTEXT_WINDOW_TOKENS",
    "PHOTO_SELECT_CONTEXT_SAFETY_TOKENS",
    "PHOTO_SELECT_CONTEXT_WINDOW_DEFAULT",
    "PHOTO_SELECT_MAX_OUTPUT_DEFAULT",
  ]));

  it("computes xhigh large-context budgets far above the old floor", () => {
    const budget = computeOutputBudget({
      model: "gpt-5.4",
      effort: "xhigh",
      verbosity: "high",
      minutesMax: 77,
      decisionsCount: 10,
      imageCount: 10,
      curatorCount: 40,
      baseCuratorCount: 30,
      dynamicCuratorCount: 10,
      estimatedInputTokens: 255000,
      contextChars: 937000,
      attempt: 1,
    });
    expect(budget.maxOutputTokens).toBeGreaterThanOrEqual(64000);
    expect(budget.visibleEstimate).toBeGreaterThan(0);
    expect(budget.reasoningReserve).toBeGreaterThan(0);
    expect(budget.complexityReserve).toBeGreaterThan(0);
  });

  it("keeps low effort small-context budgets lower than xhigh", () => {
    const low = computeOutputBudget({ effort: "low", minutesMax: 12, decisionsCount: 10, estimatedInputTokens: 12000, contextChars: 5000 });
    const xhigh = computeOutputBudget({ effort: "xhigh", minutesMax: 77, decisionsCount: 10, estimatedInputTokens: 255000, contextChars: 937000 });
    expect(low.maxOutputTokens).toBeGreaterThanOrEqual(16384);
    expect(low.maxOutputTokens).toBeLessThan(xhigh.maxOutputTokens);
  });

  it("large input, curators, dynamic curators, minutes, and previous incomplete tokens raise budgets", () => {
    const base = computeMaxOutputTokens({ effort: "low", minutesMax: 6, decisionsCount: 5, estimatedInputTokens: 1000, curatorCount: 1 });
    const largeInput = computeMaxOutputTokens({ effort: "low", minutesMax: 6, decisionsCount: 5, estimatedInputTokens: 200000, curatorCount: 1 });
    const manyCurators = computeMaxOutputTokens({ effort: "low", minutesMax: 6, decisionsCount: 5, estimatedInputTokens: 1000, curatorCount: 30, baseCuratorCount: 10, dynamicCuratorCount: 20 });
    const manyMinutes = computeMaxOutputTokens({ effort: "low", minutesMax: 60, decisionsCount: 5, estimatedInputTokens: 1000, curatorCount: 1 });
    const retry = computeMaxOutputTokens({ effort: "low", previousIncompleteTokens: 50000, budgetAttempt: 2 });
    expect(largeInput).toBeGreaterThan(base);
    expect(manyCurators).toBeGreaterThan(base);
    expect(manyMinutes).toBeGreaterThan(base);
    expect(retry).toBeGreaterThan(50000);
  });

  it("caps and context-window clamps budgets without going negative", () => {
    process.env.PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP = "70000";
    const capped = computeOutputBudget({ model: "gpt-5.4", effort: "xhigh", estimatedInputTokens: 255000, minutesMax: 77, decisionsCount: 10 });
    expect(capped.maxOutputTokens).toBeLessThanOrEqual(70000);

    const clamped = computeOutputBudget({ effort: "xhigh", estimatedInputTokens: 255000, modelContextWindow: 300000 });
    expect(clamped.maxOutputTokens).toBeLessThanOrEqual(37000);
    expect(clamped.maxOutputTokens).toBeGreaterThanOrEqual(0);
    expect(clamped.warning).toMatch(/constrained|clamped/);

    process.env.PHOTO_SELECT_CONTEXT_WINDOW_TOKENS = "100";
    process.env.PHOTO_SELECT_CONTEXT_SAFETY_TOKENS = "1000";
    expect(clampToContextWindow({ desiredMaxOutputTokens: 10000, estimatedInputTokens: 200 })).toBe(0);
  });

  it("retry attempts increase budgets subject to caps", () => {
    const a1 = computeOutputBudget({ effort: "high", minutesMax: 20, decisionsCount: 10, estimatedInputTokens: 50000, attempt: 1 });
    const a2 = computeOutputBudget({ effort: "high", minutesMax: 20, decisionsCount: 10, estimatedInputTokens: 50000, attempt: 2 });
    const a3 = computeOutputBudget({ effort: "high", minutesMax: 20, decisionsCount: 10, estimatedInputTokens: 50000, attempt: 3 });
    expect(a2.maxOutputTokens).toBeGreaterThan(a1.maxOutputTokens);
    expect(a3.maxOutputTokens).toBeGreaterThanOrEqual(a2.maxOutputTokens);
  });

  it("estimates input tokens with image detail", () => {
    const low = estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5, imageDetail: "low" });
    const high = estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5, imageDetail: "high" });
    expect(high).toBeGreaterThan(low);
  });
});
