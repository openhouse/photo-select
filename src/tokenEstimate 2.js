// src/tokenEstimate.js

const def = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function estimateVisibleTokens({
  minutesCount,
  decisionsCount,
  maxWordsPerLine = 18,
}) {
  const words = minutesCount * maxWordsPerLine + decisionsCount * 16;
  const textTokens = Math.ceil(words * 1.3);
  const jsonOverhead = 300;
  return textTokens + jsonOverhead;
}

/** Adaptive cap for Responses 'max_output_tokens'. */
export function computeMaxOutputTokens({
  minutesCount,
  decisionsCount,
  effort = "low",
}) {
  const visible = estimateVisibleTokens({ minutesCount, decisionsCount });
  const base = Math.ceil(visible * 3);
  const cushion = effort === "high" ? 2000 : 1000;
  return Math.max(8192, base + cushion);
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
