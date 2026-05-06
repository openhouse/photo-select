// src/tokenEstimate.js
export const numEnv = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const roundUp = (n, step = 1024) => (!Number.isFinite(n) || n <= 0 ? 0 : Math.ceil(n / step) * step);
const normEffort = (effort) => String(effort || "low").toLowerCase();
const normVerbosity = (verbosity) => (["low", "medium", "high"].includes(String(verbosity || "medium").toLowerCase()) ? String(verbosity || "medium").toLowerCase() : "medium");
const WORDS_PER_MINUTE_ITEM = { low: 35, medium: 50, high: 70 };
const WORDS_PER_DECISION_REASON = { low: 18, medium: 28, high: 40 };

export function estimateVisibleTokens({ minutesCount, minutesMax = minutesCount ?? 12, decisionsCount = 10, verbosity = "medium", maxWordsPerLine }) {
  if (maxWordsPerLine != null) return Math.ceil(((minutesCount ?? minutesMax) * maxWordsPerLine + decisionsCount * 16) * 1.3) + 300;
  const level = normVerbosity(verbosity);
  const minuteWords = Math.max(0, minutesMax) * (WORDS_PER_MINUTE_ITEM[level] ?? 50);
  const decisionWords = Math.max(0, decisionsCount) * (WORDS_PER_DECISION_REASON[level] ?? 28);
  return Math.ceil((minuteWords + decisionWords) * 1.35 + 800 + Math.max(0, minutesMax) * 18 + Math.max(0, decisionsCount) * 24);
}

function getModelLimits(model = "") {
  const m = String(model || "").toLowerCase();
  if (m.startsWith("gpt-5.4")) return { contextWindow: numEnv("PHOTO_SELECT_CONTEXT_WINDOW_GPT54", numEnv("PHOTO_SELECT_MODEL_CONTEXT_WINDOW", 1_000_000)), maxOutputTokens: numEnv("PHOTO_SELECT_MAX_OUTPUT_GPT54", numEnv("PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", 128_000)) };
  if (m.startsWith("gpt-5")) return { contextWindow: numEnv("PHOTO_SELECT_CONTEXT_WINDOW_GPT5", numEnv("PHOTO_SELECT_MODEL_CONTEXT_WINDOW", 400_000)), maxOutputTokens: numEnv("PHOTO_SELECT_MAX_OUTPUT_GPT5", numEnv("PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", 128_000)) };
  return { contextWindow: numEnv("PHOTO_SELECT_CONTEXT_WINDOW_DEFAULT", numEnv("PHOTO_SELECT_MODEL_CONTEXT_WINDOW", 400_000)), maxOutputTokens: numEnv("PHOTO_SELECT_MAX_OUTPUT_DEFAULT", numEnv("PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", 128_000)) };
}

function getEffortBase(effort) {
  const level = normEffort(effort);
  const envName = { none: "PHOTO_SELECT_REASONING_BASE_NONE", minimal: "PHOTO_SELECT_REASONING_BASE_MINIMAL", low: "PHOTO_SELECT_REASONING_BASE_LOW", medium: "PHOTO_SELECT_REASONING_BASE_MEDIUM", high: "PHOTO_SELECT_REASONING_BASE_HIGH", xhigh: "PHOTO_SELECT_REASONING_BASE_XHIGH", auto: "PHOTO_SELECT_REASONING_BASE_AUTO" }[level];
  const defaults = { none: 0, minimal: 2_000, low: 6_000, medium: 16_000, high: 32_000, xhigh: 64_000, auto: 16_000 };
  return numEnv(envName || "PHOTO_SELECT_REASONING_BASE_LOW", defaults[level] ?? defaults.low);
}

function minimumForEffort(effort) {
  const level = normEffort(effort);
  if (level === "xhigh") return numEnv("PHOTO_SELECT_XHIGH_MIN_OUTPUT_TOKENS", numEnv("PHOTO_SELECT_MIN_OUTPUT_XHIGH", 64_000));
  if (level === "high") return numEnv("PHOTO_SELECT_HIGH_MIN_OUTPUT_TOKENS", numEnv("PHOTO_SELECT_MIN_OUTPUT_HIGH", 40_000));
  if (level === "medium") return numEnv("PHOTO_SELECT_MIN_OUTPUT_MEDIUM", 28_000);
  if (level === "low") return numEnv("PHOTO_SELECT_MIN_OUTPUT_LOW", 16_384);
  if (level === "auto") return numEnv("PHOTO_SELECT_MIN_OUTPUT_AUTO", 28_000);
  return numEnv("PHOTO_SELECT_MIN_OUTPUT_DEFAULT", 8192);
}

