// src/tokenEstimate.js

export const numEnv = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

function normalizeEffort(effort = "low") {
  return String(effort || "low").toLowerCase();
}

function normalizeVerbosity(verbosity = "medium") {
  const v = String(verbosity || "medium").toLowerCase();
  return ["low", "medium", "high"].includes(v) ? v : "medium";
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function roundUp(n, step = 1024) {
  return Math.ceil(n / step) * step;
}

function modelEnvSuffix(model = "") {
  const m = String(model).toLowerCase();
  if (m.includes("gpt-5.4") || m.includes("gpt-54")) return "GPT54";
  if (m.includes("gpt-5")) return "GPT5";
  return "DEFAULT";
}

export function getModelLimits(model = "") {
  const suffix = modelEnvSuffix(model);
  const defaultContext = suffix === "GPT54" ? 1_000_000 : 400_000;
  return {
    contextWindow: numEnv(
      `PHOTO_SELECT_CONTEXT_WINDOW_${suffix}`,
      numEnv("PHOTO_SELECT_MODEL_CONTEXT_WINDOW", numEnv("PHOTO_SELECT_CONTEXT_WINDOW_TOKENS", defaultContext))
    ),
    maxOutputTokens: numEnv(
      `PHOTO_SELECT_MAX_OUTPUT_${suffix}`,
      numEnv("PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", numEnv("PHOTO_SELECT_MAX_OUTPUT_DEFAULT", 128_000))
    ),
  };
}

export function getEffortBase(effort = "low") {
  const normalized = normalizeEffort(effort);
  const defaults = {
    none: 0,
    minimal: 2_000,
    low: 6_000,
    medium: 16_000,
    high: 32_000,
    xhigh: 64_000,
    auto: 16_000,
  };
  const envName = `PHOTO_SELECT_REASONING_BASE_${normalized.toUpperCase()}`;
  return numEnv(envName, defaults[normalized] ?? defaults.low);
}

export function minimumForEffort(effort = "low") {
  const normalized = normalizeEffort(effort);
  if (normalized === "xhigh") return numEnv("PHOTO_SELECT_MIN_OUTPUT_XHIGH", numEnv("PHOTO_SELECT_XHIGH_MIN_OUTPUT_TOKENS", 64_000));
  if (normalized === "high") return numEnv("PHOTO_SELECT_MIN_OUTPUT_HIGH", numEnv("PHOTO_SELECT_HIGH_MIN_OUTPUT_TOKENS", 32_000));
  if (normalized === "medium") return numEnv("PHOTO_SELECT_MIN_OUTPUT_MEDIUM", 16_000);
  if (normalized === "low") return numEnv("PHOTO_SELECT_MIN_OUTPUT_LOW", 16_384);
  if (normalized === "minimal") return numEnv("PHOTO_SELECT_MIN_OUTPUT_MINIMAL", 8_192);
  return numEnv("PHOTO_SELECT_MIN_OUTPUT_DEFAULT", 8_192);
}

function retryMultiplierForAttempt(attempt = 1) {
  const normalized = Math.max(1, Number(attempt) || 1);
  if (normalized <= 1) return 1;
  const list = String(process.env.PHOTO_SELECT_OUTPUT_RETRY_MULTIPLIERS || "")
    .split(",")
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0);
  if (list.length) return list[Math.min(normalized - 2, list.length - 1)];
  const base = numEnv("PHOTO_SELECT_OUTPUT_RETRY_MULTIPLIER", 1.5);
  return normalized === 2 ? base : normalized === 3 ? Math.max(base * base, 2.25) : Math.pow(base, normalized - 1);
}

