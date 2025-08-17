// src/lib/people.js
export function isPlaceholder(name) {
  if (name == null) return true;
  const s = String(name).trim();
  // Accept tokens that are *only* a placeholder, optionally with #index or underscores
  // Matches: "unknown", "_UNKNOWN_", "Unknown #3", "unknown3", "unknown 3"
  return /^_?unknown(?:\s*#?\d+)?_?$/i.test(s);
}

export function sanitizePeople(input) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(input) ? input : []) {
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s) continue;
    if (isPlaceholder(s)) continue;
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}
