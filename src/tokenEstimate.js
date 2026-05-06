// src/tokenEstimate.js

const def = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const roundUp = (n, step = 1024) => Math.ceil(n / step) * step;

const normalizeEffort = (effort) => String(effort || "low").toLowerCase();

function modelLimits(model = "") {
  const id = String(model || "").toLowerCase();
  if (id.startsWith("gpt-5.4")) {
    return {
      contextWindow: def("PHOTO_SELECT_CONTEXT_WINDOW_GPT54", 1_000_000),
      maxOutputTokens: def("PHOTO_SELECT_MAX_OUTPUT_GPT54", 128_000),
      matched: "gpt-5.4",
    };
  }
  if (id.startsWith("gpt-5")) {
    return {
      contextWindow: def("PHOTO_SELECT_CONTEXT_WINDOW_GPT5", 400_000),
      maxOutputTokens: def("PHOTO_SELECT_MAX_OUTPUT_GPT5", 128_000),
      matched: "gpt-5",
    };
  }
  return {
    contextWindow: def("PHOTO_SELECT_CONTEXT_WINDOW_DEFAULT", 400_000),
    maxOutputTokens: def("PHOTO_SELECT_MAX_OUTPUT_DEFAULT", 128_000),
    matched: "default",
  };
}

function effortBase(effort) {
  const bases = {
    none: def("PHOTO_SELECT_REASONING_BASE_NONE", 0),
    minimal: def("PHOTO_SELECT_REASONING_BASE_MINIMAL", 2_000),
    low: def("PHOTO_SELECT_REASONING_BASE_LOW", 6_000),
    medium: def("PHOTO_SELECT_REASONING_BASE_MEDIUM", 16_000),
    high: def("PHOTO_SELECT_REASONING_BASE_HIGH", 32_000),
    xhigh: def("PHOTO_SELECT_REASONING_BASE_XHIGH", 64_000),
    auto: def("PHOTO_SELECT_REASONING_BASE_AUTO", 16_000),
  };
  return bases[effort] ?? bases.low;
}

function minUsefulForEffort(effort) {
  const mins = {
    none: def("PHOTO_SELECT_MIN_OUTPUT_DEFAULT", 8192),
    minimal: def("PHOTO_SELECT_MIN_OUTPUT_DEFAULT", 8192),
    low: def("PHOTO_SELECT_MIN_OUTPUT_DEFAULT", 8192),
    medium: def("PHOTO_SELECT_MIN_OUTPUT_MEDIUM", 16_000),
    high: def("PHOTO_SELECT_MIN_OUTPUT_HIGH", 32_000),
    xhigh: def("PHOTO_SELECT_MIN_OUTPUT_XHIGH", 64_000),
    auto: def("PHOTO_SELECT_MIN_OUTPUT_MEDIUM", 16_000),
  };
  return mins[effort] ?? mins.low;
}

export function estimateVisibleTokens({
  minutesCount,
  decisionsCount,
  maxWordsPerLine,
  minutesMax = minutesCount ?? 0,
  verbosity,
} = {}) {
  if (maxWordsPerLine != null) {
    const words = (minutesCount || 0) * maxWordsPerLine + (decisionsCount || 0) * 16;
    return Math.ceil(words * 1.3) + 300;
  }
  const verbosityMultiplier = verbosity === "high" ? 1.25 : verbosity === "low" ? 0.85 : 1;
  const perMinute = Math.ceil(def("PHOTO_SELECT_OUTPUT_TOKENS_PER_MINUTE", 120) * verbosityMultiplier);
  const perDecision = Math.ceil(def("PHOTO_SELECT_OUTPUT_TOKENS_PER_DECISION", 80) * verbosityMultiplier);
  const overhead = def("PHOTO_SELECT_OUTPUT_JSON_OVERHEAD", 800);
  return overhead + (minutesMax || 0) * perMinute + (decisionsCount || 0) * perDecision;
}