export function estimateVisibleTokens({
  minutesCount,
  minutesMax = minutesCount ?? 12,
  decisionsCount = 10,
  maxWordsPerLine,
  verbosity = "medium",
}) {
  if (maxWordsPerLine != null) {
    const words = (minutesCount ?? minutesMax) * maxWordsPerLine + decisionsCount * 16;
    return Math.ceil(words * 1.3) + 300;
  }
  const v = normalizeVerbosity(verbosity);
  const minuteTokens = numEnv(
    "PHOTO_SELECT_OUTPUT_TOKENS_PER_MINUTE",
    { low: 90, medium: 120, high: 160 }[v]
  );
  const decisionTokens = numEnv(
    "PHOTO_SELECT_OUTPUT_TOKENS_PER_DECISION",
    { low: 60, medium: 80, high: 110 }[v]
  );
  const jsonOverhead = numEnv("PHOTO_SELECT_OUTPUT_JSON_OVERHEAD", 800);
  return jsonOverhead + Math.ceil((minutesMax ?? 0) * minuteTokens) + Math.ceil(decisionsCount * decisionTokens);
}

export function computeOutputBudget({
  model = "",
  reasoningEffort,
  effort = reasoningEffort || "low",
  verbosity = "medium",
  estimatedInputTokens = 0,
  minutesMin = 3,
  minutesMax,
  minutesCount,
  decisionsCount = 10,
  imageCount = decisionsCount,
  finalCuratorCount,
  curatorCount = finalCuratorCount ?? 0,
  addedCuratorCount,
  baseCuratorCount = curatorCount,
  dynamicCuratorCount = addedCuratorCount ?? Math.max(0, curatorCount - baseCuratorCount),
  promptChars = 0,
  contextChars = promptChars,
  schemaChars = 0,
  attempt = 1,
  budgetAttempt = attempt,
  modelContextWindow,
  previousIncompleteTokens = 0,
  isRepair = false,
} = {}) {
  const normalizedEffort = isRepair ? "low" : normalizeEffort(effort);
  const limits = getModelLimits(model);
  if (modelContextWindow != null) limits.contextWindow = Number(modelContextWindow) || limits.contextWindow;

  const visible = estimateVisibleTokens({
    minutesMax: minutesMax ?? minutesCount ?? 12,
    decisionsCount,
    verbosity,
  });
  const effortBase = getEffortBase(normalizedEffort);
  const contextRatio = numEnv("PHOTO_SELECT_CONTEXT_COMPLEXITY_RATIO", 0.10);
  const contextComplexityReserve = Math.ceil(Math.max(0, estimatedInputTokens) * contextRatio);
  const promptReserve = Math.ceil(Math.max(0, contextChars + schemaChars) / 100_000) * 500;
  const curatorReserve =
    Math.max(0, curatorCount) * numEnv("PHOTO_SELECT_CURATOR_REASONING_TOKENS", 350) +
    Math.max(0, dynamicCuratorCount) * numEnv("PHOTO_SELECT_DYNAMIC_CURATOR_REASONING_TOKENS", 500);
  const imageReserve = Math.max(0, imageCount) * numEnv("PHOTO_SELECT_IMAGE_REASONING_TOKENS", 1000);
  const complexityReserve = contextComplexityReserve + promptReserve + curatorReserve + imageReserve;
  const margin = numEnv("PHOTO_SELECT_OUTPUT_SAFETY_MARGIN", Math.max(4000, Math.ceil(visible * 0.5)));
  const retryMultiplier = retryMultiplierForAttempt(budgetAttempt);
  const budgetMultiplier = numEnv("PHOTO_SELECT_OUTPUT_BUDGET_MULTIPLIER", 1);
  const retryFloor = previousIncompleteTokens > 0 ? Math.ceil(previousIncompleteTokens * retryMultiplier) : 0;
  const computed = (visible + effortBase + complexityReserve + margin) * retryMultiplier * budgetMultiplier;

  const globalCap = numEnv("PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", limits.maxOutputTokens);
  const cap = Math.max(0, Math.min(limits.maxOutputTokens, globalCap));
  const contextSafety = numEnv("PHOTO_SELECT_CONTEXT_SAFETY_MARGIN", numEnv("PHOTO_SELECT_CONTEXT_SAFETY_TOKENS", 8000));
  const contextRemaining = Math.max(0, limits.contextWindow - estimatedInputTokens - contextSafety);
  const contextWindowLimit = contextRemaining > 0 ? contextRemaining : cap;
  const hardCap = Math.max(0, Math.min(cap, contextWindowLimit));
  const repairMin = isRepair ? numEnv("PHOTO_SELECT_REPAIR_MIN_OUTPUT_TOKENS", 12_288) : 0;
  const retryMinXhigh = normalizedEffort === "xhigh" && budgetAttempt > 1
    ? numEnv("PHOTO_SELECT_OUTPUT_RETRY_MIN_XHIGH", 96_000)
    : 0;
  const minUseful = Math.max(minimumForEffort(normalizedEffort), repairMin, retryMinXhigh);
  const wanted = Math.max(Math.ceil(computed), retryFloor, minUseful);
  const constrained = hardCap < minUseful;
  const maxOutputTokens = clamp(roundUp(clamp(wanted, Math.min(minUseful, hardCap), hardCap)), 0, hardCap);
  const clamped = maxOutputTokens < roundUp(wanted);

  const warning = constrained
    ? `⚠️ output budget constrained: requested min ${minUseful}, hard cap ${hardCap} because estimated input tokens are near context limit.`
    : clamped
      ? `⚠️ output budget clamped: wanted=${roundUp(wanted)} available=${hardCap} estimated_input=${estimatedInputTokens} context_window=${limits.contextWindow}`
      : undefined;

  return {
    maxOutputTokens,
    visibleEstimate: visible,
    visible,
    reasoningReserve: effortBase,
    effortBase,
    complexityReserve,
    contextComplexityReserve,
    curatorReserve,
    imageReserve,
    margin,
    retryMultiplier,
    budgetMultiplier,
    cap,
    hardCap,
    contextWindowLimit,
    contextRemaining,
    limits,
    clamped,
    warning,
    details: {
      model,
      effort: normalizedEffort,
      verbosity,
      minutesMin,
      minutesMax: minutesMax ?? minutesCount ?? 12,
      decisionsCount,
      imageCount,
      curatorCount,
      baseCuratorCount,
      dynamicCuratorCount,
      estimatedInputTokens,
      contextChars,
      schemaChars,
      attempt: budgetAttempt,
      budgetMultiplier,
      isRepair,
      wanted: roundUp(wanted),
      hardCap,
      warning,
    },
  };
}

