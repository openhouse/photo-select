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

// Prompt templates are compiled via renderTemplate in templates.js

/** Sleep helper for rate‑limit back‑off. */
export const delay = (ms) => new Promise((res) => setTimeout(res, ms));
