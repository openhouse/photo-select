// src/core/finalizeCurators.js
import { buildPrompt } from '../templates.js';

const HYPHENS = /[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g;

function cleanName(name) {
  const normalized = name
    .normalize('NFKC')
    .replace(HYPHENS, '-')
    .replace(/\s*\-\s*/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  let out = '';
  for (const ch of normalized) {
    const code = ch.codePointAt(0);
    if (
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code > 0x7f ||
      ch === '-' ||
      ch === "'" ||
      ch === ' '
    ) {
      out += ch;
    }
  }
  return out.trim();
}

export function finalizeCurators(cliCurators = [], photos = [], { aliasMap = {} } = {}) {
  const alias = new Map();
  for (const [k, v] of Object.entries(aliasMap)) {
    alias.set(cleanName(k).toLowerCase(), cleanName(v));
  }
  const canonical = (raw) => {
    if (!raw) return '';
    let c = cleanName(raw);
    const key = c.toLowerCase();
    if (alias.has(key)) c = alias.get(key);
    return c;
  };

  const cliSet = new Set();
  const finalCurators = [];
  for (const raw of cliCurators) {
    const c = canonical(raw);
    if (!c) continue;
    const key = c.toLowerCase();
    if (cliSet.has(key)) continue;
    cliSet.add(key);
    finalCurators.push(c);
  }

  const counts = new Map();
  const lastIdx = new Map();
  photos.forEach((p, idx) => {
    for (const person of p.people || []) {
      const c = canonical(person);
      if (!c) continue;
      counts.set(c, (counts.get(c) || 0) + 1);
      lastIdx.set(c, idx);
    }
  });
  const repeats = [...counts.entries()]
    .filter(([, c]) => c >= 2)
    .map(([n]) => n);
  repeats.sort((a, b) => {
    const la = lastIdx.get(a) ?? -1;
    const lb = lastIdx.get(b) ?? -1;
    if (la !== lb) return lb - la;
    return a.localeCompare(b);
  });
  const added = [];
  for (const n of repeats) {
    const key = n.toLowerCase();
    if (cliSet.has(key)) continue;
    cliSet.add(key);
    finalCurators.push(n);
    added.push(n);
  }
  return { finalCurators, added };
}

export async function buildFinalPrompt({
  cliCurators = [],
  photos = [],
  images = [],
  aliasMap = {},
  ...rest
} = {}) {
  const { finalCurators } = finalizeCurators(cliCurators, photos, { aliasMap });
  const { prompt, minutesMin, minutesMax } = await buildPrompt(undefined, {
    ...rest,
    curators: finalCurators,
    images,
  });
  return { prompt, minutesMin, minutesMax, finalCurators };
}
