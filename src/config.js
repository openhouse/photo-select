import path from "node:path";
import fs from "node:fs/promises";
import Handlebars from "handlebars";

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
  new URL("../prompts/default_prompt.hbs", import.meta.url).pathname
);
export async function renderTemplate(filePath = DEFAULT_PROMPT_PATH, data = {}) {
  const source = await fs.readFile(filePath, "utf8");
  const template = Handlebars.compile(source, { noEscape: true });
  return template(data);
}

/** Sleep helper for rate‑limit back‑off. */
export const delay = (ms) => new Promise((res) => setTimeout(res, ms));
