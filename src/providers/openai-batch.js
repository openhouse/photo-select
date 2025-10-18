import { OpenAI } from 'openai';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildInput, buildMessages, schemaForBatch } from '../chatClient.js';
import { buildReplySchema } from '../replySchema.js';
import { computeMaxOutputTokens } from '../tokenEstimate.js';
import { delay } from '../config.js';

const DEFAULT_COMPLETION_WINDOW = process.env.PHOTO_SELECT_BATCH_COMPLETION_WINDOW || '24h';
const DEFAULT_POLL_MS = Number(process.env.PHOTO_SELECT_BATCH_CHECK_INTERVAL_MS || 60000);
const DEFAULT_ENDPOINT = '/v1/responses';
const FALLBACK_ENDPOINT = '/v1/chat/completions';

const TERMINAL_FAILURE = new Set(['failed', 'expired', 'canceled']);

function safeId(customId) {
  return customId.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function levelKey(levelDir) {
  const rel = path.relative(process.cwd(), levelDir);
  return rel && !rel.startsWith('..') ? rel || path.basename(levelDir) : path.resolve(levelDir);
}

async function ensureDirs(levelDir) {
  const base = path.join(levelDir, '.batch');
  const dirs = {
    base,
    inputs: path.join(base, 'inputs'),
    results: path.join(base, 'results'),
    tickets: path.join(base, 'tickets'),
    status: path.join(base, 'status'),
  };
  await Promise.all(
    Object.values(dirs).map((dir) => mkdir(dir, { recursive: true }))
  );
  return dirs;
}

async function appendLedger(baseDir, entry) {
  const file = path.join(baseDir, 'jobs.ndjson');
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  await appendFile(file, line + '\n');
}

function computeCustomId({ levelDir, prompt, model, curators = [], used = [], minutesMin, minutesMax, reasoningEffort, verbosity }) {
  const hash = crypto.createHash('sha256');
  hash.update(levelKey(levelDir));
  hash.update(model || '');
  hash.update(prompt || '');
  if (curators.length) hash.update(curators.join(','));
  if (reasoningEffort) hash.update(reasoningEffort);
  if (verbosity) hash.update(String(verbosity));
  hash.update(String(minutesMin ?? ''));
  hash.update(String(minutesMax ?? ''));
  for (const file of used) {
    hash.update(path.basename(file));
  }
  const digest = hash.digest('hex');
  return `ps:${levelKey(levelDir)}|sha256:${digest}`;
}

function extractStructured(payload) {
  if (!payload) return { text: '', json: null };
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return extractStructured(parsed);
    } catch {
      return { text: payload, json: null };
    }
  }
  if (Array.isArray(payload.output)) {
    const message = payload.output.find((item) => item.type === 'message');
    if (message && Array.isArray(message.content)) {
      const jsonPart = message.content.find((c) => c.type === 'output_json' && c.json);
      if (jsonPart?.json) {
        return { text: JSON.stringify(jsonPart.json), json: jsonPart.json };
      }
      const textPart = message.content.find((c) => c.type === 'output_text' && c.text);
      if (textPart?.text) {
        return { text: textPart.text, json: null };
      }
    }
  }
  if (payload.output_text) {
    return { text: payload.output_text, json: null };
  }
  if (payload.data?.length) {
    try {
      const nested = JSON.parse(payload.data[0]);
      return extractStructured(nested);
    } catch {}
  }
  return { text: JSON.stringify(payload), json: null };
}

