import { OpenAI, NotFoundError } from "openai";
import KeepAliveAgent from "agentkeepalive";
import { readFile, stat, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { batchStore } from "./batchContext.js";
import { sanitizePeople, isPlaceholder } from "./lib/people.js";
import { finalizeCurators } from "./core/finalizeCurators.js";
import { delay } from "./config.js";
import { scheduler } from "./scheduler.js";
import {
  computeMaxOutputTokens,
  estimateInputTokens,
} from "./tokenEstimate.js";
import { enforceEffortGuard } from "./effortGuard.js";

function numEnv(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const HTTP_DRIVER = String(
  process.env.PHOTO_SELECT_HTTP_DRIVER || ""
).toLowerCase();
const USE_UNDICI = HTTP_DRIVER === "undici";
const DEFAULT_TIMEOUT =
  Number.parseInt(process.env.PHOTO_SELECT_TIMEOUT_MS, 10) || 180000;
const RETRY_BASE = Number(process.env.PHOTO_SELECT_RETRY_BASE_MS || 1000);
const MAX_RETRIES = Number(process.env.PHOTO_SELECT_MAX_RETRIES || 6);
const RETRIABLE = new Set([408, 429, 502, 503, 504]);
function isSocketReset(err) {
  return ["EPIPE", "ECONNRESET"].includes(err?.cause?.code || err?.code);
}

let httpsAgent;
if (!USE_UNDICI) {
  httpsAgent = new KeepAliveAgent.HttpsAgent({
    keepAlive: true,
    maxSockets: numEnv("PHOTO_SELECT_MAX_SOCKETS", 8),
    maxFreeSockets: numEnv("PHOTO_SELECT_MAX_FREE_SOCKETS", 4),
    keepAliveMsecs: numEnv("PHOTO_SELECT_KEEPALIVE_MS", 10000),
    freeSocketTimeout: numEnv("PHOTO_SELECT_FREE_SOCKET_TIMEOUT_MS", 60000),
    timeout: DEFAULT_TIMEOUT,
  });
  httpsAgent.on("error", (err) => {
    if (["EPIPE", "ECONNRESET"].includes(err.code)) {
      console.warn("agent error:", err.message);
    } else {
      throw err;
    }
  });
}

const openai = new OpenAI({
  ...(httpsAgent ? { httpAgent: httpsAgent } : {}),
  timeout: DEFAULT_TIMEOUT,
  maxRetries: MAX_RETRIES,
});
const PEOPLE_API_BASE =
  process.env.PHOTO_FILTER_API_BASE || "http://localhost:3000";
const PEOPLE_CONCURRENCY = numEnv("PHOTO_SELECT_PEOPLE_CONCURRENCY", 2);
let peopleAgent;
if (!USE_UNDICI) {
  peopleAgent = PEOPLE_API_BASE.startsWith("https")
    ? new KeepAliveAgent.HttpsAgent({
        keepAlive: true,
        maxSockets: PEOPLE_CONCURRENCY,
        maxFreeSockets: PEOPLE_CONCURRENCY,
      })
    : new KeepAliveAgent({
        keepAlive: true,
        maxSockets: PEOPLE_CONCURRENCY,
        maxFreeSockets: PEOPLE_CONCURRENCY,
      });
}
class SimpleSemaphore {
  constructor(max) {
    this.max = max;
    this.inUse = 0;
    this.q = [];
  }
  async run(fn) {
    if (this.inUse >= this.max) {
      await new Promise((resolve) => this.q.push(resolve));
    }
    this.inUse++;
    try {
      return await fn();
    } finally {
      this.inUse = Math.max(0, this.inUse - 1);
      const next = this.q.shift();
      if (next) next();
    }
  }
}
const peopleSem = new SimpleSemaphore(PEOPLE_CONCURRENCY);
const peopleCache = new Map();

const BUMP_TOKENS = numEnv("PHOTO_SELECT_BUMP_TOKENS", 4000);

const MAX_DEBUG_BYTES = 5 * 1024 * 1024;

function debugDir() {
  const base = process.env.PHOTO_SELECT_DEBUG_DIR || process.cwd();
  return path.join(base, ".debug");
}

async function logWarn(msg) {
  console.warn(msg);
  const dir = debugDir();
  await mkdir(dir, { recursive: true });
  await appendFile(path.join(dir, "warnings.log"), `${msg}\n`);
}

function extractBlock(raw, start, end) {
  if (!raw) return null;
  const s = String(raw);
  const i = s.indexOf(start);
  const j = s.indexOf(end, i + start.length);
  if (i === -1 || j === -1) return null;
  return s.slice(i + start.length, j).trim();
}

function extractPayload(rsp) {
  if (typeof rsp.output_text === "string" && rsp.output_text.trim()) {
    return { text: rsp.output_text, json: null, hasMessage: true };
  }
  const msg = rsp.output?.find((o) => o.type === "message");
  if (!msg) return { text: "", json: null, hasMessage: false };
  const jsonPart = msg.content?.find((c) => c.type === "output_json" && c.json);
  if (jsonPart) {
    return {
      text: JSON.stringify(jsonPart.json),
      json: jsonPart.json,
      hasMessage: true,
    };
  }
  const textPart = msg.content?.find((c) => c.type === "output_text" && c.text?.trim());
  if (textPart) return { text: textPart.text, json: null, hasMessage: true };
  return { text: "", json: null, hasMessage: true };
}

async function extractTextWithLogging(rsp) {
  const types =
    rsp.output?.flatMap((o) =>
      o.type === "message" ? (o.content || []).map((c) => c.type) : [o.type]
    ) || [];
  console.log(
    `\uD83D\uDD0E responses.create content types: ${types.join(", ")}`
  );
  console.log(
    `\uD83D\uDD0E output_text length: ${rsp.output_text?.length || 0}`
  );
  const { text, json, hasMessage } = extractPayload(rsp);
  const debug = process.env.PHOTO_SELECT_DEBUG;
  if (!hasMessage || !text.trim() || debug) {
    const dir = debugDir();
    await mkdir(dir, { recursive: true });
    const f = path.join(dir, `resp-${Date.now()}.json`);
    let body = JSON.stringify(rsp, null, 2);
    if (Buffer.byteLength(body) > MAX_DEBUG_BYTES) {
      body = body.slice(0, MAX_DEBUG_BYTES);
      await logWarn(
        `⚠️  Responses payload truncated to ${MAX_DEBUG_BYTES} bytes at ${f}`
      );
    }
    await writeFile(f, body);
    if (!hasMessage || !text.trim()) {
      await logWarn(`⚠️ Empty text; full Responses payload saved to ${f}`);
    } else {
      console.log(`\uD83D\uDC1B  Saved raw Responses payload to ${f}`);
      await appendFile(
        path.join(dir, "warnings.log"),
        `Saved Responses payload to ${f}\n`
      );
    }
  }
  if (debug) {
    console.log(`\uD83D\uDC1B  First 400 chars: ${text.slice(0, 400)}`);
  }
  return { text, json, hasMessage };
}

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
    const url = `${PEOPLE_API_BASE}/api/photos/by-filename/${encodeURIComponent(
      filename
    )}/persons`;
    const res = await peopleSem.run(() =>
      fetch(url, peopleAgent ? { agent: peopleAgent } : undefined)
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const names = Array.isArray(json.data) ? json.data : [];
    peopleCache.set(filename, names);
    return names;
  } catch (err) {
    const msg = err?.message || err?.code || "unknown error";
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
  return [...counts.entries()]
    .filter(([n, c]) => c > 1)
    .map(([n]) => n);
}

/** Max response tokens allowed from OpenAI. Large enough to hold
 * minutes plus the full JSON decision block without truncation. */
export const MAX_RESPONSE_TOKENS = 32000;

export function buildPhotoSelectSchema({ files = [], minutesMin = 3, minutesMax = 12 }) {
  const decisionItem = {
    type: 'object',
    additionalProperties: false,
    // Strict JSON schema requires required[] to include every key in properties.
    required: ['filename', 'decision', 'reason'],
    properties: {
      filename: { type: 'string', enum: files },
      decision: { type: 'string', enum: ['keep', 'aside'] },
      reason: { type: 'string' } // allow empty string when no rationale
    },
  };
  return {
    name: 'PhotoSelectPanelV1',
    schema: {
      type: 'object',
      required: ['minutes', 'decisions'],
      additionalProperties: false,
      properties: {
        minutes: {
          type: 'array',
          description: 'Transcript of curator discussion',
          minItems: minutesMin,
          maxItems: minutesMax,
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

export function schemaForBatch(used, curators = [], minutes = {}) {
  const files = used.map((f) => path.basename(f));
  return buildPhotoSelectSchema({ files, ...minutes });
}

export function useResponses(model) {
  return /^gpt-5/.test(model);
}

function ensureJsonMention(text) {
  return /\bjson\b/i.test(text) ? text : `${text}\nRespond in json format.`;
}

const CACHE_DIR = path.resolve(".cache");
const CACHE_KEY_PREFIX = "v5";

function useColor() {
  return process.stdout.isTTY && process.env.NO_COLOR !== "1";
}
const dim = (s) => (useColor() ? `\x1b[2m${s}\x1b[0m` : s);

async function getCachedReply(key, used = []) {
  try {
    const file = path.join(CACHE_DIR, `${key}.txt`);
    const text = await readFile(file, "utf8");
    const { keep, aside } = parseReply(text, used);
    if (keep.length + aside.length === 0) {
      try {
        await rm(file);
      } catch {}
      return null;
    }
    return text;
  } catch {
    return null;
  }
}

async function setCachedReply(key, text, used = []) {
  const { keep, aside } = parseReply(text, used);
  if (keep.length + aside.length === 0) {
    console.log(dim(`cache: skip (0 decisions)`));
    return;
  }
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path.join(CACHE_DIR, `${key}.txt`), text, "utf8");
}

export async function cacheKey({
  prompt,
  images,
  model,
  curators = [],
  verbosity,
  reasoningEffort,
}) {
  const hash = crypto.createHash("sha256");
  hash.update(CACHE_KEY_PREFIX);
  hash.update(model);
  hash.update(prompt);
  if (curators.length) hash.update(curators.join(","));
  if (verbosity) hash.update(verbosity);
  if (reasoningEffort) hash.update(reasoningEffort);
  for (const file of images) {
    const info = await stat(file);
    hash.update(file);
    hash.update(String(info.mtimeMs));
    hash.update(String(info.size));
  }
  return hash.digest("hex");
}

/**
 * Builds the array of message objects for the Chat Completion API.
 * Encodes each image as a base64 data‑URL so it can be inspected by vision models.
 */
export async function buildMessages(prompt, images, curators = []) {
  let content = prompt;
  if (curators.length) {
    const names = curators.join(", ");
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
    const peopleRaw = await getPeople(name);
    const people = sanitizePeople(peopleRaw);
    const dropped = peopleRaw.filter((p) => isPlaceholder(p));
    if (dropped.length && process.env.PHOTO_SELECT_VERBOSE === "1") {
      const ctx = batchStore.getStore();
      const prefix = ctx?.batch ? `Batch ${ctx.batch} ` : "";
      console.log(
        `⚠️  ${prefix}dropped placeholder people tags for ${name}: ${dropped.join(", ")}`
      );
    }
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
    const names = curators.join(", ");
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
    const peopleRaw = await getPeople(name);
    const people = sanitizePeople(peopleRaw);
    const dropped = peopleRaw.filter((p) => isPlaceholder(p));
    if (dropped.length && process.env.PHOTO_SELECT_VERBOSE === "1") {
      const ctx = batchStore.getStore();
      const prefix = ctx?.batch ? `Batch ${ctx.batch} ` : "";
      console.log(
        `⚠️  ${prefix}dropped placeholder people tags for ${name}: ${dropped.join(", ")}`
      );
    }
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
          {
            type: "input_text",
            text: ensureJsonMention("Here are the images:"),
          },
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
  verbosity = "low",
  reasoningEffort = "minimal",
  cache = true,
  curators = [],
  stream = false,
  onProgress = () => {},
  responseFormat,
  minutesMin = 3,
  minutesMax = 12,
  aliasMap = {},
}) {
  const allowedVerbosity = ["low", "medium", "high"];
  const allowedEffort = ["auto", "minimal", "low", "medium", "high"];
  if (!allowedVerbosity.includes(verbosity)) {
    throw new Error(`invalid verbosity: ${verbosity}`);
  }
  if (!allowedEffort.includes(reasoningEffort)) {
    throw new Error(`invalid reasoningEffort: ${reasoningEffort}`);
  }
  if (reasoningEffort !== "auto") {
    enforceEffortGuard(reasoningEffort);
  }
  const effort = reasoningEffort === "auto" ? "" : reasoningEffort;
  const effortForTokens = effort || "low";

  const photos = [];
  for (let idx = 0; idx < images.length; idx++) {
    const file = images[idx];
    const name = path.basename(file);
    const peopleRaw = await getPeople(name);
    const people = sanitizePeople(peopleRaw);
    const dropped = peopleRaw.filter((p) => isPlaceholder(p));
    if (dropped.length && process.env.PHOTO_SELECT_VERBOSE === "1") {
      const ctx = batchStore.getStore();
      const prefix = ctx?.batch ? `Batch ${ctx.batch} ` : "";
      console.log(
        `⚠️  ${prefix}dropped placeholder people tags for ${name}: ${dropped.join(", ")}`
      );
    }
    photos.push({ file: name, people });
  }
  const { finalCurators, added } = finalizeCurators(curators, photos, {
    aliasMap,
  });
  if (added.length) {
    const info = batchStore.getStore();
    const prefix = info?.batch ? `Batch ${info.batch} ` : "";
    console.log(
      `👥  ${prefix}additional curators from tags: ${added.join(", ")}`
    );
  }
  let finalPrompt = prompt;
  if (finalCurators.length) {
    const names = finalCurators.join(", ");
    finalPrompt = prompt.replace(/\{\{curators\}\}/g, names);
  }

  finalPrompt = ensureJsonMention(finalPrompt);
  finalPrompt += "\nOnly include these filenames; do not invent new ones.";

  const isGpt5 = useResponses(model);
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      onProgress("encoding");
      if (isGpt5) {
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
          verbosity,
          reasoningEffort,
        });
        if (cache) {
          const hit = await getCachedReply(key, used);
          if (hit) return hit;
        }
        const schema = schemaForBatch(used, finalCurators, {
          minutesMin,
          minutesMax,
        });
        // ADAPTIVE max_output_tokens
        const max_output_tokens = computeMaxOutputTokens({
          decisionsCount: used.length,
          minutesCount: minutesMax,
          effort: effortForTokens,
        });
        // ESTIMATE input tokens
        const schemaJson = JSON.stringify(
          schema?.schema || schema || {},
          null,
          0,
        );
        const estInputTokens = estimateInputTokens({
          instructions,
          schemaJson,
          imageCount: used.length,
          imageDetail: "low",
          extraText: "",
        });
        onProgress("request");
        const baseOpts = {
          model,
          instructions,
          input,
          text: {
            verbosity,
            format: {
              type: "json_schema",
              name: schema.name,
              schema: schema.schema,
              strict: true,
            },
          },
          ...(effort ? { reasoning: { effort } } : {}),
          max_output_tokens,
        };
        if (process.env.PHOTO_SELECT_VERBOSE === "1") {
          const sizeMB = (
            Buffer.byteLength(JSON.stringify(baseOpts)) /
            1024 /
            1024
          ).toFixed(1);
          console.log(
            `⇢  Sending payload ~${sizeMB} MiB for ${used.length} image(s)`
          );
        }
        const headers = { "Idempotency-Key": crypto.randomUUID() };
        const estTokens = estInputTokens + max_output_tokens;
        const handle = await scheduler.reserve({ model, estTokens });
        onProgress("waiting");
        let rsp;
        try {
          rsp = await openai.responses.create(baseOpts, { headers });
          const usage = rsp?.usage;
          const actual =
            Number(usage?.total_tokens) ||
            (Number(usage?.input_tokens || 0) +
              Number(usage?.output_tokens || 0)) ||
            estTokens;
          scheduler.commit(handle, actual);
        } catch (e) {
          scheduler.cancel(handle);
          throw e;
        }
        const reqId = rsp?.response?.headers?.["x-request-id"];
        if (reqId) console.log(`🆔 request-id: ${reqId}`);
        let { text, hasMessage } = await extractTextWithLogging(rsp);
        if (!hasMessage || !text.trim()) {
          console.warn("⚠️ Empty text; retrying with more tokens…");
          max_output_tokens = Math.min(
            max_output_tokens + BUMP_TOKENS,
            32000
          );
          const estTokens2 = estInputTokens + max_output_tokens;
          const handle2 = await scheduler.reserve({ model, estTokens: estTokens2 });
          try {
            rsp = await openai.responses.create(
              { ...baseOpts, max_output_tokens },
              { headers: { "Idempotency-Key": crypto.randomUUID() } },
            );
            const usage2 = rsp?.usage;
            const actual2 =
              Number(usage2?.total_tokens) ||
              (Number(usage2?.input_tokens || 0) +
                Number(usage2?.output_tokens || 0)) ||
              estTokens2;
            scheduler.commit(handle2, actual2);
          } catch (e) {
            scheduler.cancel(handle2);
            throw e;
          }
          ({ text, hasMessage } = await extractTextWithLogging(rsp));
          if (!hasMessage || !text.trim()) {
            throw new Error("Empty text after retry");
          }
        }
        if (cache) await setCachedReply(key, text, used);
        onProgress("done");
        return text;
      }

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
        const hit = await getCachedReply(key, used);
        if (hit) return hit;
      }

      const max_output_tokens = computeMaxOutputTokens({
        decisionsCount: used.length,
        minutesCount: minutesMax,
        effort: effortForTokens,
      });
      const estInputTokens = estimateInputTokens({
        instructions: finalPrompt,
        schemaJson: "",
        imageCount: used.length,
        imageDetail: "low",
        extraText: "",
      });
      onProgress("request");
      const baseParams = {
        model,
        messages,
      };
      if (responseFormat === undefined) {
        baseParams.response_format = { type: "json_object" };
      } else if (responseFormat !== null) {
        baseParams.response_format = responseFormat;
      }
      const needsCompletionTokens = /^o\d/.test(model);
      if (needsCompletionTokens) {
        baseParams.max_completion_tokens = max_output_tokens;
      } else {
        baseParams.max_tokens = max_output_tokens;
      }
      const estTokens = estInputTokens + max_output_tokens;
      const handle = await scheduler.reserve({ model, estTokens });
      onProgress("waiting");
      let text;
      try {
        if (stream) {
          const streamResp = await openai.chat.completions.create({
            ...baseParams,
            stream: true,
          });
          onProgress("stream");
          text = "";
          for await (const chunk of streamResp) {
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              text += delta;
            }
          }
          scheduler.commit(handle, estTokens);
        } else {
          const { choices, usage } = await openai.chat.completions.create(
            baseParams,
          );
          text = choices[0].message.content;
          const actual =
            Number(usage?.total_tokens) ||
            (Number(usage?.prompt_tokens || 0) +
              Number(usage?.completion_tokens || 0)) ||
            estTokens;
          scheduler.commit(handle, actual);
        }
      } catch (e) {
        scheduler.cancel(handle);
        throw e;
      }
      if (cache) await setCachedReply(key, text, used);
      onProgress("done");
      return text;
    } catch (err) {
      const msg = String(err?.error?.message || err?.message || "");
      const code = err?.code || err?.cause?.code;
      const isNetwork =
        err?.name === "APIConnectionError" ||
        ["EPIPE", "ECONNRESET", "ETIMEDOUT"].includes(code);
      if (
        !isGpt5 &&
        (err instanceof NotFoundError || err.status === 404) &&
        (/v1\/responses/.test(msg) ||
          /v1\/completions/.test(msg) ||
          /not a chat model/i.test(msg))
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
          verbosity,
          reasoningEffort,
        });
        const schema = schemaForBatch(used, finalCurators, {
          minutesMin,
          minutesMax,
        });
        const max_output_tokens = computeMaxOutputTokens({
          decisionsCount: used.length,
          minutesCount: minutesMax,
          effort: effortForTokens,
        });
        const schemaJson = JSON.stringify(
          schema?.schema || schema || {},
          null,
          0,
        );
        const estInputTokens = estimateInputTokens({
          instructions,
          schemaJson,
          imageCount: used.length,
          imageDetail: "low",
          extraText: "",
        });
        onProgress("request");
        const baseOpts = {
          model,
          instructions,
          input,
          text: {
            verbosity,
            format: {
              type: "json_schema",
              name: schema.name,
              schema: schema.schema,
              strict: true,
            },
          },
          ...(effort ? { reasoning: { effort } } : {}),
          max_output_tokens,
        };
        if (process.env.PHOTO_SELECT_VERBOSE === "1") {
          const sizeMB = (
            Buffer.byteLength(JSON.stringify(baseOpts)) /
            1024 /
            1024
          ).toFixed(1);
          console.log(
            `⇢  Sending payload ~${sizeMB} MiB for ${used.length} image(s)`
          );
        }
        const headers = { "Idempotency-Key": crypto.randomUUID() };
        const estTokens = estInputTokens + max_output_tokens;
        const handle = await scheduler.reserve({ model, estTokens });
        onProgress("waiting");
        let rsp;
        try {
          rsp = await openai.responses.create(baseOpts, { headers });
          const usage = rsp?.usage;
          const actual =
            Number(usage?.total_tokens) ||
            (Number(usage?.input_tokens || 0) +
              Number(usage?.output_tokens || 0)) ||
            estTokens;
          scheduler.commit(handle, actual);
        } catch (e) {
          scheduler.cancel(handle);
          throw e;
        }
        const reqId = rsp?.response?.headers?.["x-request-id"];
        if (reqId) console.log(`🆔 request-id: ${reqId}`);
        let { text, hasMessage } = await extractTextWithLogging(rsp);
        if (!hasMessage || !text.trim()) {
          console.warn("⚠️ Empty text; retrying with more tokens…");
          max_output_tokens = Math.min(
            max_output_tokens + BUMP_TOKENS,
            32000
          );
          const estTokens2 = estInputTokens + max_output_tokens;
          const handle2 = await scheduler.reserve({ model, estTokens: estTokens2 });
          try {
            rsp = await openai.responses.create(
              { ...baseOpts, max_output_tokens },
              { headers: { "Idempotency-Key": crypto.randomUUID() } },
            );
            const usage2 = rsp?.usage;
            const actual2 =
              Number(usage2?.total_tokens) ||
              (Number(usage2?.input_tokens || 0) +
                Number(usage2?.output_tokens || 0)) ||
              estTokens2;
            scheduler.commit(handle2, actual2);
          } catch (e) {
            scheduler.cancel(handle2);
            throw e;
          }
          ({ text, hasMessage } = await extractTextWithLogging(rsp));
          if (!hasMessage || !text.trim()) {
            throw new Error("Empty text after retry");
          }
        }
        if (cache) await setCachedReply(key, text, used);
        onProgress("done");
        return text;
      }

      const status = err?.status || err?.code;
      const transient =
        RETRIABLE.has(Number(status)) ||
        ["EPIPE", "ECONNRESET", "ETIMEDOUT"].includes(err?.cause?.code || err?.code);
      if (!transient || attempt >= MAX_RETRIES) throw err;
      attempt += 1;
      const base = Math.min(30000, RETRY_BASE * 2 ** attempt);
      const wait = Math.round(base * (0.7 + Math.random() * 0.6));
      const retryAfter = Number(err?.headers?.["retry-after"] || 0) * 1000;
      const delayMs = Math.max(wait, retryAfter);
      const label = isNetwork ? "network error" : "OpenAI error";
      const codeInfo = status ?? code ?? "unknown";
      const reqId = err?.response?.headers?.["x-request-id"];
      console.warn(`${label} (${codeInfo}). Retrying in ${delayMs} ms…`);
      if (reqId) console.warn(`request-id: ${reqId}`);
      console.warn("Full error response:", err);
      if (attempt === 2 && isSocketReset(err) && httpsAgent?.keepAlive) {
        httpsAgent.keepAlive = false;
        console.warn("Disabling keep-alive due to socket resets");
      }
      await delay(delayMs);
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
export function parseReply(text, allFiles, meta = {}) {
  let body = text;
  const fenced = body.trim();
  if (fenced.startsWith("```")) {
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
      const idx = lc.indexOf("dscf");
      if (idx !== -1) f = map.get(lc.slice(idx));
    }
    return f;
  };

  const keep = new Set();
  const aside = new Set();
  const notes = new Map();
  const minutes = [];
  let unclassified = [];

  let fieldNotesDiff;
  let fieldNotesMd;
  let fieldNotesInstructions;
  let commitMessage;

  let parsed = false;

  try {
    const obj = JSON.parse(body.trim());
    if (meta.expectFieldNotesDiff && typeof obj.field_notes_diff === "string") {
      fieldNotesDiff = obj.field_notes_diff;
    }
    if (meta.expectFieldNotesMd && typeof obj.field_notes_md === "string") {
      fieldNotesMd = obj.field_notes_md;
    }
    if (
      meta.expectFieldNotesInstructions &&
      typeof obj.field_notes_instructions === "string"
    ) {
      fieldNotesInstructions = obj.field_notes_instructions;
    }
    if (typeof obj.commit_message === "string") {
      commitMessage = obj.commit_message.trim();
    }
    if (obj && Array.isArray(obj.decisions)) {
      for (const item of obj.decisions) {
        if (!item || typeof item !== 'object') continue;
        const base = String(item.filename || '').trim();
        if (!base) continue;
        const f = allFiles.find((p) => path.basename(p) === base);
        if (!f) continue;
        const choice = String(item.decision || '').toLowerCase();
        if (choice === 'keep') {
          keep.add(f);
        } else if (choice === 'aside') {
          aside.add(f);
        }
        if (typeof item.reason === 'string' && item.reason.trim()) {
          notes.set(f, item.reason.trim());
        }
      }
      if (Array.isArray(obj.minutes)) {
        for (const m of obj.minutes) {
          if (m && typeof m === 'object' && typeof m.speaker === 'string' && typeof m.text === 'string') {
            minutes.push(m.speaker + ': ' + m.text);
          }
        }
      }
      parsed = true;
    }
  } catch {
    // not JSON; fall through
  }

  if (!parsed) {
    const block = extractBlock(text, '=== DECISIONS_JSON ===', '=== END ===');
    if (block) {
      try {
        const obj = JSON.parse(block);
        if (Array.isArray(obj.decisions)) {
          for (const item of obj.decisions) {
            if (!item || typeof item !== 'object') continue;
            const base = String(item.filename || '').trim();
            if (!base) continue;
            const f = allFiles.find((p) => path.basename(p) === base);
            if (!f) continue;
            const choice = String(item.decision || '').toLowerCase();
            if (choice === 'keep') keep.add(f);
            if (choice === 'aside') aside.add(f);
            if (typeof item.reason === 'string' && item.reason.trim()) {
              notes.set(f, item.reason.trim());
            }
          }
          parsed = true;
        }
      } catch {
        /* fall through */
      }
    }
  }

if (!parsed) {
  try {
    const obj = JSON.parse(body);
    const extract = (node) => {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node.minutes))
        minutes.push(...node.minutes.map((m) => m.speaker + ': ' + m.text));
      if (node.keep && node.aside) return node;
      if (node.decision && node.decision.keep && node.decision.aside)
        return node.decision;
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
          for (const item of val) {
            if (typeof item === 'string') {
              const f = lookup(item);
              if (f) set.add(f);
            } else if (item && typeof item === 'object') {
              const f = lookup(item.file);
              if (f) {
                set.add(f);
                if (item.reason) notes.set(f, String(item.reason));
              }
            }
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
      if (Array.isArray(decision.unclassified)) {
        for (const n of decision.unclassified) {
          const f = lookup(n);
          if (f) unclassified.push(f);
        }
      }
      parsed = true;
    }
  } catch {
    // ignore JSON errors
  }
}