function retryMultiplier(attempt) {
  const n = Math.max(1, Number(attempt) || 1);
  if (n <= 1) return 1;
  const configured = (process.env.PHOTO_SELECT_OUTPUT_RETRY_MULTIPLIERS || "").split(",").map((p) => Number(p.trim())).filter((v) => Number.isFinite(v) && v > 0);
  if (configured[n - 2]) return configured[n - 2];
  const base = numEnv("PHOTO_SELECT_OUTPUT_RETRY_MULTIPLIER", 1.6);
  return n === 2 ? base : Math.max(base, 2.25 + (n - 3) * 0.75);
}

export function computeOutputBudget({
  model = "", reasoningEffort, effort = reasoningEffort || "low", verbosity = "medium",
  estimatedInputTokens = 0, minutesMin = 3, minutesMax, minutesCount, decisionsCount = 10, imageCount = decisionsCount,
  finalCuratorCount, addedCuratorCount, curatorCount = finalCuratorCount ?? 0, baseCuratorCount = curatorCount,
  dynamicCuratorCount = addedCuratorCount ?? Math.max(0, curatorCount - baseCuratorCount), contextChars,
  promptChars = contextChars ?? 0, schemaChars = 0, attempt = 1, budgetAttempt = attempt, modelContextWindow,
  isRepair = false, previousIncompleteTokens = 0,
} = {}) {
  const level = normEffort(effort), minsMax = minutesMax ?? minutesCount ?? 12, limits = getModelLimits(model);
  if (modelContextWindow != null) limits.contextWindow = Number(modelContextWindow) || 0;
  const visible = estimateVisibleTokens({ minutesMax: minsMax, decisionsCount, verbosity });
  const effortBase = getEffortBase(isRepair ? (level === "minimal" ? "minimal" : "low") : level);
  const contextComplexityReserve = Math.ceil(Math.max(0, estimatedInputTokens) * numEnv("PHOTO_SELECT_CONTEXT_COMPLEXITY_RATIO", 0.10));
  const promptComplexityReserve = Math.ceil(Math.max(0, promptChars + schemaChars) / 1000) * numEnv("PHOTO_SELECT_PROMPT_COMPLEXITY_TOKENS_PER_KB", 4);
  const curatorReserve = Math.max(0, curatorCount) * numEnv("PHOTO_SELECT_CURATOR_REASONING_TOKENS", 350) + Math.max(0, dynamicCuratorCount) * numEnv("PHOTO_SELECT_DYNAMIC_CURATOR_REASONING_TOKENS", 500);
  const imageReserve = Math.max(0, imageCount) * numEnv("PHOTO_SELECT_IMAGE_REASONING_TOKENS", 1000);
  const margin = numEnv("PHOTO_SELECT_OUTPUT_SAFETY_MARGIN", Math.max(4000, Math.ceil(visible * 0.5)));
  const complexityReserve = contextComplexityReserve + promptComplexityReserve + curatorReserve + imageReserve;
  const multiplier = retryMultiplier(budgetAttempt);
  let wanted = Math.max(Math.ceil((visible + effortBase + complexityReserve + margin) * multiplier), previousIncompleteTokens > 0 ? Math.ceil(previousIncompleteTokens * multiplier) : 0);
  if (isRepair) wanted = Math.max(wanted, numEnv("PHOTO_SELECT_REPAIR_MIN_OUTPUT_TOKENS", 12_288));
  if (level === "xhigh" && budgetAttempt >= 2) wanted = Math.max(wanted, numEnv("PHOTO_SELECT_OUTPUT_RETRY_MIN_XHIGH", 96_000));
  const budgetMultiplier = Math.max(0, numEnv("PHOTO_SELECT_OUTPUT_BUDGET_MULTIPLIER", 1));
  wanted = Math.ceil(wanted * budgetMultiplier);
  const contextSafety = numEnv("PHOTO_SELECT_CONTEXT_SAFETY_MARGIN", numEnv("PHOTO_SELECT_CONTEXT_SAFETY_TOKENS", 8000));
  const contextWindow = numEnv("PHOTO_SELECT_CONTEXT_WINDOW_TOKENS", limits.contextWindow);
  const contextRemaining = contextWindow ? Math.max(0, contextWindow - Math.max(0, estimatedInputTokens) - contextSafety) : limits.maxOutputTokens;
  const hardCap = Math.max(0, Math.min(limits.maxOutputTokens, numEnv("PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", limits.maxOutputTokens), contextRemaining || limits.maxOutputTokens));
  const minUseful = minimumForEffort(isRepair ? "minimal" : level), constrained = hardCap > 0 && hardCap < minUseful;
  const maxOutputTokens = hardCap > 0 ? clamp(roundUp(wanted), Math.min(minUseful, hardCap || minUseful), hardCap) : 0;
  const warnings = [];
  if (constrained) warnings.push(`output budget constrained: requested min ${minUseful}, hard cap ${hardCap} because estimated input tokens are near context limit.`);
  if (contextWindow && maxOutputTokens < roundUp(wanted)) warnings.push(`output budget clamped: wanted=${roundUp(wanted)} available=${contextRemaining} estimated_input=${estimatedInputTokens} context_window=${contextWindow}`);
  const details = { effort: level, verbosity: normVerbosity(verbosity), minutesMin, minutesMax: minsMax, decisionsCount, imageCount, curatorCount, baseCuratorCount, dynamicCuratorCount, estimatedInputTokens, promptChars, schemaChars, attempt: budgetAttempt, budgetMultiplier, wanted: roundUp(wanted), minUseful, constrained };
  return { maxOutputTokens, visibleEstimate: visible, visible, reasoningReserve: effortBase, effortBase, complexityReserve, contextComplexityReserve, promptComplexityReserve, curatorReserve, imageReserve, margin, retryMultiplier: multiplier, cap: hardCap, hardCap, contextRemaining, contextWindowLimit: contextWindow ? contextRemaining : null, limits, warnings, details };
}