export function computeOutputBudget({
  model = "",
  effort = "low",
  reasoningEffort,
  estimatedInputTokens = 0,
  minutesMin = 3,
  minutesMax = 12,
  decisionsCount = 10,
  imageCount = decisionsCount,
  curatorCount = 0,
  finalCuratorCount,
  baseCuratorCount = curatorCount,
  dynamicCuratorCount,
  addedCuratorCount,
  promptChars = 0,
  contextChars = promptChars,
  schemaChars = 0,
  verbosity = "medium",
  attempt = 1,
  modelContextWindow,
} = {}) {
  const normalizedEffort = normalizeEffort(reasoningEffort || effort);
  const finalCount = Number(finalCuratorCount ?? curatorCount ?? 0);
  const baseCount = Number(baseCuratorCount ?? finalCount);
  const dynamicCount = Math.max(0, Number(dynamicCuratorCount ?? addedCuratorCount ?? (finalCount - baseCount)));
  const inputTokens = Math.max(0, Number(estimatedInputTokens) || 0);
  const limits = modelLimits(model);
  const contextWindow = Number(modelContextWindow || process.env.PHOTO_SELECT_MODEL_CONTEXT_WINDOW || limits.contextWindow || 0);
  const contextSafetyMargin = def("PHOTO_SELECT_CONTEXT_SAFETY_MARGIN", 8000);

  const visible = estimateVisibleTokens({ minutesMax, decisionsCount, verbosity });
  const effortBaseReserve = effortBase(normalizedEffort);
  const contextComplexityReserve = Math.ceil(inputTokens * def("PHOTO_SELECT_CONTEXT_COMPLEXITY_RATIO", 0.10));
  const curatorReserve = Math.ceil(finalCount * def("PHOTO_SELECT_CURATOR_REASONING_TOKENS", 350));
  const dynamicCuratorReserve = Math.ceil(dynamicCount * def("PHOTO_SELECT_DYNAMIC_CURATOR_REASONING_TOKENS", 500));
  const imageReserve = Math.ceil(Math.max(0, Number(imageCount) || 0) * def("PHOTO_SELECT_IMAGE_REASONING_TOKENS", 1000));
  const promptCharReserve = Math.ceil(Math.max(0, Number(contextChars || promptChars || 0) + Number(schemaChars || 0)) / 200);
  const margin = def("PHOTO_SELECT_OUTPUT_SAFETY_MARGIN", 2000);
  const retryMultiplier = attempt <= 1 ? 1 : attempt === 2 ? 1.6 : 2.25;

  const preRetry = visible + effortBaseReserve + contextComplexityReserve + curatorReserve + dynamicCuratorReserve + imageReserve + promptCharReserve + margin;
  const computed = roundUp(preRetry * retryMultiplier);
  const minUseful = minUsefulForEffort(normalizedEffort);
  const recommendedBeforeClamp = Math.max(computed, minUseful);
  const envHardCap = process.env.PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP;
  const hardCap = def("PHOTO_SELECT_MAX_OUTPUT_TOKENS_CAP", envHardCap == null || envHardCap === "" ? limits.maxOutputTokens : Number(envHardCap));
  const contextRemaining = contextWindow ? Math.max(0, contextWindow - inputTokens - contextSafetyMargin) : null;
  const effectiveHardCap = contextRemaining == null ? hardCap : Math.min(hardCap, contextRemaining);
  const maxOutputTokens = Math.max(0, Math.min(recommendedBeforeClamp, effectiveHardCap));

  const warnings = [];
  if (hardCap < recommendedBeforeClamp) {
    warnings.push(`output budget capped: recommended=${recommendedBeforeClamp} hard_cap=${hardCap}`);
  }
  if (contextRemaining != null && contextRemaining < recommendedBeforeClamp) {
    warnings.push(`output budget context-constrained: recommended=${recommendedBeforeClamp} available=${contextRemaining} context_window=${contextWindow} estimated_input=${inputTokens}`);
  }
  if (maxOutputTokens < minUseful) {
    warnings.push(`output budget below minimum useful for ${normalizedEffort}: min=${minUseful} actual=${maxOutputTokens}`);
  }

  return {
    maxOutputTokens,
    visible,
    visibleEstimate: visible,
    effortBase: effortBaseReserve,
    reasoningReserve: effortBaseReserve,
    contextComplexityReserve,
    curatorReserve,
    dynamicCuratorReserve,
    imageReserve,
    complexityReserve: contextComplexityReserve + curatorReserve + dynamicCuratorReserve + imageReserve + promptCharReserve,
    margin,
    computed,
    recommendedBeforeClamp,
    retryMultiplier,
    hardCap,
    cap: hardCap,
    contextRemaining,
    contextWindowLimit: contextRemaining,
    minUseful,
    constrained: maxOutputTokens !== recommendedBeforeClamp,
    warnings,
    limits: { ...limits, contextWindow },
    details: {
      promptCharReserve,
      preRetry,
      contextSafetyMargin,
      effectiveHardCap,
    },
    inputs: {
      model,
      effort: normalizedEffort,
      estimatedInputTokens: inputTokens,
      minutesMin,
      minutesMax,
      decisionsCount,
      imageCount,
      curatorCount: finalCount,
      baseCuratorCount: baseCount,
      dynamicCuratorCount: dynamicCount,
      promptChars,
      contextChars,
      schemaChars,
      verbosity,
      attempt,
    },
  };
}

