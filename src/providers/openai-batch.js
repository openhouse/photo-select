import { OpenAI } from 'openai';
import { mkdir, writeFile, appendFile, readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildInput, buildMessages, schemaForBatch } from '../chatClient.js';
import { buildReplySchema } from '../replySchema.js';
import { computeMaxOutputTokens, computeOutputBudget, estimateInputTokens, outputBudgetMetadata } from '../tokenEstimate.js';
import { delay } from '../config.js';
import { debugBatch } from '../../scripts/debug-batch.mjs';

const DEFAULT_COMPLETION_WINDOW = process.env.PHOTO_SELECT_BATCH_COMPLETION_WINDOW || '24h';
const DEFAULT_POLL_MS = Number(process.env.PHOTO_SELECT_BATCH_CHECK_INTERVAL_MS || 60000);
const DEFAULT_ENDPOINT = '/v1/responses';
const FALLBACK_ENDPOINT = '/v1/chat/completions';

const TERMINAL_FAILURE = new Set(['failed', 'expired', 'canceled']);
const ALLOWED_REASONING_EFFORT = new Set(['auto', 'minimal', 'low', 'medium', 'high', 'xhigh']);

const MAX_SAFE_ID_LENGTH = 200;

function safeId(customId) {
  const sanitized = customId.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (sanitized.length <= MAX_SAFE_ID_LENGTH) {
    return sanitized;
  }
  const digest = crypto.createHash('sha256').update(sanitized).digest('hex');
  const suffix = `_${digest.slice(0, 16)}`;
  const sliceLength = Math.max(1, MAX_SAFE_ID_LENGTH - suffix.length);
  const base = sanitized.slice(0, sliceLength);
  const trimmed = base.replace(/[_-]+$/g, '');
  const prefix = trimmed || base;
  return `${prefix}${suffix}`;
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

function computeCustomId({ levelDir, prompt, model, curators = [], used = [], minutesMin, minutesMax, reasoningEffort, verbosity, budgetAttempt = 1, maxOutputTokens = 0 }) {
  const hash = crypto.createHash('sha256');
  hash.update(levelKey(levelDir));
  hash.update(model || '');
  hash.update(prompt || '');
  if (curators.length) hash.update(curators.join(','));
  if (reasoningEffort) hash.update(reasoningEffort);
  if (verbosity) hash.update(String(verbosity));
  hash.update(String(budgetAttempt ?? 1));
  hash.update(String(maxOutputTokens ?? 0));
  hash.update(String(minutesMin ?? ''));
  hash.update(String(minutesMax ?? ''));
  for (const file of used) {
    hash.update(path.basename(file));
  }
  const digest = hash.digest('hex');
  return `ps:${levelKey(levelDir)}|sha256:${digest}`;
}

export function isResponsesEnvelope(payload) {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      (payload.object === 'response' ||
        (typeof payload.id === 'string' && payload.id.startsWith('resp_')) ||
        Object.hasOwn(payload, 'status') ||
        Object.hasOwn(payload, 'incomplete_details') ||
        Object.hasOwn(payload, 'error') ||
        payload.text?.format?.schema)
  );
}

function enrichResponseError(err, payload, { customId } = {}) {
  err.response_id = payload?.id;
  err.model = payload?.model;
  err.status = payload?.status;
  err.incomplete_details = payload?.incomplete_details;
  err.usage = payload?.usage;
  err.output_tokens = payload?.usage?.output_tokens;
  err.reasoning_tokens = payload?.usage?.output_tokens_details?.reasoning_tokens;
  err.max_output_tokens = payload?.max_output_tokens;
  err.custom_id = customId;
  err.response = payload;
  return err;
}