async function streamToText(resp) {
  if (typeof resp.text === 'function') {
    return resp.text();
  }
  if (typeof resp.arrayBuffer === 'function') {
    const buf = Buffer.from(await resp.arrayBuffer());
    return buf.toString('utf8');
  }
  if (resp.body && typeof resp.body === 'object' && typeof resp.body.getReader === 'function') {
    const reader = resp.body.getReader();
    const chunks = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  throw new Error('Unsupported response stream from files.content');
}

export default class OpenAIBatchProvider {
  name = 'openai-batch';
  supportsAsync = true;

  constructor({
    client,
    pollIntervalMs = DEFAULT_POLL_MS,
    completionWindow = DEFAULT_COMPLETION_WINDOW,
    enableFallback = true,
    helpers = {},
  } = {}) {
    this.client = client || new OpenAI();
    this.pollIntervalMs = pollIntervalMs;
    this.completionWindow = completionWindow;
    this.enableFallback = enableFallback;
    this.helpers = {
      buildInput,
      buildMessages,
      schemaForBatch,
      buildReplySchema,
      ...helpers,
    };
  }

  async submit(options = {}) {
    const {
      levelDir,
      prompt,
      images = [],
      curators = [],
      model = 'gpt-5',
      minutesMin = 3,
      minutesMax = 12,
      reasoningEffort,
      verbosity = 'low',
    } = options;
    if (!levelDir) throw new Error('levelDir is required for openai-batch provider');
    const dirs = await ensureDirs(levelDir);
    const responsesRequest = await this.#buildResponsesRequest({
      prompt,
      images,
      curators,
      model,
      minutesMin,
      minutesMax,
      reasoningEffort,
      verbosity,
    });
    const customId = computeCustomId({
      levelDir,
      prompt,
      model,
      curators,
      used: responsesRequest.used,
      minutesMin,
      minutesMax,
      reasoningEffort,
      verbosity,
    });
    const safe = safeId(customId);

    const attempts = [
      { endpoint: DEFAULT_ENDPOINT, request: responsesRequest },
    ];
    if (this.enableFallback) {
      attempts.push({ endpoint: FALLBACK_ENDPOINT, request: null });
    }

    let batch;
    let lastErr;
    let inputFile;
    let endpointUsed = DEFAULT_ENDPOINT;
    for (const attempt of attempts) {
      const endpoint = attempt.endpoint;
      const request = attempt.request ||
        (await this.#buildChatCompletionsRequest({
          prompt,
          images,
          curators,
          model,
          minutesMin,
          minutesMax,
          verbosity,
        }, responsesRequest.used));
      const jsonlLine = {
        custom_id: customId,
        method: 'POST',
        url: endpoint,
        body: request.body,
      };
      const jsonlPath = path.join(dirs.inputs, `${safe}.jsonl`);
      await writeFile(jsonlPath, JSON.stringify(jsonlLine) + '\n', 'utf8');
      try {
        inputFile = await this.client.files.create({
          file: createReadStream(jsonlPath),
          purpose: 'batch',
        });
        batch = await this.client.batches.create({
          input_file_id: inputFile.id,
          endpoint,
          completion_window: this.completionWindow,
        });
        endpointUsed = endpoint;
        break;
      } catch (err) {
        lastErr = err;
        await appendLedger(dirs.base, {
          custom_id: customId,
          event: 'submit_error',
          endpoint,
          message: err?.message,
        });
        if (!this.enableFallback || endpoint === FALLBACK_ENDPOINT) {
          throw err;
        }
      }
    }

    if (!batch) {
      throw lastErr || new Error('Failed to create batch job');
    }

    const ticketPath = path.join(dirs.tickets, `${safe}.ticket.json`);
    const submittedAt = new Date().toISOString();
    const ticket = {
      custom_id: customId,
      batch_id: batch.id,
      model,
      endpoint: endpointUsed,
      status: batch.status,
      input_file_id: inputFile.id,
      submitted_at: submittedAt,
      completion_window: this.completionWindow,
      used_images: responsesRequest.used.map((file) => path.basename(file)),
    };
    await writeFile(ticketPath, JSON.stringify(ticket, null, 2));
    await appendLedger(dirs.base, {
      custom_id: customId,
      event: 'submitted',
      batch_id: batch.id,
      endpoint: endpointUsed,
      status: batch.status,
    });

    const statusPath = path.join(dirs.status, `${safe}.status.json`);
    await writeFile(statusPath, JSON.stringify(batch, null, 2));

    return {
      provider: this.name,
      customId,
      batchId: batch.id,
      levelDir,
      model,
      ticketPath,
      statusPath,
      safeId: safe,
      used: responsesRequest.used,
      endpoint: endpointUsed,
    };
  }

  async collect(handle) {
    let lastStatus = null;
    const dirs = await ensureDirs(handle.levelDir);
    const ticketPath = path.join(dirs.tickets, `${handle.safeId}.ticket.json`);
    const statusPath = path.join(dirs.status, `${handle.safeId}.status.json`);
    while (true) {
      const job = await this.client.batches.retrieve(handle.batchId);
      if (job.status !== lastStatus) {
        lastStatus = job.status;
        await appendLedger(dirs.base, {
          custom_id: handle.customId,
          event: 'status',
          batch_id: handle.batchId,
          status: job.status,
        });
      }
      await writeFile(statusPath, JSON.stringify(job, null, 2));
      await this.#updateTicket(ticketPath, {
        status: job.status,
        output_file_id: job.output_file_id ?? undefined,
        error_file_id: job.error_file_id ?? undefined,
      });
      if (job.status === 'completed') {
        if (!job.output_file_id) {
          throw new Error(`Batch ${handle.batchId} completed without output`);
        }
        const resp = await this.client.files.content(job.output_file_id);
        const text = await streamToText(resp);
        const resultsPath = path.join(dirs.results, `${handle.batchId}.jsonl`);
        await writeFile(resultsPath, text, 'utf8');
        const parsed = this.#parseOutput(text, handle.customId);
        await this.#updateTicket(ticketPath, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          output_file_id: job.output_file_id,
        });
        return {
          raw: parsed.text,
          json: parsed.json,
          usage: parsed.usage,
        };
      }
      if (TERMINAL_FAILURE.has(job.status)) {
        await this.#updateTicket(ticketPath, {
          status: job.status,
          error_file_id: job.error_file_id ?? undefined,
        });
        const err = new Error(`Batch ${handle.batchId} ${job.status}`);
        err.status = job.status;
        throw err;
      }
      await delay(this.pollIntervalMs);
    }
  }

  async cancel(handle) {
    try {
      await this.client.batches.cancel(handle.batchId);
      const dirs = await ensureDirs(handle.levelDir);
      const ticketPath = path.join(dirs.tickets, `${handle.safeId}.ticket.json`);
      await this.#updateTicket(ticketPath, {
        status: 'canceled',
        canceled_at: new Date().toISOString(),
      });
      await appendLedger(path.join(handle.levelDir, '.batch'), {
        custom_id: handle.customId,
        event: 'canceled',
        batch_id: handle.batchId,
      });
    } catch (err) {
      if (process.env.PHOTO_SELECT_VERBOSE === '1') {
        console.warn('Batch cancel failed:', err);
      }
    }
  }

  async #buildResponsesRequest({ prompt, images, curators, model, minutesMin, minutesMax, reasoningEffort, verbosity }) {
    const { instructions, input, used } = await this.helpers.buildInput(
      prompt,
      images,
      curators
    );
    const schema = this.helpers.schemaForBatch(used, curators, {
      minutesMin,
      minutesMax,
    });
    const effort = reasoningEffort && reasoningEffort !== 'auto' ? reasoningEffort : '';
    const max_output_tokens = computeMaxOutputTokens({
      decisionsCount: used.length,
      minutesCount: minutesMax,
      effort: effort || 'low',
    });
    const body = {
      model,
      instructions,
      input,
      text: {
        verbosity,
        format: {
          type: 'json_schema',
          name: schema.name,
          schema: schema.schema,
          strict: true,
        },
      },
      max_output_tokens,
    };
    if (effort) {
      body.reasoning = { effort };
    }
    return { body, used };
  }

  async #buildChatCompletionsRequest({ prompt, images, curators, model, minutesMin, minutesMax, verbosity }, used) {
    const { messages } = await this.helpers.buildMessages(
      prompt,
      images,
      curators
    );
    const schema = this.helpers.buildReplySchema({
      minutesMin,
      minutesMax,
      images: used.map((file) => path.basename(file)),
    });
    const max_tokens = computeMaxOutputTokens({
      decisionsCount: used.length,
      minutesCount: minutesMax,
      effort: 'low',
    });
    const body = {
      model,
      messages,
      response_format: { type: 'json_schema', json_schema: schema },
      max_tokens,
      temperature: 0.7,
    };
    if (verbosity) {
      body.metadata = { verbosity };
    }
    return { body, used };
  }

  async #updateTicket(ticketPath, updates) {
    let current = {};
    try {
      const raw = await readFile(ticketPath, 'utf8');
      current = JSON.parse(raw);
    } catch {
      // ignore
    }
    const next = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    await writeFile(ticketPath, JSON.stringify(next, null, 2));
  }

  #parseOutput(text, customId) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (err) {
        throw new Error(`Invalid JSONL in batch output: ${err.message}`);
      }
      if (obj.custom_id !== customId) continue;
      if (obj.error) {
        const err = new Error(obj.error?.message || 'Batch item error');
        err.cause = obj.error;
        throw err;
      }
      const response = obj.response || {};
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      const { text, json } = extractStructured(body);
      return { text, json, usage: response.usage || body?.usage };
    }
    throw new Error(`No output found for custom_id ${customId}`);
  }
}