/** Backward-compatible numeric cap for Responses 'max_output_tokens'. */
export function computeMaxOutputTokens({
  minutesCount,
  decisionsCount,
  effort = "low",
  estimatedInputTokens = 0,
  curatorCount = 0,
  imageCount = decisionsCount,
  isRepair = false,
  previousIncompleteTokens = 0,
  ...rest
} = {}) {
  const budget = computeOutputBudget({
    ...rest,
    effort,
    estimatedInputTokens,
    minutesMin: rest.minutesMin ?? (isRepair ? 0 : undefined),
    minutesMax: rest.minutesMax ?? minutesCount,
    decisionsCount,
    imageCount,
    curatorCount,
    attempt: rest.attempt ?? 1,
  });
  const retryFloor = previousIncompleteTokens > 0 ? roundUp(previousIncompleteTokens * 1.75) : 0;
  const repairFloor = isRepair ? (normalizeEffort(effort) === "xhigh" ? 32768 : 12288) : 0;
  return Math.min(budget.hardCap, Math.max(budget.maxOutputTokens, retryFloor, repairFloor));
}

export function clampToContextWindow({ desiredMaxOutputTokens, estimatedInputTokens }) {
  const contextWindow = def("PHOTO_SELECT_CONTEXT_WINDOW_TOKENS", 0);
  const safety = def("PHOTO_SELECT_CONTEXT_SAFETY_TOKENS", 8192);
  if (!contextWindow) {
    return { maxOutputTokens: desiredMaxOutputTokens, clamped: false, available: null };
  }
  const available = Math.max(0, contextWindow - estimatedInputTokens - safety);
  const maxOutputTokens = Math.max(0, Math.min(desiredMaxOutputTokens, available));
  return { maxOutputTokens, clamped: maxOutputTokens !== desiredMaxOutputTokens, available };
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
  const imageLow = def("PHOTO_SELECT_TOKENS_PER_IMAGE_LOW", 150);
  const imageHigh = def("PHOTO_SELECT_TOKENS_PER_IMAGE_HIGH", 900);

  const textChars =
    (instructions.length || 0) +
    (schemaJson.length || 0) +
    (extraText.length || 0);
  const textTokens = Math.ceil(textChars * TOKENS_PER_CHAR);
  const perImage = imageDetail === "high" ? imageHigh : imageLow;
  const imageTokens = imageCount * perImage;

  return textTokens + imageTokens;
}