export function assertCompletedResponse(body, { customId } = {}) {
  if (isResponsesEnvelope(body) && (body.status !== 'completed' || body.incomplete_details || body.error)) {
    const reason = body.incomplete_details?.reason || body.error?.message || body.status || 'unknown';
    const err = new Error(
      `OpenAI response incomplete for ${customId || 'batch item'}: ${reason}`
    );
    err.code = 'OPENAI_RESPONSE_INCOMPLETE';
    err.reason = reason;
    throw enrichResponseError(err, body, { customId });
  }
}

export function extractStructured(payload, options = {}) {
  if (!payload) {
    const err = new Error('Empty provider payload');
    err.code = 'EMPTY_PROVIDER_PAYLOAD';
    throw err;
  }
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return extractStructured(parsed, options);
    } catch (err) {
      if (err?.code) throw err;
      return { text: payload, json: null };
    }
  }

  if (isResponsesEnvelope(payload)) {
    assertCompletedResponse(payload, options);
  }

  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return { text: payload.output_text, json: null };
  }

  if (Array.isArray(payload.output)) {
    const message = payload.output.find((item) => item.type === 'message');
    if (message && Array.isArray(message.content)) {
      const jsonPart = message.content.find((c) => c.type === 'output_json' && c.json);
      if (jsonPart?.json) {
        return { text: JSON.stringify(jsonPart.json), json: jsonPart.json };
      }
      const textPart = message.content.find((c) => c.type === 'output_text' && c.text?.trim());
      if (textPart?.text) {
        return { text: textPart.text, json: null };
      }
    }
  }

  if (payload.data?.length) {
    try {
      const nested = JSON.parse(payload.data[0]);
      return extractStructured(nested, options);
    } catch (err) {
      if (err?.code) throw err;
    }
  }

  const err = new Error(
    isResponsesEnvelope(payload)
      ? `Completed OpenAI response had no assistant output: ${payload.id || 'unknown response'}`
      : 'Provider payload has no extractable assistant output'
  );
  err.code = isResponsesEnvelope(payload) ? 'OPENAI_RESPONSE_NO_OUTPUT' : 'NO_EXTRACTABLE_ASSISTANT_OUTPUT';
  throw enrichResponseError(err, payload, options);
}

