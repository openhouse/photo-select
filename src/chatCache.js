import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const CACHE_DIR = path.resolve('.cache');

export async function readCache(key) {
  const p = path.join(CACHE_DIR, `${key}.txt`);
  try {
    const raw = await readFile(p, 'utf8');
    const { keep, aside } = decisionCounts(raw);
    if (keep + aside === 0) {
      try { await rm(p); } catch {}
      return null;
    }
    return raw;
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
  await writeFile(path.join(CACHE_DIR, `${key}.txt`), value, 'utf8');
}

export function decisionCounts(entry) {
  if (!entry) return { keep: 0, aside: 0 };
  try {
    let text = String(entry).trim();
    const m = text.match(/^```\w*\n([\s\S]*?)\n```$/);
    if (m) text = m[1];
    const obj = JSON.parse(text);
    if (Array.isArray(obj.decisions)) {
      let keep = 0, aside = 0;
      for (const d of obj.decisions) {
        if (d?.decision === 'keep') keep++;
        else if (d?.decision === 'aside') aside++;
      }
      return { keep, aside };
    }
    if (obj.decision && typeof obj.decision === 'object') {
      const dec = obj.decision;
      const k = dec.keep;
      const a = dec.aside;
      const keep = Array.isArray(k) ? k.length : k && typeof k === 'object' ? Object.keys(k).length : 0;
      const aside = Array.isArray(a) ? a.length : a && typeof a === 'object' ? Object.keys(a).length : 0;
      return { keep, aside };
    }
  } catch {}
  return { keep: 0, aside: 0 };
}
