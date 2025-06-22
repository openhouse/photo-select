import { OpenAI } from "openai";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { delay } from "./config.js";

const openai = new OpenAI();

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

export async function cacheKey({ prompt, images, model }) {
  const hash = crypto.createHash('sha256');
  hash.update(model);
  hash.update(prompt);
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
export async function buildMessages(prompt, images) {
  const system = { role: "system", content: prompt };

  /**  Turn each image into base64 data‑URL with filename caption.  */
  const userImageParts = await Promise.all(
    images.map(async (file) => {
      const abs = path.resolve(file);
      const buffer = await readFile(abs);
      const base64 = buffer.toString("base64");
      return {
        type: "image_url",
        image_url: {
          url: `data:image/${path.extname(file).slice(1)};base64,${base64}`,
          detail: "high",
        },
      };
    })
  );

  const filenames = images.map((f) => path.basename(f)).join("\n");
  const userText = {
    role: "user",
    content: [
      { type: "text", text: `Here are the images:\n${filenames}` },
      ...userImageParts,
    ],
  };

  return [system, userText];
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
}) {
  const key = await cacheKey({ prompt, images, model });
  if (cache) {
    const hit = await getCachedReply(key);
    if (hit) return hit;
  }

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const messages = await buildMessages(prompt, images);
      const { choices } = await openai.chat.completions.create({
        model,
        messages,
        max_tokens: 1024,
      });
      const text = choices[0].message.content;
      if (cache) await setCachedReply(key, text);
      return text;
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      attempt += 1;
      const wait = 2 ** attempt * 1000;
      console.warn(
        `OpenAI error (${err.status ?? "unknown"}). Retrying in ${wait} ms…`
      );
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
export function parseReply(text, allFiles) {
  const map = new Map();
  for (const f of allFiles) {
    map.set(path.basename(f).toLowerCase(), f);
  }

  // Try JSON first
  try {
    const obj = JSON.parse(text);
    if (obj && Array.isArray(obj.keep) && Array.isArray(obj.aside)) {
      const keep = new Set();
      const aside = new Set();

      for (const name of obj.keep) {
        const f = map.get(String(name).toLowerCase());
        if (f) keep.add(f);
      }
      for (const name of obj.aside) {
        const f = map.get(String(name).toLowerCase());
        if (f) aside.add(f);
      }

      for (const f of allFiles) {
        if (!keep.has(f) && !aside.has(f)) aside.add(f);
      }
      return { keep: [...keep], aside: [...aside] };
    }
  } catch {
    // fall through to plain text handling
  }

  const keep = new Set();
  const aside = new Set();

  const lines = text.split("\n").map((l) => l.trim().toLowerCase());
  for (const line of lines) {
    for (const [name, f] of map) {
      let short = name;
      const idx = name.indexOf("dscf");
      if (idx !== -1) short = name.slice(idx);

      if (line.includes(name) || (short !== name && line.includes(short))) {
        if (line.includes("keep")) keep.add(f);
        if (line.includes("aside")) aside.add(f);
      }
    }
  }

  for (const f of allFiles) {
    if (!keep.has(f) && !aside.has(f)) aside.add(f);
  }

  return { keep: [...keep], aside: [...aside] };
}
