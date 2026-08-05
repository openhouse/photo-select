import OpenAI from 'openai';
import dotenv from 'dotenv';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

dotenv.config(process.env.PHOTO_SELECT_ENV_FILE
  ? { path: process.env.PHOTO_SELECT_ENV_FILE }
  : undefined);
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required (or set PHOTO_SELECT_ENV_FILE)');
}
const { default: OpenAIBatchProvider } = await import(
  '../src/providers/openai-batch.js'
);

const model = process.env.PHOTO_SELECT_CACHE_EVAL_MODEL || 'gpt-5.6-terra';
const count = Math.min(15, Math.max(
  2,
  Number(process.env.PHOTO_SELECT_CACHE_EVAL_REQUESTS || 6)
));
const pollMs = Math.max(
  1000,
  Number(process.env.PHOTO_SELECT_CACHE_EVAL_POLL_MS || 5000)
);
const timeoutMs = Math.max(
  60_000,
  Number(process.env.PHOTO_SELECT_CACHE_EVAL_TIMEOUT_MS || 30 * 60_000)
);
const aggregationMs = Math.max(
  1,
  Number(process.env.PHOTO_SELECT_CACHE_EVAL_AGGREGATION_MS || 50)
);
const staggerMs = Math.max(
  aggregationMs + 1,
  Number(process.env.PHOTO_SELECT_CACHE_EVAL_STAGGER_MS || 150)
);
const prefix = (
  'Photo-select provider Batch prompt-cache evaluation, version 2. ' +
  'This synthetic context contains no image or archive data. ' +
  'Preserve it exactly as the stable developer prefix. '
).repeat(200) + ` Run ${Date.now()}.`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const helpers = {
  async buildInput(prompt) {
    const index = Number(prompt.match(/Synthetic request (\d+)/)?.[1] || 1);
    await wait((index - 1) * staggerMs);
    return {
      instructions: prompt,
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: 'Return a JSON object whose ok property is the string OK.',
        }],
      }],
      used: [],
    };
  },
  schemaForBatch() {
    return {
      name: 'PhotoSelectCacheEvalV2',
      schema: {
        type: 'object',
        properties: { ok: { type: 'string', enum: ['OK'] } },
        required: ['ok'],
        additionalProperties: false,
      },
    };
  },
};

function usageFromRow(row) {
  const responseBody = typeof row.response?.body === 'string'
    ? JSON.parse(row.response.body)
    : row.response?.body;
  const usage = row.response?.usage || responseBody?.usage || {};
  const details = usage.input_tokens_details || {};
  return {
    custom_id: row.custom_id,
    status_code: row.response?.status_code,
    input_tokens: usage.input_tokens || 0,
    cached_tokens: details.cached_tokens || 0,
    cache_write_tokens: details.cache_write_tokens || 0,
    output_tokens: usage.output_tokens || 0,
  };
}

async function settleBatch(client, batchId) {
  const deadline = Date.now() + timeoutMs;
  let batch = await client.batches.retrieve(batchId);
  while (!['completed', 'failed', 'expired', 'canceled'].includes(batch.status)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${batch.id}`);
    await wait(pollMs);
    batch = await client.batches.retrieve(batch.id);
  }
  if (batch.status !== 'completed' || !batch.output_file_id) {
    throw new Error(`Batch ${batch.id} ended with status ${batch.status}`);
  }
  const text = await (await client.files.content(batch.output_file_id)).text();
  return {
    batch,
    usages: text.split(/\r?\n/).filter(Boolean).map((line) =>
      usageFromRow(JSON.parse(line))
    ),
  };
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'photo-select-cache-eval-'));
const remoteFileIds = new Set();
try {
  const provider = new OpenAIBatchProvider({
    client,
    enableFallback: false,
    pollIntervalMs: pollMs,
    aggregationWindowMs: aggregationMs,
    helpers,
  });
  const handles = await Promise.all(Array.from({ length: count }, (_, i) =>
    provider.submit({
      levelDir: tempDir,
      prompt: `${prefix} Synthetic request ${i + 1}.`,
      promptCachePrefix: prefix,
      images: [],
      model,
      reasoningEffort: 'low',
      verbosity: 'low',
      minutesMin: 0,
      minutesMax: 0,
    })
  ));

  const inputDir = path.join(tempDir, '.batch', 'inputs');
  const inputFiles = await readdir(inputDir);
  const inputRowCounts = await Promise.all(inputFiles.map(async (file) =>
    (await readFile(path.join(inputDir, file), 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .length
  ));
  const batchIds = [...new Set(handles.map((handle) => handle.batchId))];
  const settled = await Promise.all(batchIds.map((batchId) =>
    settleBatch(client, batchId)
  ));
  for (const { batch } of settled) {
    if (batch.input_file_id) remoteFileIds.add(batch.input_file_id);
    if (batch.output_file_id) remoteFileIds.add(batch.output_file_id);
    if (batch.error_file_id) remoteFileIds.add(batch.error_file_id);
  }
  const usages = settled.flatMap((entry) => entry.usages);
  const totals = usages.reduce((sum, usage) => {
    for (const key of [
      'input_tokens',
      'cached_tokens',
      'cache_write_tokens',
      'output_tokens',
    ]) {
      sum[key] += usage[key];
    }
    sum.cache_hit_requests += Number(usage.cached_tokens > 0);
    sum.cache_write_requests += Number(usage.cache_write_tokens > 0);
    return sum;
  }, {
    input_tokens: 0,
    cached_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 0,
    cache_hit_requests: 0,
    cache_write_requests: 0,
  });
  const topologyPassed = inputFiles.length === 1 &&
    inputRowCounts.length === 1 && inputRowCounts[0] === count &&
    batchIds.length === 1;
  const cachePassed = usages.length === count &&
    usages.every((usage) => usage.status_code === 200) &&
    totals.cache_write_requests === 1 &&
    totals.cache_hit_requests === count - 1 &&
    totals.cached_tokens > totals.cache_write_tokens;
  const passed = topologyPassed && cachePassed;
  console.log(JSON.stringify({
    eval: 'provider_staggered_grouped_batch_explicit_prompt_cache',
    model,
    request_count: count,
    aggregation_ms: aggregationMs,
    preparation_stagger_ms: staggerMs,
    batch_count: batchIds.length,
    input_file_count: inputFiles.length,
    input_row_counts: inputRowCounts,
    topology_passed: topologyPassed,
    cache_passed: cachePassed,
    passed,
    totals,
    cache_hit_rate: totals.cache_hit_requests / count,
    usages,
  }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await Promise.all([...remoteFileIds].map((id) =>
    client.files.del(id).catch(() => undefined)
  ));
  await rm(tempDir, { recursive: true, force: true });
}
