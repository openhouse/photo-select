import { OpenAI, NotFoundError } from "openai";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
<<<<<<< HEAD
=======
import { Reply as ReplySchema } from "./replySchema.js";
>>>>>>> 0890d84fef0310c2fe9bb5c155815202b945b78d
import { delay } from "./config.js";

const openai = new OpenAI();
const PEOPLE_API_BASE = process.env.PHOTO_FILTER_API_BASE ||
  "http://localhost:3000";
const peopleCache = new Map();

async function getPeople(filename) {
  if (peopleCache.has(filename)) return peopleCache.get(filename);
  try {
    const url = `${PEOPLE_API_BASE}/api/photos/by-filename/${encodeURIComponent(filename)}/persons`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const names = Array.isArray(json.data) ? json.data : [];
    peopleCache.set(filename, names);
    return names;
  } catch {
    peopleCache.set(filename, []);
    return [];
  }
}

/** Max response tokens allowed from OpenAI. Large enough to hold
 * minutes plus the full JSON decision block without truncation. */
export const MAX_RESPONSE_TOKENS = 4096;

function ensureJsonMention(text) {
  return /\bjson\b/i.test(text)
    ? text
    : `${text}\nRespond in json format.`;
}

const CACHE_DIR = path.resolve('.cache');

async function getCachedReply(key) {
  try {
    return await readFile(path.join(CACHE_DIR, `${key}.txt`), 'utf8');
  } catch {
    return null;
  }
}

