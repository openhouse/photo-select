// src/lib/people.js
export function isPlaceholder(name) {
  if (name == null) return true;
  const s = String(name).trim();
  // Accept tokens that are *only* a placeholder, optionally with #index or underscores
  // Matches: "unknown", "_UNKNOWN_", "Unknown #3", "unknown3", "unknown 3"
  return /^_?unknown(?:\s*#?\d+)?_?$/i.test(s);
}

export function sanitizePeople(input) {
  return (Array.isArray(input) ? input : [])
    .map((raw) => (raw == null ? '' : String(raw).trim()))
    .filter((s) => s.length > 0 && !isPlaceholder(s));
}