function inferMissingScope(err) {
  const msg = String(
    err?.error?.message ||
    err?.message ||
    err?.response?.data?.error?.message ||
    ''
  );
  const match = msg.match(/api\.[a-z]+\.[a-z]+/i);
  return match ? match[0] : null;
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
      budgetAttempt = 1,
      previousIncomplete = null,
      baseCuratorCount = curators.length,
      dynamicCuratorCount = Math.max(0, curators.length - baseCuratorCount),
    } = options;
    if (!levelDir) throw new Error('levelDir is required for openai-batch provider');
    if (reasoningEffort && !ALLOWED_REASONING_EFFORT.has(reasoningEffort)) {
      throw new Error(`invalid reasoningEffort: ${reasoningEffort}`);
    }
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
      budgetAttempt,
      baseCuratorCount,
      dynamicCuratorCount,
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
      budgetAttempt,
      maxOutputTokens: responsesRequest.budget?.maxOutputTokens || responsesRequest.body?.max_output_tokens,
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
          metadata: {
            custom_id: customId,
            model,
            level: levelKey(levelDir),
            budget_attempt: String(budgetAttempt),
            max_output_tokens: String(responsesRequest.budget?.maxOutputTokens || responsesRequest.body?.max_output_tokens || ''),
          },
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
      budgetAttempt,
      previousIncomplete,
      output_budget: responsesRequest.outputBudget,
    };
    await writeFile(ticketPath, JSON.stringify(ticket, null, 2));
    await appendLedger(dirs.base, {
      custom_id: customId,
      event: 'submitted',
      batch_id: batch.id,
      endpoint: endpointUsed,
      status: batch.status,
      budget_attempt: budgetAttempt,
      output_budget: responsesRequest.outputBudget,
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
      requestOptions: { levelDir, prompt, images, curators, model, minutesMin, minutesMax, reasoningEffort, verbosity, baseCuratorCount, dynamicCuratorCount },
      budgetAttempt,
      outputBudget: responsesRequest.outputBudget,
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
          let rootCause;
          if (job.error_file_id) {
            try {
              const errResp = await this.client.files.content(job.error_file_id);
              const errText = await streamToText(errResp);
              const firstError = errText
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line) => {
                  try {
                    return JSON.parse(line);
                  } catch {
                    return null;
                  }
                })
                .find((row) => row?.error || row?.response?.body);
              if (firstError?.error?.message) {
                rootCause = firstError.error.message;
              } else {
                const body = typeof firstError?.response?.body === 'string'
                  ? JSON.parse(firstError.response.body)
                  : firstError?.response?.body;
                if (body?.error?.message) {
                  rootCause = body.error.message;
                }
              }
            } catch (err) {
              const scope = inferMissingScope(err);
              if (scope) {
                console.error(`⚠️  Missing scope ${scope} while reading batch error file ${job.error_file_id}.`);
              }
            }
          }
          console.error(`⚠️  Batch ${handle.batchId} completed without output${rootCause ? `: ${rootCause}` : ''}`);
          try {
            await debugBatch(handle.batchId);
          } catch (diagErr) {
            const scope = inferMissingScope(diagErr);
            if (scope) {
              console.error(`⚠️  Missing scope ${scope}; skipping extended batch diagnostics.`);
            } else {
              console.error('❌ debugBatch helper failed:', diagErr?.message || diagErr);
            }
          }
          throw new Error(
            rootCause
              ? `Batch ${handle.batchId} completed without output: ${rootCause}`
              : `Batch ${handle.batchId} completed without output`
          );
        }
        const resp = await this.client.files.content(job.output_file_id);
        const text = await streamToText(resp);
        const resultsPath = path.join(dirs.results, `${handle.batchId}.jsonl`);
        await writeFile(resultsPath, text, 'utf8');
        let parsed;
        try {
          parsed = this.#parseOutput(text, handle.customId);
        } catch (err) {
          await this.#recordTokenUsage(handle, err, { status: err.status || 'error', incompleteReason: err.reason });
          if (this.#shouldRetryIncomplete(err, handle)) {
            const retryHandle = await this.#resubmitForOutputBudget(handle, err);
            return this.collect(retryHandle);
          }
          throw err;
        }
        await this.#recordTokenUsage(handle, { usage: parsed.usage }, { status: 'completed' });
        await this.#updateTicket(ticketPath, {
          status: 'completed',
          completed_at: new Date().toISOString(),
          output_file_id: job.output_file_id,
          usage: parsed.usage,
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

  async #buildResponsesRequest({ prompt, images, curators, model, minutesMin, minutesMax, reasoningEffort, verbosity, budgetAttempt = 1, baseCuratorCount = curators.length, dynamicCuratorCount = Math.max(0, curators.length - baseCuratorCount) }) {
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
    const schemaJson = JSON.stringify(schema?.schema || schema || {}, null, 0);
    const estimatedInputTokens = estimateInputTokens({
      instructions,
      schemaJson,
      imageCount: used.length,
      imageDetail: 'high',
      extraText: '',
    });
    const budget = computeOutputBudget({
      model,
      reasoningEffort: effort || 'low',
      verbosity,
      minutesMin,
      minutesMax,
      decisionsCount: used.length,
      imageCount: used.length,
      curatorCount: curators.length,
      baseCuratorCount,
      dynamicCuratorCount,
      estimatedInputTokens,
      promptChars: instructions.length,
      schemaChars: schemaJson.length,
      attempt: budgetAttempt,
    });
    const max_output_tokens = budget.maxOutputTokens;
    const outputBudget = outputBudgetMetadata(budget);
    if (process.env.PHOTO_SELECT_VERBOSE === '1') {
      for (const warning of budget.warnings || []) console.warn(`⚠️ ${warning}`);
      console.log(
        `🧮 output_budget batch_attempt=${budgetAttempt} model=${model} effort=${effort || 'low'} input≈${estimatedInputTokens} minutes=${minutesMin}..${minutesMax} curators=${baseCuratorCount}+${dynamicCuratorCount} images=${used.length} max_output_tokens=${max_output_tokens}`
      );
    }
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
    return { body, used, budget, outputBudget };
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
    const max_completion_tokens = computeMaxOutputTokens({
      decisionsCount: used.length,
      minutesCount: minutesMax,
      effort: 'low',
    });
    const body = {
      model,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'photo_select_reply',
          schema,
          strict: true,
        },
      },
      max_completion_tokens,
      temperature: 0.7,
    };
    if (verbosity) {
      body.metadata = { verbosity };
    }
    return { body, used };
  }


  #maxOutputRetries() {
    const n = Number(process.env.PHOTO_SELECT_MAX_OUTPUT_RETRIES ?? 2);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 2;
  }

  #shouldRetryIncomplete(err, handle) {
    return err?.code === 'OPENAI_RESPONSE_INCOMPLETE' &&
      err?.reason === 'max_output_tokens' &&
      (handle?.budgetAttempt || 1) <= this.#maxOutputRetries();
  }

  async #resubmitForOutputBudget(handle, err) {
    const nextAttempt = (handle.budgetAttempt || 1) + 1;
    const previous = {
      original_custom_id: handle.customId,
      retry_attempt: nextAttempt,
      previous_incomplete_reason: err?.reason,
      previous_reasoning_tokens: err?.reasoning_tokens,
      previous_output_tokens: err?.output_tokens,
      previous_max_output_tokens: handle.outputBudget?.max_output_tokens || err?.max_output_tokens,
    };
    const dirs = await ensureDirs(handle.levelDir);
    await appendLedger(dirs.base, {
      custom_id: handle.customId,
      event: 'retry_max_output_tokens',
      batch_id: handle.batchId,
      next_attempt: nextAttempt,
      previous,
    });
    await this.#updateTicket(handle.ticketPath, {
      status: 'retrying',
      retry: previous,
    });
    return this.submit({
      ...(handle.requestOptions || {}),
      budgetAttempt: nextAttempt,
      previousIncomplete: previous,
    });
  }

  async #recordTokenUsage(handle, source = {}, { status, incompleteReason } = {}) {
    const usage = source?.usage || source?.response?.usage || {};
    const dirs = await ensureDirs(handle.levelDir);
    const record = {
      timestamp: new Date().toISOString(),
      model: handle.model,
      provider: this.name,
      effort: handle.outputBudget?.effort,
      verbosity: handle.outputBudget?.verbosity,
      finalCuratorCount: handle.outputBudget?.curator_count,
      imageCount: handle.outputBudget?.image_count,
      minutesMin: handle.outputBudget?.minutes_min,
      minutesMax: handle.outputBudget?.minutes_max,
      estimatedInputTokens: handle.outputBudget?.estimated_input_tokens,
      input_tokens: usage?.input_tokens,
      output_tokens: usage?.output_tokens || source?.output_tokens,
      reasoning_tokens: usage?.output_tokens_details?.reasoning_tokens || source?.reasoning_tokens,
      max_output_tokens: handle.outputBudget?.max_output_tokens || source?.max_output_tokens,
      status,
      incomplete_reason: incompleteReason,
      custom_id: handle.customId,
      batch_id: handle.batchId,
      budget_attempt: handle.budgetAttempt,
    };
    await appendFile(path.join(dirs.base, 'token-usage.ndjson'), JSON.stringify(record) + '\n');
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
        err.code = 'BATCH_ITEM_ERROR';
        err.cause = obj.error;
        err.custom_id = customId;
        throw err;
      }
      const response = obj.response || {};
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      const { text, json } = extractStructured(body, { customId });
      return { text, json, usage: response.usage || body?.usage };
    }
    throw new Error(`No output found for custom_id ${customId}`);
  }
}
