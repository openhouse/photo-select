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
  3,
  Number(process.env.PHOTO_SELECT_CACHE_EVAL_REQUESTS || 4)
));
const targetPrefixChars = Math.max(
  4096,
  Number(process.env.PHOTO_SELECT_CACHE_EVAL_PREFIX_CHARS || 444_466)
);
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
let prefix = `Photo-select Batch cache evaluation pt4, run ${Date.now()}. `;
for (let i = 0; prefix.length < targetPrefixChars; i++) {
  prefix += `Synthetic context line ${String(i).padStart(6, '0')}: ` +
    'amber bridge cedar delta ember field granite harbor iris juniper.\n';
}
prefix = prefix.slice(0, targetPrefixChars);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const helpers = {
  async buildInput(prompt) {
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
  const submissions = await Promise.allSettled(Array.from({ length: count }, (_, i) =>
    provider.submit({
      levelDir: tempDir,
      model,
      prepare: async () => {
        await wait(i * staggerMs);
        return {
          prompt: `${prefix} Synthetic request ${i + 1}.`,
          promptCachePrefix: prefix,
          images: [],
          reasoningEffort: 'low',
          verbosity: 'low',
          minutesMin: 0,
          minutesMax: 0,
        };
      },
    })
  ));
  const handles = submissions
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const submissionErrors = submissions
    .filter((result) => result.status === 'rejected')
    .map((result) => ({
      code: result.reason?.code,
      message: result.reason?.message,
      usage: result.reason?.usage,
    }));

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
  const expectedRowCounts = [1, 1, count - 2].sort((a, b) => a - b);
  const topologyPassed = submissionErrors.length === 0 &&
    inputFiles.length === 3 &&
    inputRowCounts.length === 3 &&
    inputRowCounts.slice().sort((a, b) => a - b).every(
      (rows, index) => rows === expectedRowCounts[index]
    ) &&
    batchIds.length === 3;
  const seedUsage = settled[0]?.usages[0];
  const probeUsage = settled[1]?.usages[0];
  const readerUsages = settled.slice(2).flatMap((entry) => entry.usages);
  const cachePassed = submissionErrors.length === 0 &&
    usages.length === count &&
    usages.every((usage) => usage.status_code === 200) &&
    seedUsage?.cache_write_tokens > 0 &&
    probeUsage?.cached_tokens > 0 &&
    readerUsages.length === count - 2 &&
    readerUsages.every((usage) => usage.cached_tokens > 0) &&
    totals.cache_write_requests === 1 &&
    totals.cache_hit_requests === count - 1 &&
    totals.cached_tokens > totals.cache_write_tokens;
  const passed = topologyPassed && cachePassed;
  console.log(JSON.stringify({
    eval: 'provider_seed_probe_barrier_explicit_prompt_cache_pt4',
    model,
    request_count: count,
    stable_prefix_chars: prefix.length,
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
    submission_errors: submissionErrors,
    usages,
  }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  try {
    const ticketDir = path.join(tempDir, '.batch', 'tickets');
    for (const file of await readdir(ticketDir)) {
      const ticket = JSON.parse(await readFile(path.join(ticketDir, file), 'utf8'));
      for (const id of [ticket.input_file_id, ticket.output_file_id, ticket.error_file_id]) {
        if (id) remoteFileIds.add(id);
      }
    }
  } catch {
    // Submission may fail before ticket creation.
  }
  await Promise.all([...remoteFileIds].map((id) =>
    client.files.del(id).catch(() => undefined)
  ));
  await rm(tempDir, { recursive: true, force: true });
}
