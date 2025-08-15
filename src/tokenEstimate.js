// src/tokenEstimate.js

const def = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** Adaptive cap for Responses 'max_output_tokens'. */
export function computeMaxOutputTokens({
  fileCount,
  minutesMax,
  minOut = def("PHOTO_SELECT_MIN_OUTPUT_TOKENS", 768),
  maxOut = def("PHOTO_SELECT_MAX_OUTPUT_TOKENS", 2048),
  base = def("PHOTO_SELECT_TOKENS_BASE", 160),
  perDecision = def("PHOTO_SELECT_TOKENS_PER_DECISION", 32),
  perMinute = def("PHOTO_SELECT_TOKENS_PER_MINUTE", 90),
}) {
  const raw = base + perDecision * fileCount + perMinute * minutesMax;
  return Math.max(minOut, Math.min(maxOut, Math.ceil(raw)));
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
