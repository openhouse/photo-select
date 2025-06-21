import path from "node:path";
import fs from "node:fs/promises";

/** Centralised config & helpers (Ember‑style “config owner”). */
export const SUPPORTED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".tif",
  ".tiff",
  ".heic",
  ".heif",
];

export const DEFAULT_PROMPT_PATH = path.resolve(
  new URL("../prompts/default_prompt.txt", import.meta.url).pathname
);

export async function readPrompt(filePath = DEFAULT_PROMPT_PATH) {
  return fs.readFile(filePath, "utf8");
}

/** Sleep helper for rate‑limit back‑off. */
export const delay = (ms) => new Promise((res) => setTimeout(res, ms));
