import { buildMessages, MAX_RESPONSE_TOKENS } from '../chatClient.js';
import { delay } from '../config.js';
import { Ollama } from 'ollama';
import { buildReplySchema } from '../replySchema.js';
import { parseFormatEnv } from '../formatOverride.js';
import path from 'node:path';

const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const client = new Ollama({ host: BASE_URL });
const readinessCache = new Map();
// Check for an environment override. When undefined we generate a JSON schema
// dynamically for each request. Set the variable to "" to omit the parameter
// entirely.
const OLLAMA_FORMAT_OVERRIDE = parseFormatEnv('PHOTO_SELECT_OLLAMA_FORMAT');
// Default to a long response (~32k tokens) matching the output limit of many
// OpenAI models.
const OLLAMA_NUM_PREDICT =
  Number.parseInt(process.env.PHOTO_SELECT_OLLAMA_NUM_PREDICT, 10) ||
  MAX_RESPONSE_TOKENS;
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
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.cause) return formatError(err.cause);
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

async function chatWithTimeout(params, timeoutMs) {
  const request = { ...params, stream: true };
  let streamResponse;
  try {
    streamResponse = await client.chat(request);
  } catch (err) {
    throw err;
  }

  if (!streamResponse || typeof streamResponse[Symbol.asyncIterator] !== 'function') {
    const direct = streamResponse?.message ? streamResponse : await client.chat(params);
    return direct?.message?.content ?? '';
  }

  const stream = streamResponse;
  let timedOut = false;
  let timer;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      if (typeof stream.abort === 'function') {
        try {
          stream.abort();
        } catch {
          // ignore abort errors
        }
      }
    }, timeoutMs);
  }

  try {
    let combined = '';
    let snapshot = '';
    let lastChunk;
    for await (const chunk of stream) {
      if (chunk?.message?.content && typeof chunk.message.content === 'string') {
        const current = chunk.message.content;
        if (snapshot && current.startsWith(snapshot)) {
          combined += current.slice(snapshot.length);
        } else if (!snapshot) {
          combined += current;
        } else {
          combined += current;
        }
        snapshot = current;
      }
      lastChunk = chunk;
    }

    if (!combined && lastChunk?.message?.content && typeof lastChunk.message.content === 'string') {
      combined = lastChunk.message.content;
    }

    return combined;
  } catch (err) {
    if (timedOut) {
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

function createConnectionHelpMessage(err) {
  const hints = [
    'Install Ollama from https://ollama.com/download if it is not already present.',
    'Start the Ollama service with `ollama serve` or by launching the desktop app.',
    'If the service runs on another machine, pass `--ollama-base-url http://host:11434` when invoking photo-select.'
  ];
  const parts = [
    `Unable to reach Ollama at ${BASE_URL}.`,
    err?.message ? `Original error: ${err.message}` : null,
    'Steps to fix:',
    ...hints.map((line) => `  • ${line}`),
  ].filter(Boolean);
  const error = new Error(parts.join('\n'));
  error.cause = err;
  return error;
}

function createMissingModelMessage(model) {
  return [
    `Model "${model}" is not available on the Ollama host (${BASE_URL}).`,
    `Download it by running:`,
    `  ollama pull ${model}`,
  ].join('\n');
}

async function ensureModelReady(model) {
  const cacheKey = `${BASE_URL}::${model}`;
  if (!readinessCache.has(cacheKey)) {
    const readiness = (async () => {
      try {
        await client.list();
      } catch (err) {
        throw createConnectionHelpMessage(err);
      }

      try {
        await client.show({ model });
      } catch (err) {
        if (err?.name === 'ResponseError' && err?.status_code === 404) {
          throw new Error(createMissingModelMessage(model));
        }
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
  } = {}) {
    await ensureModelReady(model);

    const totalImages = Array.isArray(images) ? images.length : 0;
    let attempt = 0;
    while (true) {
      const httpTimeoutMs = resolveOllamaTimeoutMs();
      try {
        onProgress('encoding');
        const { messages } = await buildMessages(prompt, images, curators);
        const [system, user] = messages;
        const injectedText = system.content.trim();
        const textParts = [];
        const imagePaths = [];
        if (injectedText) textParts.push(injectedText);
        if (Array.isArray(user.content)) {
          let idx = 0;
          for (const part of user.content) {
            if (part.type === 'text') textParts.push(part.text);
            if (part.type === 'image_url') {
              const file = images[idx++];
              if (file) imagePaths.push(file);
            }
          }
        } else {
          textParts.push(String(user.content));
        }
        user.content = textParts.join('\n');
        if (imagePaths.length) user.images = imagePaths;
        const finalMessages = [system, user];
        onProgress('request');

        const params = {
          model,
          messages: finalMessages,
          stream: false,
          options: { num_predict: OLLAMA_NUM_PREDICT },
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
          const isPlainJson = format === 'json';
          if (!(isPlainJson && imagePaths.length > 0)) {
            params.format = format;
          }
        }

        if (typeof savePayload === 'function') {
          await savePayload(JSON.parse(JSON.stringify(params)));
        }

        const content = await chatWithTimeout(params, httpTimeoutMs);
        if (!content) {
          throw new Error('empty response');
        }
        onProgress('done');
        return content;
      } catch (err) {
        if (process.env.PHOTO_SELECT_VERBOSE) {
          console.error('ollama fetch failure:', err);
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
        ].join(' ');
        console.warn(`ollama error (${formatError(err)}). ${hint}. Retrying in ${wait}ms…`);
        await delay(wait);
      }
    }
  }
}
