// src/tokenEstimate.js

export const numEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const roundUp = (n, step = 1024) => Math.ceil(n / step) * step;
const clamp = (n, min, max) => (max <= 0 ? 0 : Math.max(min, Math.min(max, n)));
const normalizedEffort = (effort = "low") => String(effort || "low").toLowerCase();
const suffix = (effort) => (effort === "xhigh" ? "XHIGH" : String(effort).toUpperCase());

export function getModelLimits(model = "") {
  const m = String(model).toLowerCase();
  if (m.startsWith("gpt-5.4")) return { contextWindow: numEnv("PHOTO_SELECT_CONTEXT_WINDOW_GPT54", 1_000_000), maxOutputTokens: numEnv("PHOTO_SELECT_MAX_OUTPUT_GPT54", 128_000) };
  if (m.startsWith("gpt-5")) return { contextWindow: numEnv("PHOTO_SELECT_CONTEXT_WINDOW_GPT5", 400_000), maxOutputTokens: numEnv("PHOTO_SELECT_MAX_OUTPUT_GPT5", 128_000) };
  return { contextWindow: numEnv("PHOTO_SELECT_CONTEXT_WINDOW_DEFAULT", 400_000), maxOutputTokens: numEnv("PHOTO_SELECT_MAX_OUTPUT_DEFAULT", 128_000) };
}

export function getEffortBase(effort = "low") {
  const e = normalizedEffort(effort);
  const defaults = { none: 0, minimal: 2_000, low: 6_000, medium: 16_000, high: 32_000, xhigh: 64_000, auto: 16_000 };
  return numEnv(`PHOTO_SELECT_REASONING_BASE_${suffix(e)}`, defaults[e] ?? defaults.low);
}

export function minimumForEffort(effort = "low") {
  const e = normalizedEffort(effort);
  if (e === "xhigh") return numEnv("PHOTO_SELECT_MIN_OUTPUT_XHIGH", 64_000);
  if (e === "high") return numEnv("PHOTO_SELECT_MIN_OUTPUT_HIGH", 32_000);
  if (e === "medium") return numEnv("PHOTO_SELECT_MIN_OUTPUT_MEDIUM", 16_000);
  if (e === "minimal") return numEnv("PHOTO_SELECT_MIN_OUTPUT_MINIMAL", 8192);
  return numEnv("PHOTO_SELECT_MIN_OUTPUT_DEFAULT", 8192);
}

export function retryMultiplier(attempt = 1) {
  const n = Number(attempt);
  if (!Number.isFinite(n) || n <= 1) return 1;
  const values = String(process.env.PHOTO_SELECT_OUTPUT_RETRY_MULTIPLIERS || "")
    .split(",").map((v) => Number(v.trim())).filter(Number.isFinite);
  if (values[n - 2] != null) return values[n - 2];
  const base = numEnv("PHOTO_SELECT_OUTPUT_RETRY_MULTIPLIER", 1.5);
  return n === 2 ? base : n === 3 ? 2 : Math.pow(base, n - 1);
}

export function estimateVisibleTokens({ minutesCount, minutesMax, decisionsCount = 0, maxWordsPerLine, verbosity = "medium" } = {}) {
  if (Number.isFinite(maxWordsPerLine)) {
    const words = Number(minutesCount ?? minutesMax ?? 0) * maxWordsPerLine + decisionsCount * 16;
    return Math.ceil(words * 1.3) + 300;
  }
  const minuteCount = Number(minutesMax ?? minutesCount ?? 0);
  const perMinute = { low: 85, medium: 120, high: 165 };
  const perDecision = { low: 55, medium: 80, high: 115 };
  return numEnv("PHOTO_SELECT_OUTPUT_JSON_OVERHEAD", 800) +
    Math.ceil(minuteCount * numEnv("PHOTO_SELECT_OUTPUT_TOKENS_PER_MINUTE", perMinute[verbosity] ?? 120)) +
    Math.ceil(decisionsCount * numEnv("PHOTO_SELECT_OUTPUT_TOKENS_PER_DECISION", perDecision[verbosity] ?? 80));
}

