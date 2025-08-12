import { OpenAI, NotFoundError } from "openai";
import KeepAliveAgent from "agentkeepalive";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { batchStore } from "./batchContext.js";
import { delay } from "./config.js";

const DEFAULT_TIMEOUT = 20 * 60 * 1000;
const httpsAgent = new KeepAliveAgent.HttpsAgent({
  keepAlive: true,
  timeout: Number.parseInt(process.env.PHOTO_SELECT_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT,
});
httpsAgent.on("error", (err) => {
  if (["EPIPE", "ECONNRESET"].includes(err.code)) {
    console.warn("agent error:", err.message);
  } else {
    throw err;
  }
});

const openai = new OpenAI({ httpAgent: httpsAgent });
const PEOPLE_API_BASE =
  process.env.PHOTO_FILTER_API_BASE || "http://localhost:3000";
const peopleCache = new Map();

async function readFileSafe(file, attempt = 0, maxAttempts = 3) {
  try {
    return await readFile(file);
  } catch (err) {
    if (err?.code === "ECANCELED") {
      if (attempt < maxAttempts) {
        const wait = (attempt + 1) * 1000;
        console.warn(`read canceled for ${file}. Retrying in ${wait}ms…`);
        await delay(wait);
        return readFileSafe(file, attempt + 1, maxAttempts);
      }
      console.warn(`⚠️  Skipping unreadable file ${file}`);
      return null;
    }
    throw err;
  }
}

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
  } catch (err) {
    const msg = err?.message || err?.code || 'unknown error';
    console.warn(`\u26A0\uFE0F  metadata fetch failed for ${filename}: ${msg}`);
    peopleCache.set(filename, []);
    return [];
  }
}

/** Return any people who appear in more than one file */
export async function curatorsFromTags(files) {
  const counts = new Map();
  for (const file of files) {
    const name = path.basename(file);
    const people = await getPeople(name);
    for (const person of people) {
      counts.set(person, (counts.get(person) || 0) + 1);
    }
  }
  const banned = new Set(["_UNKNOWN_"]);
  return [...counts.entries()]
    .filter(([n, c]) => c > 1 && !banned.has(n))
    .map(([n]) => n);
}

/** Max response tokens allowed from OpenAI. Large enough to hold
 * minutes plus the full JSON decision block without truncation. */
export const MAX_RESPONSE_TOKENS = 8192;

export function buildGPT5Schema({ files = [] }) {
  const decisionItem = {
    type: 'object',
    additionalProperties: false,
    // require reason even if empty string
    required: ['filename', 'decision', 'reason'],
    properties: {
      filename: { type: 'string', enum: files },
      decision: { type: 'string', enum: ['keep', 'aside'] },
      reason: { type: 'string' },
    },
  };
  return {
    name: 'photo_select_decision',
    schema: {
      type: 'object',
      required: ['minutes', 'decisions'],
      additionalProperties: false,
      properties: {
        minutes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['speaker', 'text'],
            additionalProperties: false,
            properties: {
              speaker: { type: 'string' },
              text: { type: 'string' },
            },
          },
        },
        decisions: {
          type: 'array',
          description: 'Per-file decisions',
          items: decisionItem,
          minItems: 0,
        },
      },
    },
  };
}

export function schemaForBatch(used, curators = []) {
  const files = used.map((f) => path.basename(f));
  return buildGPT5Schema({ files });
}

export function useResponses(model) {
  return /^gpt-5/i.test(model);
}

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
  let content = prompt;
  if (curators.length) {
    const names = curators.join(', ');
    content = content.replace(/\{\{curators\}\}/g, names);
  }
  const system = { role: "system", content };

  const used = [];
  const userImageParts = [];
  for (const file of images) {
    const abs = path.resolve(file);
    const buffer = await readFileSafe(abs);
    if (!buffer) continue;
    used.push(file);
    const base64 = buffer.toString("base64");
    const name = path.basename(file);
    const ext = path.extname(file).slice(1) || "jpeg";
    const people = await getPeople(name);
    const info = people.length ? { filename: name, people } : { filename: name };
    userImageParts.push(
      { type: "text", text: JSON.stringify(info) },
      {
        type: "image_url",
        image_url: {
          url: `data:image/${ext};base64,${base64}`,
          detail: "high",
        },
      }
    );
  }


  const userText = {
    role: "user",
    content: [
      { type: "text", text: ensureJsonMention("Here are the images:") },
      ...userImageParts,
    ],
  };

  return { messages: [system, userText], used };
}