/** Backward-compatible wrapper for Responses 'max_output_tokens'. */
export function computeMaxOutputTokens(options = {}) {
  return computeOutputBudget(options).maxOutputTokens;
}

export function clampToContextWindow({ desiredMaxOutputTokens, estimatedInputTokens }) {
  const contextWindow = numEnv("PHOTO_SELECT_CONTEXT_WINDOW_TOKENS", numEnv("PHOTO_SELECT_MODEL_CONTEXT_WINDOW", 0));
  const safety = numEnv("PHOTO_SELECT_CONTEXT_SAFETY_TOKENS", numEnv("PHOTO_SELECT_CONTEXT_SAFETY_MARGIN", 8192));
  if (!contextWindow) return desiredMaxOutputTokens;
  const available = Math.max(0, contextWindow - estimatedInputTokens - safety);
  return Math.max(0, Math.min(desiredMaxOutputTokens, available));
}

/**
 * Cheap token estimator for input side.
 * - If you can, swap this to tiktoken: tokens = enc.encode(text).length
 * - Images are billed fuzzily; use conservative constants (override via env).
 */
export function estimateInputTokens({
  instructions = "",
  schemaJson = "",
  imageCount = 0,
  imageDetail = "low", // "low" or "high"
  extraText = "", // any other input text you include
}) {
  const TOKENS_PER_CHAR = 1 / 4; // rough heuristic
  const imageLow = numEnv("PHOTO_SELECT_TOKENS_PER_IMAGE_LOW", 150);
  const imageHigh = numEnv("PHOTO_SELECT_TOKENS_PER_IMAGE_HIGH", 900);

  const textChars =
    (instructions.length || 0) +
    (schemaJson.length || 0) +
    (extraText.length || 0);
  const textTokens = Math.ceil(textChars * TOKENS_PER_CHAR);
  const perImage = imageDetail === "high" ? imageHigh : imageLow;
  const imageTokens = imageCount * perImage;

  return textTokens + imageTokens;
}
