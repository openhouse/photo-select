import { describe, it, expect, afterEach } from "vitest";
import { computeMaxOutputTokens, computeOutputBudget, estimateInputTokens } from "../src/tokenEstimate.js";

const envKeys = [
  'PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP',
  'PHOTO_SELECT_MAX_OUTPUT_GPT54',
  'PHOTO_SELECT_CONTEXT_WINDOW_GPT54',
  'PHOTO_SELECT_MIN_OUTPUT_XHIGH',
  'PHOTO_SELECT_CONTEXT_WINDOW_DEFAULT',
  'PHOTO_SELECT_MAX_OUTPUT_DEFAULT',
];
const oldEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const key of envKeys) {
    if (oldEnv[key] == null) delete process.env[key];
    else process.env[key] = oldEnv[key];
  }
});

describe("output budget planner", () => {
  it("small low-effort prompts return at least the default floor", () => {
    const budget = computeOutputBudget({ effort: "low", estimatedInputTokens: 1000, minutesMax: 2, decisionsCount: 1 });
    expect(budget.maxOutputTokens).toBeGreaterThanOrEqual(8192);
  });

  it("scales by effort and gives xhigh a 64k minimum", () => {
    const low = computeOutputBudget({ effort: "low", estimatedInputTokens: 12000, minutesMax: 12, decisionsCount: 10 });
    const medium = computeOutputBudget({ effort: "medium", estimatedInputTokens: 12000, minutesMax: 12, decisionsCount: 10 });
    const high = computeOutputBudget({ effort: "high", estimatedInputTokens: 12000, minutesMax: 12, decisionsCount: 10 });
    const xhigh = computeOutputBudget({ effort: "xhigh", estimatedInputTokens: 12000, minutesMax: 12, decisionsCount: 10 });
    expect(medium.maxOutputTokens).toBeGreaterThan(low.maxOutputTokens);
    expect(high.maxOutputTokens).toBeGreaterThan(medium.maxOutputTokens);
    expect(xhigh.maxOutputTokens).toBeGreaterThan(high.maxOutputTokens);
    expect(xhigh.maxOutputTokens).toBeGreaterThanOrEqual(64000);
  });

  it("large-context xhigh jobs land well above 8192 with diagnostic details", () => {
    const budget = computeOutputBudget({
      model: "gpt-5.4-2026-03-05",
      effort: "xhigh",
      verbosity: "high",
      minutesMax: 77,
      decisionsCount: 10,
      imageCount: 10,
      curatorCount: 40,
      baseCuratorCount: 30,
      dynamicCuratorCount: 10,
      estimatedInputTokens: 255000,
      promptChars: 937000,
    });
    expect(budget.maxOutputTokens).toBeGreaterThanOrEqual(64000);
    expect(budget.maxOutputTokens).toBeLessThanOrEqual(128000);
    expect(budget.visibleEstimate).toBeGreaterThan(0);
    expect(budget.reasoningReserve).toBeGreaterThan(0);
    expect(budget.complexityReserve).toBeGreaterThan(0);
    expect(budget.warnings.every((warning) => /capped/.test(warning))).toBe(true);
  });

  it("input tokens, minutes, curators, dynamic curators, and images increase budget", () => {
    const base = computeOutputBudget({ effort: "medium", estimatedInputTokens: 1000, minutesMax: 4, decisionsCount: 2, imageCount: 1, curatorCount: 2, baseCuratorCount: 2 });
    expect(computeOutputBudget({ effort: "medium", estimatedInputTokens: 80000, minutesMax: 4, decisionsCount: 2, imageCount: 1, curatorCount: 2, baseCuratorCount: 2 }).maxOutputTokens).toBeGreaterThan(base.maxOutputTokens);
    expect(computeOutputBudget({ effort: "medium", estimatedInputTokens: 1000, minutesMax: 40, decisionsCount: 2, imageCount: 1, curatorCount: 2, baseCuratorCount: 2 }).maxOutputTokens).toBeGreaterThan(base.maxOutputTokens);
    expect(computeOutputBudget({ effort: "medium", estimatedInputTokens: 1000, minutesMax: 4, decisionsCount: 2, imageCount: 1, curatorCount: 20, baseCuratorCount: 20 }).maxOutputTokens).toBeGreaterThan(base.maxOutputTokens);
    expect(computeOutputBudget({ effort: "medium", estimatedInputTokens: 1000, minutesMax: 4, decisionsCount: 2, imageCount: 1, curatorCount: 20, baseCuratorCount: 2, dynamicCuratorCount: 18 }).maxOutputTokens).toBeGreaterThan(base.maxOutputTokens);
    expect(computeOutputBudget({ effort: "medium", estimatedInputTokens: 1000, minutesMax: 4, decisionsCount: 2, imageCount: 20, curatorCount: 2, baseCuratorCount: 2 }).maxOutputTokens).toBeGreaterThan(base.maxOutputTokens);
  });

  it("respects hard caps and reports constraints", () => {
    process.env.PHOTO_SELECT_MAX_OUTPUT_GPT54 = '70000';
    const budget = computeOutputBudget({ model: 'gpt-5.4', effort: 'xhigh', estimatedInputTokens: 255000, minutesMax: 77, decisionsCount: 10, imageCount: 10, curatorCount: 40, promptChars: 937000 });
    expect(budget.maxOutputTokens).toBe(70000);
    expect(budget.constrained).toBe(true);
    expect(budget.warnings.join('\n')).toMatch(/capped/);
  });

  it("reports model context constraints", () => {
    const budget = computeOutputBudget({ model: 'gpt-5.4', effort: 'xhigh', estimatedInputTokens: 255000, modelContextWindow: 300000, minutesMax: 77, decisionsCount: 10 });
    expect(budget.maxOutputTokens).toBeLessThanOrEqual(37000);
    expect(budget.warnings.join('\n')).toMatch(/context-constrained|below minimum useful/);
  });

  it("computeMaxOutputTokens remains backward-compatible", () => {
    const n = computeMaxOutputTokens({ minutesCount: 6, decisionsCount: 10, effort: "medium" });
    expect(n).toBeGreaterThanOrEqual(16000);
  });

  it("estimates input tokens with image detail", () => {
    const low = estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5, imageDetail: "low" });
    const high = estimateInputTokens({ instructions: "abc".repeat(400), imageCount: 5, imageDetail: "high" });
    expect(high).toBeGreaterThan(low);
  });
});