/** Build input array for the Responses API */
export async function buildInput(prompt, images, curators = []) {
  let instructions = prompt;
  if (curators.length) {
    const names = curators.join(', ');
    instructions = instructions.replace(/\{\{curators\}\}/g, names);
  }
  const used = [];
  const imageParts = [];
  for (const file of images) {
    const abs = path.resolve(file);
    const buffer = await readFileSafe(abs);
    if (!buffer) continue;
    used.push(file);
    const base64 = buffer.toString("base64");
    const name = path.basename(file);
    const ext = path.extname(file).slice(1) || "jpeg";
    const people = await getPeople(name);
    const info = people.length ? { filename: name, people } : { filename: name };
    imageParts.push(
      { type: "input_text", text: JSON.stringify(info) },
      {
        type: "input_image",
        image_url: `data:image/${ext};base64,${base64}`,
        detail: "high",
      }
    );
  }


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
    used,
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
  stream = false,
  onProgress = () => {},
  responseFormat,
}) {
  const extras = await curatorsFromTags(images);
  const added = extras.filter((n) => !curators.includes(n));
  const finalCurators = Array.from(new Set([...curators, ...extras]));
  if (added.length) {
    const info = batchStore.getStore();
    const prefix = info?.batch ? `Batch ${info.batch} ` : "";
    console.log(`👥  ${prefix}additional curators from tags: ${added.join(', ')}`);
  }
  let finalPrompt = prompt;
  if (finalCurators.length) {
    const names = finalCurators.join(', ');
    finalPrompt = prompt.replace(/\{\{curators\}\}/g, names);
  }

  finalPrompt = ensureJsonMention(finalPrompt);
  const isResponsesModel = useResponses(model);

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      if (isResponsesModel) {
        onProgress('encoding');
        const { instructions, input, used } = await buildInput(
          finalPrompt,
          images,
          finalCurators
        );
        const key = await cacheKey({
          prompt: finalPrompt,
          images: used,
          model,
          curators: finalCurators,
        });
        if (cache) {
          const hit = await getCachedReply(key);
          if (hit) return hit;
        }
        const schema = schemaForBatch(used, finalCurators);
        onProgress('request');
        onProgress('waiting');
        const rsp = await openai.responses.create({
          model,
          instructions,
          input,
          text: { format: { type: 'json_schema', json_schema: schema } },
          max_output_tokens: MAX_RESPONSE_TOKENS,
        });
        const text = rsp.output_text;
        if (cache) await setCachedReply(key, text);
        onProgress('done');
        return text;
      }

      onProgress('encoding');
      const { messages, used } = await buildMessages(
        finalPrompt,
        images,
        finalCurators
      );

      const key = await cacheKey({
        prompt: finalPrompt,
        images: used,
        model,
        curators: finalCurators,
      });
      if (cache) {
        const hit = await getCachedReply(key);
        if (hit) return hit;
      }

      onProgress('request');
      const baseParams = {
        model,
        messages,
      };
      if (responseFormat === undefined) {
        baseParams.response_format = { type: 'json_object' };
      } else if (responseFormat !== null) {
        baseParams.response_format = responseFormat;
      }
      if (/^o\d/.test(model)) {
        baseParams.max_completion_tokens = MAX_RESPONSE_TOKENS;
      } else {
        baseParams.max_tokens = MAX_RESPONSE_TOKENS;
      }
      onProgress('waiting');
      let text;
      if (stream) {
        const streamResp = await openai.chat.completions.create({
          ...baseParams,
          stream: true,
        });
        text = "";
        for await (const chunk of streamResp) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            onProgress('stream');
          }
        }
      } else {
        const { choices } = await openai.chat.completions.create(baseParams);
        text = choices[0].message.content;
      }
      if (cache) await setCachedReply(key, text);
      onProgress('done');
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
        const { instructions, input, used } = await buildInput(
          finalPrompt,
          images,
          finalCurators
        );
        const key = await cacheKey({
          prompt: finalPrompt,
          images: used,
          model,
          curators: finalCurators,
        });
        const rsp = await openai.responses.create({
          model,
          instructions,
          input,
          text:
            responseFormat === undefined
              ? { format: { type: 'json_object' } }
              : responseFormat === null
                ? undefined
                : { format: responseFormat },
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
      console.warn("Full error response:", err);
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
  let body = text;
  const fenced = body.trim();
  if (fenced.startsWith('```')) {
    const match = fenced.match(/^```\w*\n([\s\S]*?)\n```$/);
    if (match) body = match[1];
  }
  const map = new Map();
  for (const f of allFiles) {
    map.set(path.basename(f).toLowerCase(), f);
  }
  const lookup = (name) => {
    const lc = String(name).toLowerCase();
    let f = map.get(lc);
    if (!f) {
      const idx = lc.indexOf('dscf');
      if (idx !== -1) f = map.get(lc.slice(idx));
    }
    return f;
  };
  const keep = new Set();
  const aside = new Set();
  const notes = new Map();
  const minutes = [];
  let fieldNotesDiff;
  let fieldNotesMd;
  let fieldNotesInstructions;
  let commitMessage;
  let parsed = false;
  try {
    const obj = JSON.parse(body);
    if (Array.isArray(obj.decisions)) {
      for (const item of obj.decisions) {
        if (!item || typeof item !== 'object') continue;
        const base = String(item.filename || '').trim();
        if (!base) continue;
        const f = allFiles.find((p) => path.basename(p) === base);
        if (!f) continue;
        const choice = String(item.decision || '').toLowerCase();
        if (choice === 'keep') keep.add(f);
        else if (choice === 'aside') aside.add(f);
        if (typeof item.reason === 'string' && item.reason.trim()) {
          notes.set(f, item.reason.trim());
        }
      }
      if (Array.isArray(obj.minutes)) {
        for (const m of obj.minutes) {
          if (m && typeof m === 'object' && m.speaker && m.text) {
            minutes.push(`${m.speaker}: ${m.text}`);
          }
        }
      }
      parsed = true;
    }
    if (opts.expectFieldNotesDiff && typeof obj.field_notes_diff === 'string') {
      fieldNotesDiff = obj.field_notes_diff;
    }
    if (opts.expectFieldNotesMd && typeof obj.field_notes_md === 'string') {
      fieldNotesMd = obj.field_notes_md;
    }
    if (
      opts.expectFieldNotesInstructions &&
      typeof obj.field_notes_instructions === 'string'
    ) {
      fieldNotesInstructions = obj.field_notes_instructions;
    }
    if (typeof obj.commit_message === 'string') {
      commitMessage = obj.commit_message.trim();
    }
    if (!parsed) {
      const extract = (node) => {
        if (!node || typeof node !== 'object') return null;
        if (Array.isArray(node.minutes))
          minutes.push(...node.minutes.map((m) => `${m.speaker}: ${m.text}`));
        if (node.keep && node.aside) return node;
        if (node.decision && node.decision.keep && node.decision.aside) {
          if (Array.isArray(node.minutes))
            minutes.push(...node.minutes.map((m) => `${m.speaker}: ${m.text}`));
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
        parsed = true;
      }
    }
  } catch {
    // ignore JSON errors
  }
  if (!parsed) {
    const lines = body.split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      const lower = line.toLowerCase();
      const tm = line.match(/^([^:]+):\s*(.+)$/);
      if (tm) minutes.push(`${tm[1].trim()}: ${tm[2].trim()}`);
      for (const [name, f] of map) {
        let short = name;
        const idx = name.indexOf('dscf');
        if (idx !== -1) short = name.slice(idx);
        if (lower.includes(name) || (short !== name && lower.includes(short))) {
          let decision;
          if (lower.includes('keep')) decision = 'keep';
          if (lower.includes('aside')) decision = 'aside';
          if (decision === 'keep') keep.add(f);
          if (decision === 'aside') aside.add(f);
          const m = line.match(/(?:keep|aside)[^a-z0-9]*[:\-–—]*\s*(.*)/i);
          if (m && m[1]) notes.set(f, m[1].trim());
        }
      }
    }
  }
  for (const f of keep) {
    aside.delete(f);
  }
  const decided = new Set([...keep, ...aside]);
  const unclassified = allFiles.filter((f) => !decided.has(f));
  return {
    keep: [...keep],
    aside: [...aside],
    unclassified,
    notes,
    minutes,
    fieldNotesDiff,
    fieldNotesMd,
    fieldNotesInstructions,
    commitMessage,
  };
}