export function computeMaxOutputTokens(options = {}) { return computeOutputBudget(options).maxOutputTokens; }

export function clampToContextWindow({ desiredMaxOutputTokens, estimatedInputTokens }) {
  const contextWindow = numEnv("PHOTO_SELECT_CONTEXT_WINDOW_TOKENS", 0), safety = numEnv("PHOTO_SELECT_CONTEXT_SAFETY_TOKENS", 8192);
  if (!contextWindow) return desiredMaxOutputTokens;
  return Math.max(0, Math.min(desiredMaxOutputTokens, Math.max(0, contextWindow - estimatedInputTokens - safety)));
}

export function budgetToTelemetry(budget, extra = {}) {
  return { max_output_tokens: budget.maxOutputTokens, estimated_input_tokens: budget.details?.estimatedInputTokens, visible: budget.visibleEstimate, visible_estimate: budget.visibleEstimate, effort_base: budget.effortBase, reasoning_reserve: budget.reasoningReserve, complexity_reserve: budget.complexityReserve, context_complexity_reserve: budget.contextComplexityReserve, prompt_complexity_reserve: budget.promptComplexityReserve, curator_reserve: budget.curatorReserve, image_reserve: budget.imageReserve, margin: budget.margin, hard_cap: budget.hardCap, cap: budget.cap, context_remaining: budget.contextRemaining, context_window_limit: budget.contextWindowLimit, retry_multiplier: budget.retryMultiplier, warnings: budget.warnings, ...budget.details, ...extra };
}

export function estimateInputTokens({ instructions = "", schemaJson = "", imageCount = 0, imageDetail = "low", extraText = "" }) {
  const textTokens = Math.ceil(((instructions.length || 0) + (schemaJson.length || 0) + (extraText.length || 0)) / 4);
  return textTokens + imageCount * (imageDetail === "high" ? numEnv("PHOTO_SELECT_TOKENS_PER_IMAGE_HIGH", 900) : numEnv("PHOTO_SELECT_TOKENS_PER_IMAGE_LOW", 150));
}
