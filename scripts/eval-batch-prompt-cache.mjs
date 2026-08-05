import OpenAI from 'openai';
import dotenv from 'dotenv';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildCacheableResponsesPrompt } from '../src/core/promptCaching.js';
dotenv.config(process.env.PHOTO_SELECT_ENV_FILE
  ? { path: process.env.PHOTO_SELECT_ENV_FILE }
  : undefined);
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required (or set PHOTO_SELECT_ENV_FILE)');
}
const model = process.env.PHOTO_SELECT_CACHE_EVAL_MODEL || 'gpt-5.6-terra';
const count = Math.min(20, Math.max(2, Number(process.env.PHOTO_SELECT_CACHE_EVAL_REQUESTS || 6)));
const pollMs = Math.max(1000, Number(process.env.PHOTO_SELECT_CACHE_EVAL_POLL_MS || 5000));
const timeoutMs = Math.max(60_000, Number(process.env.PHOTO_SELECT_CACHE_EVAL_TIMEOUT_MS || 30 * 60_000));
const prefix = (
  'Photo-select grouped Batch prompt-cache evaluation, version 1. ' +
  'This synthetic context contains no image or archive data. ' +
  'Preserve it exactly as the stable developer prefix. '
).repeat(200) + ` Run ${Date.now()}.`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function body(index) {
  return {
    model,
    ...buildCacheableResponsesPrompt({
      model,
      instructions: `${prefix} Synthetic request ${index}.`,
      promptCachePrefix: prefix,
      input: [{
        role: 'user',
        content: [{ type: 'input_text', text: 'Reply with the word OK.' }],
      }],
    }),
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
    max_output_tokens: 64,
    store: false,
  };
}
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'photo-select-cache-eval-'));
try {
  const inputPath = path.join(tempDir, 'requests.jsonl');
  const jsonl = Array.from({ length: count }, (_, i) => JSON.stringify({
    custom_id: `cache-eval-${i + 1}`,
    method: 'POST',
    url: '/v1/responses',
    body: body(i + 1),
  })).join('\n') + '\n';
  await writeFile(inputPath, jsonl, 'utf8');
  const input = await client.files.create({
    file: createReadStream(inputPath),
    purpose: 'batch',
  });
  let batch = await client.batches.create({
    input_file_id: input.id,
    endpoint: '/v1/responses',
    completion_window: '24h',
    metadata: { eval: 'photo-select-batch-cache', request_count: String(count) },
  });
  const deadline = Date.now() + timeoutMs;
  while (!['completed', 'failed', 'expired', 'canceled'].includes(batch.status)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${batch.id}`);
    await wait(pollMs);
    batch = await client.batches.retrieve(batch.id);
  }
  if (batch.status !== 'completed' || !batch.output_file_id) {
    throw new Error(`Batch ${batch.id} ended with status ${batch.status}`);
  }
  const text = await (await client.files.content(batch.output_file_id)).text();
  const usages = text.split(/\r?\n/).filter(Boolean).map((line) => {
    const row = JSON.parse(line);
    const responseBody = typeof row.response?.body === 'string'
      ? JSON.parse(row.response.body)
      : row.response?.body;
    const usage = responseBody?.usage || {};
    const details = usage.input_tokens_details || {};
    return {
      custom_id: row.custom_id,
      status_code: row.response?.status_code,
      input_tokens: usage.input_tokens || 0,
      cached_tokens: details.cached_tokens || 0,
      cache_write_tokens: details.cache_write_tokens || 0,
      output_tokens: usage.output_tokens || 0,
    };
  });
  const totals = usages.reduce((sum, usage) => {
    for (const key of ['input_tokens', 'cached_tokens', 'cache_write_tokens', 'output_tokens']) {
      sum[key] += usage[key];
    }
    sum.cache_hit_requests += Number(usage.cached_tokens > 0);
    sum.cache_write_requests += Number(usage.cache_write_tokens > 0);
    return sum;
  }, { input_tokens: 0, cached_tokens: 0, cache_write_tokens: 0,
    output_tokens: 0, cache_hit_requests: 0, cache_write_requests: 0 });
  const passed = usages.length === count &&
    usages.every((usage) => usage.status_code === 200) &&
    totals.cache_write_requests === 1 && totals.cache_hit_requests === count - 1 &&
    totals.cached_tokens > totals.cache_write_tokens;
  console.log(JSON.stringify({ eval: 'grouped_batch_explicit_prompt_cache', model,
    batch_id: batch.id, request_count: count, passed, totals,
    cache_hit_rate: totals.cache_hit_requests / count, usages }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