// Salvage structured lines like "KEEP file — reason"
if (!parsed) {
  const salvage = [];
  for (const line of String(body).split("\n")) {
    const m = line.match(/^(?:\s*)\b(KEEP|ASIDE)\b\s+(\S+)\s+—\s+(.*)$/i);
    if (m) {
      salvage.push({
        decision: m[1].toLowerCase(),
        filename: m[2],
        reason: m[3] || "",
      });
    }
  }
  if (salvage.length) {
    for (const { decision, filename, reason } of salvage) {
      const f = lookup(filename);
      if (!f) continue;
      (decision === "keep" ? keep : aside).add(f);
      if (reason) notes.set(f, reason);
    }
    parsed = true;
  }
}

if (!parsed) {
    const lines = body.split("\n");
    for (const raw of lines) {
      const line = raw.trim();
      const lower = line.toLowerCase();
      const tm = line.match(/^([^:]+):\s*(.+)$/);
      if (tm) minutes.push(`${tm[1].trim()}: ${tm[2].trim()}`);
      for (const [name, f] of map) {
        let short = name;
        const idx = name.indexOf("dscf");
        if (idx !== -1) short = name.slice(idx);

        if (lower.includes(name) || (short !== name && lower.includes(short))) {
          let decision;
          if (lower.includes("keep")) decision = "keep";
          if (lower.includes("aside")) decision = "aside";
          if (decision === "keep") keep.add(f);
          if (decision === "aside") aside.add(f);

          const m = line.match(/(?:keep|aside)[^a-z0-9]*[:\-–—]*\s*(.*)/i);
          if (m && m[1]) notes.set(f, m[1].trim());
        }
      }
    }
  }

  // Leave any files unmentioned in the reply unmoved so they can be triaged
  // in a later batch. Only files explicitly marked keep or aside are returned.

  // Prefer keeping when a file appears in both groups
  for (const f of keep) aside.delete(f);

  const decided = new Set([...keep, ...aside]);
  if (!unclassified.length) {
    unclassified = allFiles.filter((f) => !decided.has(f));
  } else {
    unclassified = unclassified.filter((f) => !decided.has(f));
  }

  if (
    keep.size === 0 &&
    aside.size === 0 &&
    minutes.length === 0 &&
    notes.size === 0
  ) {
    const failFile = path.join(
      debugDir(),
      `failed-reply-${crypto.randomUUID()}.json`
    );
    const payload = {
      model: meta.model,
      verbosity: meta.verbosity,
      reasoningEffort: meta.reasoningEffort,
      files: allFiles.map((f) => path.basename(f)),
      reply: body,
    };
    try {
      mkdirSync(path.dirname(failFile), { recursive: true });
      writeFileSync(failFile, JSON.stringify(payload, null, 2));
    } catch {
      // ignore file write errors
    }
    console.warn(`⚠️  empty reply saved to ${failFile}`);
  }

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
