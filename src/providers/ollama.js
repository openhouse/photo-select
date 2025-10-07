import { buildMessages, MAX_RESPONSE_TOKENS } from "../chatClient.js";
import { delay } from "../config.js";
import { buildReplySchema } from "../replySchema.js";
import { parseFormatEnv } from "../formatOverride.js";
import path from "node:path";
import { getSurrogateImage } from "../imagePreprocessor.js";

const BASE_URL = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
const readinessCache = new Map();
const CHAT_ENDPOINT = new URL("/api/chat", BASE_URL).toString();
const TAGS_ENDPOINT = new URL("/api/tags", BASE_URL).toString();
const SHOW_ENDPOINT = new URL("/api/show", BASE_URL).toString();
const KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "2h";
// Check for an environment override. When undefined we generate a JSON schema
// dynamically for each request. Set the variable to "" to omit the parameter
// entirely.
const OLLAMA_FORMAT_OVERRIDE = parseFormatEnv("PHOTO_SELECT_OLLAMA_FORMAT");
// Default to a long response (~32k tokens) matching the output limit of many
// OpenAI models.
function parseInteger(value) {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

const parsedNumPredict = parseInteger(
  process.env.PHOTO_SELECT_OLLAMA_NUM_PREDICT
);
const OLLAMA_NUM_PREDICT = Number.isFinite(parsedNumPredict)
  ? parsedNumPredict
  : MAX_RESPONSE_TOKENS;
const parsedNumCtx = parseInteger(
  process.env.PHOTO_SELECT_OLLAMA_NUM_CTX ?? process.env.OLLAMA_NUM_CTX
);
const OLLAMA_NUM_CTX = Number.isFinite(parsedNumCtx) ? parsedNumCtx : 32_768;
const parsedNumKeep = parseInteger(
  process.env.PHOTO_SELECT_OLLAMA_NUM_KEEP ?? process.env.OLLAMA_NUM_KEEP
);
const OLLAMA_NUM_KEEP = Number.isFinite(parsedNumKeep) ? parsedNumKeep : -1;
const DEFAULT_HTTP_TIMEOUT_MS = 600_000;

function resolveOllamaTimeoutMs() {
  const candidates = [
    process.env.OLLAMA_HTTP_TIMEOUT,
    process.env.PHOTO_SELECT_TIMEOUT_MS,
  ];
  for (const raw of candidates) {
    if (raw === undefined) continue;
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return DEFAULT_HTTP_TIMEOUT_MS;
}

function formatError(err) {
  if (!err) return "unknown error";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  if (err.cause) return formatError(err.cause);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function createConnectionHelpMessage(err) {
  const hints = [
    "Install Ollama from https://ollama.com/download if it is not already present.",
    "Start the Ollama service with `ollama serve` or by launching the desktop app.",
    "If the service runs on another machine, pass `--ollama-base-url http://host:11434` when invoking photo-select.",
  ];
  const parts = [
    `Unable to reach Ollama at ${BASE_URL}.`,
    err?.message ? `Original error: ${err.message}` : null,
    "Steps to fix:",
    ...hints.map((line) => `  • ${line}`),
  ].filter(Boolean);
  const error = new Error(parts.join("\n"));
  error.cause = err;
  return error;
}

function createMissingModelMessage(model) {
  return [
    `Model "${model}" is not available on the Ollama host (${BASE_URL}).`,
    `Download it by running:`,
    `  ollama pull ${model}`,
  ].join("\n");
}

async function ensureModelReady(model) {
  const cacheKey = `${BASE_URL}::${model}`;
  if (!readinessCache.has(cacheKey)) {
    const readiness = (async () => {
      try {
        const res = await fetch(TAGS_ENDPOINT, {
          signal: AbortSignal.timeout?.(30_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // Drain body to surface fetch errors; content unused.
        await res.arrayBuffer();
      } catch (err) {
        throw createConnectionHelpMessage(err);
      }

      try {
        if (typeof model !== "string" || !model.trim()) {
          throw new Error("An Ollama model name must be provided");
        }
        const res = await fetch(SHOW_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: model }),
        });
        if (res.status === 404) {
          throw new Error(createMissingModelMessage(model));
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        await res.arrayBuffer();
      } catch (err) {
        throw err;
      }
    })();

    readinessCache.set(cacheKey, readiness);
  }

  try {
    await readinessCache.get(cacheKey);
  } catch (err) {
    readinessCache.delete(cacheKey);
    throw err;
  }
}

async function encodeMessageImages(messages) {
  if (!Array.isArray(messages)) return messages;
  const results = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") {
      results.push(message);
      continue;
    }
    const next = { ...message };
    if (Array.isArray(message.images) && message.images.length) {
      const encoded = [];
      for (const file of message.images) {
        if (!file) continue;
        try {
          const buffer = await getSurrogateImage(path.resolve(file));
          encoded.push(buffer.toString("base64"));
        } catch (err) {
          const msg = err?.message || err;
          console.warn(`⚠️  Failed to encode image ${file}: ${msg}`);
        }
      }
      if (encoded.length) {
        next.images = encoded;
      } else {
        delete next.images;
      }
    }
    results.push(next);
  }
  return results;
}

async function postChatRequest(params, timeoutMs) {
  const controller = new AbortController();
  let timer;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
  }

  try {
    const res = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: controller.signal,
    });

    if (!res.ok) {
      let detail = "";
      try {
        detail = await res.text();
      } catch {}
      const err = new Error(
        `Ollama chat failed with HTTP ${res.status}${
          detail ? `: ${detail}` : ""
        }`
      );
      err.status = res.status;
      throw err;
    }

    const raw = await res.text();
    if (!raw) return "";
    try {
      const json = JSON.parse(raw);
      if (json?.message?.content) return json.message.content;
      if (typeof json?.response === "string") return json.response;
      if (typeof json?.content === "string") return json.content;
      return "";
    } catch (err) {
      const parseError = new Error("Failed to parse Ollama response as JSON");
      parseError.cause = err;
      parseError.responseText = raw;
      throw parseError;
    }
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutError = new Error(
        `Ollama request exceeded ${timeoutMs}ms without completing. Increase OLLAMA_HTTP_TIMEOUT or PHOTO_SELECT_TIMEOUT_MS.`
      );
      timeoutError.cause = err;
      throw timeoutError;
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export default class OllamaProvider {
  async chat({
    prompt,
    images,
    model,
    curators = [],
    maxRetries = 3,
    onProgress = () => {},
    savePayload,
    expectFieldNotesInstructions = false,
    expectFieldNotesMd = false,
    minutesMin,
    minutesMax,
    options: requestOptions = {},
  } = {}) {
    await ensureModelReady(model);

    const totalImages = Array.isArray(images) ? images.length : 0;
    let attempt = 0;
    while (true) {
      const httpTimeoutMs = resolveOllamaTimeoutMs();
      try {
        onProgress("encoding");
        const { messages } = await buildMessages(prompt, images, curators);
        const [system, user] = messages;
        const injectedText = system.content.trim();
        const textParts = [];
        const imagePaths = [];
        if (injectedText) textParts.push(injectedText);
        if (Array.isArray(user.content)) {
          let idx = 0;
          for (const part of user.content) {
            if (part.type === "text") textParts.push(part.text);
            if (part.type === "image_url") {
              const file = images[idx++];
              if (file) imagePaths.push(file);
            }
          }
        } else {
          textParts.push(String(user.content));
        }
        user.content = textParts.join("\n");
        if (imagePaths.length) user.images = imagePaths;
        const finalMessages = [system, user];
        const encodedMessages = await encodeMessageImages(finalMessages);
        onProgress("request");

        const baseOptions = {
          num_predict: OLLAMA_NUM_PREDICT,
          num_ctx: OLLAMA_NUM_CTX,
          num_keep: OLLAMA_NUM_KEEP,
        };
        const filteredOverrides = Object.fromEntries(
          Object.entries(requestOptions || {}).filter(([, value]) => value !== undefined)
        );
        const params = {
          model,
          messages: encodedMessages,
          stream: false,
          keep_alive: KEEP_ALIVE,
          options: { ...baseOptions, ...filteredOverrides },
        };

        // Build the request format. If an environment override is not provided
        // generate a structured-output schema matching the expected reply
        // shape. Legacy "json" mode remains available but is unreliable with
        // images.
        let format = OLLAMA_FORMAT_OVERRIDE;
        if (format === undefined) {
          format = buildReplySchema({
            instructions: expectFieldNotesInstructions,
            fullNotes: expectFieldNotesMd,
            minutesMin,
            minutesMax,
            images: (images || []).map((f) => path.basename(f)),
          });
        }
        if (format !== null) {
          const isPlainJson = format === "json";
          if (!(isPlainJson && imagePaths.length > 0)) {
            params.format = format;
          }
        }

        if (typeof savePayload === "function") {
          await savePayload(JSON.parse(JSON.stringify(params)));
        }

        const content = await postChatRequest(params, httpTimeoutMs);
        if (!content) {
          throw new Error("empty response");
        }
        onProgress("done");
        return content;
      } catch (err) {
        if (process.env.PHOTO_SELECT_VERBOSE) {
          console.error("ollama fetch failure:", err);
        }
        if (attempt >= maxRetries) throw err;
        attempt += 1;
        const wait = 2 ** attempt * 1000;
        const hint = [
          `url=${BASE_URL}`,
          `model=${model}`,
          `images=${totalImages}`,
          `timeout_ms=${httpTimeoutMs}`,
          `attempt=${attempt}`,
          `node=${process.version}`,
          `keep_alive=${KEEP_ALIVE}`,
        ].join(" ");
        console.warn(
          `ollama error (${formatError(err)}). ${hint}. Retrying in ${wait}ms…`
        );
        await delay(wait);
      }
    }
  }
}
