// src/core/finalizeCurators.js
import { buildPrompt } from '../templates.js';
<<<<<<< HEAD
=======
import { isPlaceholder } from '../lib/people.js';

const IDENTITY_POLICY =
  process.env.PHOTO_SELECT_IDENTITY_POLICY || 'passthrough';
>>>>>>> ad4ae9dcb2582761e7001766714a5831c005b5fc

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

<<<<<<< HEAD
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
=======
/**
 * Pass-through identity policy (default):
 * - Do not rewrite names (keep punctuation/parentheses).
 * - Append anyone who appears in ≥ minRepeats photos, ordered by last appearance (back→front).
 * - Allow duplicates relative to CLI-provided names.
 *
 * Optional canonicalization can be enabled with
 * PHOTO_SELECT_IDENTITY_POLICY=canonicalize.
 */
export function finalizeCurators(
  cliCurators = [],
  photos = [],
  { minRepeats = 2, aliasMap = {} } = {}
) {
  if (IDENTITY_POLICY === 'canonicalize') {
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
      .filter(([, c]) => c >= minRepeats)
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

  // passthrough
  const final = [...cliCurators];
  const cliSet = new Set(cliCurators.map(String));
  const counts = new Map(); // name -> {count, lastIdx}
  photos.forEach((p, idx) => {
    for (const raw of p?.people || []) {
      if (!raw || isPlaceholder(raw)) continue;
      const name = String(raw);
      const info = counts.get(name) || { count: 0, lastIdx: -1 };
      info.count += 1;
      info.lastIdx = idx;
      counts.set(name, info);
    }
  });

  const extras = [...counts.entries()]
    .filter(([name, info]) => info.count >= minRepeats && !cliSet.has(name))
    .sort((a, b) => b[1].lastIdx - a[1].lastIdx)
    .map(([name]) => name);

  return { finalCurators: final.concat(extras), added: extras };
>>>>>>> ad4ae9dcb2582761e7001766714a5831c005b5fc
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
<<<<<<< HEAD
=======

>>>>>>> ad4ae9dcb2582761e7001766714a5831c005b5fc
