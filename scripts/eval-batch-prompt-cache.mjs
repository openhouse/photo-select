import OpenAI from 'openai';
import dotenv from 'dotenv';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

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
const aggregationMs = Math.max(
  1,
  Number(process.env.PHOTO_SELECT_CACHE_EVAL_AGGREGATION_MS || 50)
);
const staggerMs = Math.max(
  aggregationMs + 1,
  Number(process.env.PHOTO_SELECT_CACHE_EVAL_STAGGER_MS || 150)
);
let prefix = `Photo-select Flex provider cache evaluation pt5, run ${Date.now()}. `;
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
          text: 'Return JSON with empty minutes and decisions arrays.',
        }],
      }],
      used: [],
    };
  },
  schemaForBatch(_used, _curators, { minutesMin = 0, minutesMax = 0 } = {}) {
    return {
      name: 'PhotoSelectCacheEvalV3',
      schema: {
        type: 'object',
        properties: {
          minutes: {
            type: 'array',
            minItems: minutesMin,
            maxItems: minutesMax,
            items: { type: 'string' },
          },
          decisions: {
            type: 'array',
            minItems: 1,
            maxItems: 1,
            items: {
              type: 'object',
              properties: {
                filename: {
                  type: 'string',
                  enum: [`synthetic-${minutesMin}.jpg`],
                },
                decision: { type: 'string', enum: ['keep', 'aside'] },
                reason: { type: 'string' },
              },
              required: ['filename', 'decision', 'reason'],
              additionalProperties: false,
            },
          },
        },
        required: ['minutes', 'decisions'],
        additionalProperties: false,
      },
    };
  },
};

function usageSummary(handle, ticket, result) {
  const usage = result?.usage || {};
  const details = usage.input_tokens_details || {};
  return {
    custom_id: handle.customId,
    response_id: handle.batchId,
    cache_role: ticket.cache_role,
    service_tier: ticket.service_tier,
    input_tokens: usage.input_tokens || 0,
    cached_tokens: details.cached_tokens || 0,
    cache_write_tokens: details.cache_write_tokens || 0,
    output_tokens: usage.output_tokens || 0,
  };
}

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 15 * 60_000,
});
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'photo-select-cache-eval-'));
try {
  const provider = new OpenAIBatchProvider({
    client,
    enableFallback: false,
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
          minutesMin: i + 1,
          minutesMax: i + 2,
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
  const results = await Promise.all(handles.map((handle) =>
    provider.collect(handle)
  ));
  const tickets = await Promise.all(handles.map((handle) =>
    readFile(handle.ticketPath, 'utf8').then(JSON.parse)
  ));
  const usages = handles.map((handle, index) =>
    usageSummary(handle, tickets[index], results[index])
  );
  const inputDir = path.join(tempDir, '.batch', 'inputs');
  const inputFiles = await readdir(inputDir);
  const inputRows = (await Promise.all(inputFiles.map(async (file) =>
    (await readFile(path.join(inputDir, file), 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .map(JSON.parse)
  ))).flat();
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
  const seedUsage = usages.find((usage) => usage.cache_role === 'seed');
  const probeUsage = usages.find((usage) => usage.cache_role === 'probe');
  const readerUsages = usages.filter((usage) => usage.cache_role === 'reader');
  const schemaHashes = inputRows.map((row) => crypto
    .createHash('sha256')
    .update(JSON.stringify(row.body?.text?.format?.schema))
    .digest('hex'));
  const topologyPassed = submissionErrors.length === 0 &&
    handles.length === count &&
    new Set(handles.map((handle) => handle.batchId)).size === count &&
    inputFiles.length === count &&
    inputRows.length === count &&
    inputRows.every((row) => row.body?.service_tier === 'flex') &&
    new Set(schemaHashes).size === 1 &&
    tickets.every((ticket) => ticket.service_tier === 'flex') &&
    tickets.filter((ticket) => ticket.cache_role === 'seed').length === 1 &&
    tickets.filter((ticket) => ticket.cache_role === 'probe').length === 1 &&
    readerUsages.length === count - 2;
  const cachePassed = seedUsage?.cache_write_tokens > 0 &&
    probeUsage?.cached_tokens > 0 &&
    probeUsage?.cache_write_tokens === 0 &&
    readerUsages.every((usage) => usage.cached_tokens > 0) &&
    totals.cache_write_requests === 1 &&
    totals.cache_hit_requests === count - 1 &&
    totals.cached_tokens > totals.cache_write_tokens;
  const passed = topologyPassed && cachePassed;
  console.log(JSON.stringify({
    eval: 'provider_flex_seed_probe_barrier_explicit_prompt_cache_pt5',
    model,
    request_count: count,
    stable_prefix_chars: prefix.length,
    aggregation_ms: aggregationMs,
    preparation_stagger_ms: staggerMs,
    response_count: handles.length,
    input_file_count: inputFiles.length,
    stable_schema_hashes: [...new Set(schemaHashes)],
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
  await rm(tempDir, { recursive: true, force: true });
}