export function computeOutputBudget(options = {}) {
  const {
    model = "", verbosity = "medium", estimatedInputTokens = 0, minutesMin = 3,
    minutesMax, minutesCount, decisionsCount = 10, imageCount = decisionsCount,
    promptChars = 0, contextChars, schemaChars = 0, attempt = 1, modelContextWindow,
    isRepair = false, previousIncompleteTokens = 0,
  } = options;
  const effort = normalizedEffort(options.reasoningEffort ?? options.effort ?? "low");
  const finalCuratorCount = Number(options.finalCuratorCount ?? options.curatorCount ?? 0);
  const baseCuratorCount = Number(options.baseCuratorCount ?? finalCuratorCount);
  const dynamicCuratorCount = Number(options.dynamicCuratorCount ?? options.addedCuratorCount ?? Math.max(0, finalCuratorCount - baseCuratorCount));
  const estimated = Math.max(0, Number(estimatedInputTokens) || 0);
  const limits = getModelLimits(model);
  const contextWindow = Number(modelContextWindow || process.env.PHOTO_SELECT_MODEL_CONTEXT_WINDOW || process.env.PHOTO_SELECT_CONTEXT_WINDOW_TOKENS || limits.contextWindow || 0);
  const visibleEstimate = estimateVisibleTokens({ minutesMax: Number(minutesMax ?? minutesCount ?? 12), decisionsCount, verbosity });
  const effortBase = getEffortBase(effort);
  const contextComplexityReserve = Math.ceil(estimated * numEnv("PHOTO_SELECT_CONTEXT_COMPLEXITY_RATIO", 0.10));
  const promptComplexityReserve = Math.ceil(((Number(contextChars ?? promptChars) || 0) + (Number(schemaChars) || 0)) / 100_000) * numEnv("PHOTO_SELECT_PROMPT_CHARS_RESERVE_PER_100K", 1000);
  const curatorReserve = finalCuratorCount * numEnv("PHOTO_SELECT_CURATOR_REASONING_TOKENS", 350) + dynamicCuratorCount * numEnv("PHOTO_SELECT_DYNAMIC_CURATOR_REASONING_TOKENS", 500);
  const imageReserve = Math.max(0, Number(imageCount) || 0) * numEnv("PHOTO_SELECT_IMAGE_REASONING_TOKENS", 1000);
  const complexityReserve = contextComplexityReserve + promptComplexityReserve + curatorReserve + imageReserve;
  const margin = numEnv("PHOTO_SELECT_OUTPUT_SAFETY_MARGIN", Math.max(4000, Math.ceil(visibleEstimate * 0.5)));
  const multiplier = retryMultiplier(attempt);
  const retryMin = effort === "xhigh" && Number(attempt) > 1 ? numEnv("PHOTO_SELECT_OUTPUT_RETRY_MIN_XHIGH", Number(attempt) >= 3 ? 128_000 : 96_000) : 0;
  const requested = Math.max(
    Math.ceil((visibleEstimate + effortBase + complexityReserve + margin) * multiplier),
    isRepair ? numEnv("PHOTO_SELECT_REPAIR_MIN_OUTPUT_TOKENS", 12_288) : 0,
    previousIncompleteTokens > 0 ? Math.ceil(previousIncompleteTokens * 1.75) : 0,
    retryMin,
    minimumForEffort(effort),
  );
  const cap = Math.min(limits.maxOutputTokens, numEnv("PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", limits.maxOutputTokens));
  const safety = numEnv("PHOTO_SELECT_CONTEXT_SAFETY_MARGIN", numEnv("PHOTO_SELECT_CONTEXT_SAFETY_TOKENS", 8000));
  const contextRemaining = contextWindow ? Math.max(0, contextWindow - estimated - safety) : 0;
  const hardCap = contextWindow ? Math.max(0, Math.min(cap, contextRemaining)) : Math.max(0, cap);
  const maxOutputTokens = clamp(roundUp(requested), Math.min(minimumForEffort(effort), hardCap), hardCap);
  const warnings = requested > hardCap && hardCap > 0 ? [`output budget constrained: requested ${roundUp(requested)}, hard cap ${hardCap} because estimated input tokens are near context/output limit.`] : [];
  const details = { effort, verbosity, minutesMin, minutesMax: Number(minutesMax ?? minutesCount ?? 12), decisionsCount, imageCount, finalCuratorCount, baseCuratorCount, dynamicCuratorCount, estimatedInputTokens: estimated, promptChars, contextChars: Number(contextChars ?? promptChars) || 0, schemaChars, attempt, requested: roundUp(requested) };
  return { maxOutputTokens, visibleEstimate, visible: visibleEstimate, reasoningReserve: effortBase, effortBase, complexityReserve, contextComplexityReserve, promptComplexityReserve, curatorReserve, imageReserve, margin, retryMultiplier: multiplier, cap, hardCap, contextWindowLimit: contextRemaining, contextRemaining, limits, constrained: warnings.length > 0, warnings, details };
}

export function computeMaxOutputTokens(options = {}) {
  return computeOutputBudget(options).maxOutputTokens;
}

export function clampToContextWindow({ desiredMaxOutputTokens, estimatedInputTokens }) {
  const contextWindow = numEnv("PHOTO_SELECT_CONTEXT_WINDOW_TOKENS", 0);
  if (!contextWindow) return desiredMaxOutputTokens;
  const available = Math.max(0, contextWindow - estimatedInputTokens - numEnv("PHOTO_SELECT_CONTEXT_SAFETY_TOKENS", 8192));
  return Math.max(0, Math.min(desiredMaxOutputTokens, available));
}

export function estimateInputTokens({ instructions = "", schemaJson = "", imageCount = 0, imageDetail = "low", extraText = "" }) {
  const textChars = (instructions.length || 0) + (schemaJson.length || 0) + (extraText.length || 0);
  const perImage = imageDetail === "high" ? numEnv("PHOTO_SELECT_TOKENS_PER_IMAGE_HIGH", 900) : numEnv("PHOTO_SELECT_TOKENS_PER_IMAGE_LOW", 150);
  return Math.ceil(textChars / 4) + imageCount * perImage;
}
