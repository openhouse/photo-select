// src/tokenEstimate.js

export const ALLOWED_REASONING_EFFORTS = ["auto", "minimal", "low", "medium", "high", "xhigh"];

const numEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};
const roundUp = (n, step = 1024) => (!Number.isFinite(n) || n <= 0 ? 0 : Math.ceil(n / step) * step);
const normalizeEffort = (effort) => String(effort || "low").toLowerCase();
const clamp = (value, min, max) => {
  const upper = Math.max(0, max);
  return Math.max(Math.max(0, Math.min(min, upper)), Math.min(Math.ceil(value), upper));
};

function envNameForModel(model, kind) {
  const normalized = String(model || "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (/GPT54/.test(normalized)) return `PHOTO_SELECT_${kind}_GPT54`;
  if (/GPT5/.test(normalized)) return `PHOTO_SELECT_${kind}_GPT5`;
  return `PHOTO_SELECT_${kind}_DEFAULT`;
}

export function getModelLimits(model = "") {
  const text = String(model || "").toLowerCase();
  const defaultContext = text.includes("gpt-5.4") ? 1_000_000 : 400_000;
  return {
    contextWindow: numEnv("PHOTO_SELECT_MODEL_CONTEXT_WINDOW", numEnv(envNameForModel(model, "CONTEXT_WINDOW"), defaultContext)),
    maxOutputTokens: numEnv("PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", numEnv(envNameForModel(model, "MAX_OUTPUT"), 128_000)),
  };
}

function effortBase(effort) {
  const normalized = normalizeEffort(effort);
  const defaults = { none: 0, minimal: 2_000, low: 6_000, medium: 16_000, high: 32_000, xhigh: 64_000, auto: 16_000 };
  return numEnv(`PHOTO_SELECT_REASONING_BASE_${normalized.toUpperCase()}`, defaults[normalized] ?? defaults.low);
}

function minimumForEffort(effort) {
  const normalized = normalizeEffort(effort);
  if (normalized === "xhigh") return numEnv("PHOTO_SELECT_MIN_OUTPUT_XHIGH", numEnv("PHOTO_SELECT_XHIGH_MIN_OUTPUT_TOKENS", 64_000));
  if (normalized === "high") return numEnv("PHOTO_SELECT_MIN_OUTPUT_HIGH", numEnv("PHOTO_SELECT_HIGH_MIN_OUTPUT_TOKENS", 32_000));
  if (normalized === "medium") return numEnv("PHOTO_SELECT_MIN_OUTPUT_MEDIUM", 16_000);
  if (normalized === "low") return numEnv("PHOTO_SELECT_MIN_OUTPUT_LOW", 16_384);
  return numEnv("PHOTO_SELECT_MIN_OUTPUT_DEFAULT", numEnv("PHOTO_SELECT_MIN_OUTPUT_TOKENS", 8192));
}

function retryMultiplierForAttempt(attempt) {
  const n = Math.max(1, Number(attempt) || 1);
  if (n <= 1) return 1;
  const configured = (process.env.PHOTO_SELECT_OUTPUT_RETRY_MULTIPLIERS || "")
    .split(',')
    .map((v) => Number(v.trim()))
    .filter(Number.isFinite);
  if (configured[n - 2] > 0) return configured[n - 2];
  const base = numEnv("PHOTO_SELECT_OUTPUT_RETRY_MULTIPLIER", 1.5);
  return n === 2 ? base : base * (n - 1);
}

export function estimateVisibleTokens({ minutesCount, decisionsCount, minutesMax, verbosity = "medium", maxWordsPerLine }) {
  if (maxWordsPerLine != null || minutesMax == null) {
    const words = (minutesCount || 0) * (maxWordsPerLine ?? 18) + (decisionsCount || 0) * 16;
    return Math.ceil(words * 1.3) + 300;
  }
  const minuteWords = (minutesMax || 0) * ({ low: 35, medium: 50, high: 70 }[verbosity] ?? 50);
  const decisionWords = (decisionsCount || 0) * ({ low: 18, medium: 28, high: 40 }[verbosity] ?? 28);
  const overhead = numEnv("PHOTO_SELECT_OUTPUT_JSON_OVERHEAD", 800) + (minutesMax || 0) * 18 + (decisionsCount || 0) * 24;
  return Math.ceil((minuteWords + decisionWords) * 1.35 + overhead);
}

export function computeOutputBudget({
  model = "",
  reasoningEffort,
  effort,
  verbosity = "medium",
  minutesMin = 3,
  minutesMax,
  minutesCount,
  decisionsCount = 10,
  imageCount = decisionsCount,
  finalCuratorCount,
  addedCuratorCount,
  curatorCount = finalCuratorCount ?? 0,
  baseCuratorCount = curatorCount,
  dynamicCuratorCount = addedCuratorCount ?? Math.max(0, curatorCount - baseCuratorCount),
  estimatedInputTokens = 0,
  contextChars,
  promptChars = 0,
  schemaChars = 0,
  attempt = 1,
  modelContextWindow,
  isRepair = false,
  previousIncompleteTokens = 0,
} = {}) {
  const normalizedEffort = normalizeEffort(reasoningEffort ?? effort ?? "low");
  const effectiveMinutesMax = minutesMax ?? minutesCount ?? 12;
  const effectiveContextChars = contextChars ?? promptChars + schemaChars;
  const finalCount = finalCuratorCount ?? curatorCount ?? 0;
  const dynamicCount = addedCuratorCount ?? dynamicCuratorCount ?? Math.max(0, finalCount - (baseCuratorCount ?? finalCount));
  const visibleEstimate = Math.max(
    estimateVisibleTokens({ minutesMax: effectiveMinutesMax, decisionsCount, verbosity }),
    numEnv("PHOTO_SELECT_OUTPUT_JSON_OVERHEAD", 800) +
      Math.ceil(effectiveMinutesMax * numEnv("PHOTO_SELECT_OUTPUT_TOKENS_PER_MINUTE", 120)) +
      Math.ceil(decisionsCount * numEnv("PHOTO_SELECT_OUTPUT_TOKENS_PER_DECISION", 80))
  );
  const reasoningReserve = effortBase(normalizedEffort);
  const promptReserve = effectiveContextChars >= 750_000 ? 10_000 : effectiveContextChars >= 250_000 ? 5_000 : effectiveContextChars >= 50_000 ? 2_000 : 0;
  const contextComplexityReserve = Math.ceil(Math.max(0, estimatedInputTokens) * numEnv("PHOTO_SELECT_CONTEXT_COMPLEXITY_RATIO", 0.10)) + promptReserve;
  const curatorReserve = finalCount * numEnv("PHOTO_SELECT_CURATOR_REASONING_TOKENS", 350) + dynamicCount * numEnv("PHOTO_SELECT_DYNAMIC_CURATOR_REASONING_TOKENS", 500);
  const imageReserve = (imageCount || 0) * numEnv("PHOTO_SELECT_IMAGE_REASONING_TOKENS", 1000);
  const complexityReserve = contextComplexityReserve + curatorReserve + imageReserve;
  const margin = numEnv("PHOTO_SELECT_OUTPUT_SAFETY_MARGIN", Math.max(4000, Math.ceil(visibleEstimate * 0.5)));
  const retryMultiplier = retryMultiplierForAttempt(attempt);
  const computed = Math.max(
    (visibleEstimate + reasoningReserve + complexityReserve + margin) * retryMultiplier,
    isRepair ? 12_288 : 0,
    previousIncompleteTokens > 0 ? Math.ceil(previousIncompleteTokens * 1.75) : 0
  );
  const limits = getModelLimits(model);
  if (modelContextWindow != null) limits.contextWindow = Number(modelContextWindow) || limits.contextWindow;
  const contextSafety = numEnv("PHOTO_SELECT_CONTEXT_SAFETY_MARGIN", numEnv("PHOTO_SELECT_CONTEXT_SAFETY_TOKENS", 8000));
  const contextRemaining = Math.max(0, limits.contextWindow - estimatedInputTokens - contextSafety);
  const contextWindowLimit = limits.contextWindow ? contextRemaining : limits.maxOutputTokens;
  const hardCap = Math.max(0, Math.min(limits.maxOutputTokens, contextWindowLimit));
  const minUseful = minimumForEffort(normalizedEffort);
  const maxOutputTokens = clamp(roundUp(Math.max(computed, minUseful)), Math.min(minUseful, hardCap), hardCap);
  const warnings = hardCap > 0 && hardCap < minUseful
    ? [`output budget constrained: requested min ${minUseful}, hard cap ${hardCap} because estimated input tokens are near context limit`]
    : [];
  const details = {
    model,
    effort: normalizedEffort,
    verbosity,
    minutesMin,
    minutesMax: effectiveMinutesMax,
    decisionsCount,
    imageCount,
    finalCuratorCount: finalCount,
    addedCuratorCount: dynamicCount,
    baseCuratorCount,
    estimatedInputTokens,
    contextChars: effectiveContextChars,
    promptChars,
    schemaChars,
    attempt,
    isRepair,
    previousIncompleteTokens,
  };
  return {
    maxOutputTokens,
    visibleEstimate,
    visible: visibleEstimate,
    reasoningReserve,
    effortBase: reasoningReserve,
    complexityReserve,
    contextComplexityReserve,
    curatorReserve,
    imageReserve,
    margin,
    retryMultiplier,
    cap: limits.maxOutputTokens,
    hardCap,
    contextRemaining,
    contextWindowLimit,
    limits,
    warnings,
    details,
  };
}

/** Adaptive cap for Responses 'max_output_tokens'. */
export const computeMaxOutputTokens = (options = {}) => computeOutputBudget(options).maxOutputTokens;

export function clampToContextWindow({ desiredMaxOutputTokens, estimatedInputTokens }) {
  const contextWindow = numEnv("PHOTO_SELECT_CONTEXT_WINDOW_TOKENS", numEnv("PHOTO_SELECT_MODEL_CONTEXT_WINDOW", 0));
  if (!contextWindow) return desiredMaxOutputTokens;
  const safety = numEnv("PHOTO_SELECT_CONTEXT_SAFETY_TOKENS", numEnv("PHOTO_SELECT_CONTEXT_SAFETY_MARGIN", 8192));
  return Math.max(0, Math.min(desiredMaxOutputTokens, Math.max(0, contextWindow - estimatedInputTokens - safety)));
}

export function estimateInputTokens({ instructions = "", schemaJson = "", imageCount = 0, imageDetail = "low", extraText = "" }) {
  const textTokens = Math.ceil(((instructions.length || 0) + (schemaJson.length || 0) + (extraText.length || 0)) / 4);
  const perImage = imageDetail === "high" ? numEnv("PHOTO_SELECT_TOKENS_PER_IMAGE_HIGH", 900) : numEnv("PHOTO_SELECT_TOKENS_PER_IMAGE_LOW", 150);
  return textTokens + imageCount * perImage;
}

export function outputBudgetMetadata(budget) {
  return {
    max_output_tokens: budget.maxOutputTokens, estimated_input_tokens: budget.details?.estimatedInputTokens,
    visible: budget.visibleEstimate, effort_base: budget.effortBase, reasoning_reserve: budget.reasoningReserve,
    complexity_reserve: budget.complexityReserve, context_complexity_reserve: budget.contextComplexityReserve,
    curator_reserve: budget.curatorReserve, image_reserve: budget.imageReserve, margin: budget.margin,
    hard_cap: budget.hardCap, cap: budget.cap, context_remaining: budget.contextRemaining,
    context_window_limit: budget.contextWindowLimit, retry_multiplier: budget.retryMultiplier,
    curator_count: budget.details?.finalCuratorCount, base_curator_count: budget.details?.baseCuratorCount,
    dynamic_curator_count: budget.details?.addedCuratorCount, minutes_min: budget.details?.minutesMin,
    minutes_max: budget.details?.minutesMax, decisions_count: budget.details?.decisionsCount,
    image_count: budget.details?.imageCount, effort: budget.details?.effort,
    verbosity: budget.details?.verbosity, attempt: budget.details?.attempt, warnings: budget.warnings,
  };
}
