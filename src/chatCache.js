import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";

const CACHE_DIR = process.env.PHOTO_SELECT_CHAT_CACHE_DIR || path.resolve(".cache/batches");

function cachePath(key) {
  return path.join(CACHE_DIR, `${key}.json`);
}

export async function readCache(key) {
  const p = cachePath(key);
  try {
    const raw = await readFile(p, "utf8");
    const entry = JSON.parse(raw);
    const { keep, aside } = decisionCounts(entry);
    if (keep + aside === 0) {
      try { await rm(p); } catch {}
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export async function writeCache(key, value) {
  const { keep, aside } = decisionCounts(value);
  if (keep + aside === 0) {
    console.log(`cache: skip (0 decisions) for ${key}`);
    return;
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath(key), JSON.stringify(value), "utf8");
}

export function decisionCounts(entry) {
  if (!entry) return { keep: 0, aside: 0 };
  if (Array.isArray(entry.decisions)) {
    let keep = 0, aside = 0;
    for (const d of entry.decisions) {
      if (d && d.decision === "keep") keep++;
      if (d && d.decision === "aside") aside++;
    }
    return { keep, aside };
  }
  try {
    const obj = typeof entry === "string" ? JSON.parse(entry) : entry;
    if (obj && obj.decision && typeof obj.decision === "object") {
      const k = obj.decision.keep;
      const a = obj.decision.aside;
      const keep = Array.isArray(k) ? k.length : k && typeof k === "object" ? Object.keys(k).length : 0;
      const aside = Array.isArray(a) ? a.length : a && typeof a === "object" ? Object.keys(a).length : 0;
      return { keep, aside };
    }
  } catch {
    // ignore JSON errors
  }
  return { keep: 0, aside: 0 };
}