async function setCachedReply(key, text) {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${key}.txt`), text, 'utf8');
}

export async function cacheKey({ prompt, images, model, curators = [] }) {
  const hash = crypto.createHash('sha256');
  hash.update(model);
  hash.update(prompt);
  if (curators.length) hash.update(curators.join(','));
  for (const file of images) {
    const info = await stat(file);
    hash.update(file);
    hash.update(String(info.mtimeMs));
    hash.update(String(info.size));
  }
  return hash.digest('hex');
}

/**
 * Builds the array of message objects for the Chat Completion API.
 * Encodes each image as a base64 data‑URL so it can be inspected by vision models.
 */
export async function buildMessages(prompt, images, curators = []) {
  const system = { role: "system", content: prompt };

  /**  Turn each image into base64 data‑URL with a preceding filename label.  */
  const userImageParts = await Promise.all(
    images.map(async (file) => {
      const abs = path.resolve(file);
      const buffer = await readFile(abs);
      const base64 = buffer.toString("base64");
      const name = path.basename(file);
      const ext = path.extname(file).slice(1) || "jpeg";
      const people = await getPeople(name);
      const info = people.length ? { filename: name, people } : { filename: name };
      return [
        { type: "text", text: JSON.stringify(info) },
        {
          type: "image_url",
          image_url: {
            url: `data:image/${ext};base64,${base64}`,
            detail: "high",
          },
        },
      ];
    })
  ).then((parts) => parts.flat());

  const userText = {
    role: "user",
    content: [
      { type: "text", text: ensureJsonMention("Here are the images:") },
      ...userImageParts,
    ],
  };

  return [system, userText];
}

/** Build input array for the Responses API */
export async function buildInput(prompt, images, curators = []) {
  let instructions = prompt;
  const imageParts = await Promise.all(
    images.map(async (file) => {
      const abs = path.resolve(file);
      const buffer = await readFile(abs);
      const base64 = buffer.toString("base64");
      const name = path.basename(file);
      const ext = path.extname(file).slice(1) || "jpeg";
      const people = await getPeople(name);
      const info = people.length ? { filename: name, people } : { filename: name };
      return [
        { type: "input_text", text: JSON.stringify(info) },
        {
          type: "input_image",
          image_url: `data:image/${ext};base64,${base64}`,
          detail: "high",
        },
      ];
    })
  ).then((parts) => parts.flat());

  return {
    instructions,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: ensureJsonMention("Here are the images:") },
          ...imageParts,
        ],
      },
    ],
  };
}

/**
 * Call OpenAI, returning raw text content.
 * Retries with exponential back‑off on 429/5xx.
 */
export async function chatCompletion({
  prompt,
  images,
  model = "gpt-4o",
  maxRetries = 3,
  cache = true,
  curators = [],
}) {
  const finalPrompt = ensureJsonMention(prompt);

  const key = await cacheKey({ prompt: finalPrompt, images, model, curators });
  if (cache) {
    const hit = await getCachedReply(key);
    if (hit) return hit;
  }

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const messages = await buildMessages(finalPrompt, images, curators);
      const baseParams = {
        model,
        messages,
        // allow ample space for the JSON decision block and minutes
        response_format: { type: "json_object" },
      };
      if (/^o\d/.test(model)) {
        baseParams.max_completion_tokens = MAX_RESPONSE_TOKENS;
      } else {
        baseParams.max_tokens = MAX_RESPONSE_TOKENS;
      }
      const { choices } = await openai.chat.completions.create(baseParams);
      const text = choices[0].message.content;
      if (cache) await setCachedReply(key, text);
      return text;
    } catch (err) {
      const msg = String(err?.error?.message || err?.message || "");
      const code = err?.code || err?.cause?.code;
      const isNetwork = err?.name === "APIConnectionError" ||
        ["EPIPE", "ECONNRESET", "ETIMEDOUT"].includes(code);
      if (
        (err instanceof NotFoundError || err.status === 404) &&
        (/v1\/responses/.test(msg) || /v1\/completions/.test(msg) || /not a chat model/i.test(msg))
      ) {
        const params = await buildInput(finalPrompt, images, curators);
        const rsp = await openai.responses.create({
          model,
          ...params,
          text: { format: { type: "json_object" } },
          max_output_tokens: MAX_RESPONSE_TOKENS,
        });
        const text = rsp.output_text;
        if (cache) await setCachedReply(key, text);
        return text;
      }

      if (attempt >= maxRetries) throw err;
      attempt += 1;
      const wait = 2 ** attempt * 1000;
      const label = isNetwork ? "network error" : "OpenAI error";
      const codeInfo = err.status ?? code ?? "unknown";
      console.warn(`${label} (${codeInfo}). Retrying in ${wait} ms…`);
      await delay(wait);
    }
  }
}

/**
 * Parse the LLM reply → { keep: [file], aside: [file] }
 *
 * Accepts patterns like:
 *  • “DSCF1234 — keep  …reason…”
 *  • “Set aside: DSCF5678”
 */
export function parseReply(text, allFiles, opts = {}) {
  const { expectFieldNotesDiff = false, expectFieldNotesMd = false } = opts;
<<<<<<< HEAD
  // Strip Markdown code fences like ```json ... ``` if present
  const fenced = text.trim();
  if (fenced.startsWith('```')) {
    const match = fenced.match(/^```\w*\n([\s\S]*?)\n```$/);
    if (match) text = match[1];
=======
  let content = text.trim();
  if (content.startsWith('```')) {
    const m = content.match(/^```\w*\n([\s\S]*?)\n```$/);
    if (m) content = m[1];
>>>>>>> 0890d84fef0310c2fe9bb5c155815202b945b78d
  }
  const data = ReplySchema.parse(JSON.parse(content));

  if (data.minutes.length) {
    const last = data.minutes[data.minutes.length - 1].text.trim();
    if (!last.endsWith('?')) {
      throw new Error('minutes must end with a question');
    }
  }

  const map = new Map(allFiles.map((f) => [path.basename(f).toLowerCase(), f]));
  const resolve = (name) => {
    const lc = name.toLowerCase();
    let f = map.get(lc);
    if (!f) {
      const idx = lc.indexOf('dscf');
      if (idx !== -1) {
        f = map.get(lc.slice(idx));
        if (!f) {
          for (const [key, val] of map) {
            if (key.endsWith(lc.slice(idx))) { f = val; break; }
          }
        }
      }
    }
    return f;
  };

  const toList = (val) => {
    const result = [];
    if (Array.isArray(val)) {
      for (const n of val) {
        const f = resolve(n);
        if (f) result.push([f, undefined]);
      }
    } else {
      for (const [n, reason] of Object.entries(val || {})) {
        const f = resolve(n);
        if (f) result.push([f, reason]);
      }
    }
    return result;
  };

  const keep = toList(data.decision.keep);
  const aside = toList(data.decision.aside);

  const notes = new Map();
<<<<<<< HEAD
  const minutes = [];
  let fieldNotesDiff = null;
  let fieldNotesMd = null;

  // Try JSON first
  try {
    const obj = JSON.parse(text);

    const extract = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (typeof node.field_notes_diff === 'string') fieldNotesDiff = node.field_notes_diff;
      if (typeof node.field_notes_md === 'string') fieldNotesMd = node.field_notes_md;
      if (Array.isArray(node.minutes)) minutes.push(...node.minutes.map((m) => `${m.speaker}: ${m.text}`));

      if (node.keep && node.aside) return node;
      if (node.decision && node.decision.keep && node.decision.aside) {
        if (Array.isArray(node.minutes)) minutes.push(...node.minutes.map((m) => `${m.speaker}: ${m.text}`));
        return node.decision;
      }
      for (const val of Object.values(node)) {
        const found = extract(val);
        if (found) return found;
      }
      return null;
    };

    const decision = extract(obj);
    if (decision) {
      const handle = (group, set) => {
        const val = decision[group];
        if (Array.isArray(val)) {
          for (const n of val) {
            const f = lookup(n);
            if (f) set.add(f);
          }
        } else if (val && typeof val === 'object') {
          for (const [n, reason] of Object.entries(val)) {
            const f = lookup(n);
            if (f) {
              set.add(f);
              if (reason) notes.set(f, String(reason));
            }
          }
        }
      };

      handle('keep', keep);
      handle('aside', aside);
      // continue to normalization below
    }
  } catch {
    // fall through to plain text handling
=======
  for (const [f, reason] of [...keep, ...aside]) {
    if (reason) notes.set(f, String(reason));
>>>>>>> 0890d84fef0310c2fe9bb5c155815202b945b78d
  }

  const keepFiles = new Set(keep.map(([f]) => f));
  const asideFiles = new Set(aside.map(([f]) => f));
  for (const f of keepFiles) asideFiles.delete(f);

  const decided = new Set([...keepFiles, ...asideFiles]);
  const unclassified = allFiles.filter((f) => !decided.has(f));

<<<<<<< HEAD
  // field_notes_diff/md are required for the two-pass notebook workflow.
  // Missing keys would leave the notebook in an inconsistent state.
  if (expectFieldNotesDiff && !fieldNotesDiff && !fieldNotesMd) {
    throw new Error('field_notes_diff missing in reply');
  }
  if (expectFieldNotesMd && !fieldNotesMd) {
=======
  if (expectFieldNotesDiff && !data.field_notes_diff && !data.field_notes_md) {
    throw new Error('field_notes_diff missing in reply');
  }
  if (expectFieldNotesMd && !data.field_notes_md) {
>>>>>>> 0890d84fef0310c2fe9bb5c155815202b945b78d
    throw new Error('field_notes_md missing in reply');
  }

  return {
<<<<<<< HEAD
    keep: [...keep],
    aside: [...aside],
    unclassified,
    notes,
    minutes,
    fieldNotesDiff,
    fieldNotesMd,
=======
    keep: [...keepFiles],
    aside: [...asideFiles],
    unclassified,
    notes,
    minutes: data.minutes.map((m) => `${m.speaker}: ${m.text}`),
    fieldNotesDiff: data.field_notes_diff || null,
    fieldNotesMd: data.field_notes_md || null,
>>>>>>> 0890d84fef0310c2fe9bb5c155815202b945b78d
  };
}
