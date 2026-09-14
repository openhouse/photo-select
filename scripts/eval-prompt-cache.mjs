import OpenAI from 'openai';
import dotenv from 'dotenv';
import { buildCacheableResponsesPrompt } from '../src/core/promptCaching.js';

if (process.env.PHOTO_SELECT_ENV_FILE) {
  dotenv.config({ path: process.env.PHOTO_SELECT_ENV_FILE });
} else {
  dotenv.config();
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error(
    'OPENAI_API_KEY is required (or set PHOTO_SELECT_ENV_FILE to an env file)'
  );
}

const model = process.env.PHOTO_SELECT_CACHE_EVAL_MODEL || 'gpt-5.6-terra';
const targetPrefixChars = Math.max(
  4096,
  Number(process.env.PHOTO_SELECT_CACHE_EVAL_PREFIX_CHARS || 444_466)
);
let stablePrefix = `Photo-select Flex cache evaluation pt5, run ${Date.now()}. `;
for (let i = 0; stablePrefix.length < targetPrefixChars; i++) {
  stablePrefix += `Synthetic context line ${String(i).padStart(6, '0')}: ` +
    'amber bridge cedar delta ember field granite harbor iris juniper.\n';
}
stablePrefix = stablePrefix.slice(0, targetPrefixChars);

function request(dynamicSuffix) {
  const promptFields = buildCacheableResponsesPrompt({
    model,
    instructions: stablePrefix + dynamicSuffix,
    promptCachePrefix: stablePrefix,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Reply with the word OK.' }],
      },
    ],
  });
  return {
    model,
    ...promptFields,
    service_tier: 'flex',
    reasoning: { effort: 'low' },
    text: { verbosity: 'low' },
    max_output_tokens: 64,
    store: false,
  };
}

function usageSummary(response) {
  const usage = response?.usage || {};
  const details = usage.input_tokens_details || {};
  return {
    input_tokens: usage.input_tokens || 0,
    cached_tokens: details.cached_tokens || 0,
    cache_write_tokens: details.cache_write_tokens || 0,
    output_tokens: usage.output_tokens || 0,
  };
}

const client = new OpenAI({ apiKey, timeout: 15 * 60_000 });
const first = usageSummary(
  await client.responses.create(request(' First evaluation request.'))
);
const second = usageSummary(
  await client.responses.create(request(' Second evaluation request.'))
);
const passed =
  first.cache_write_tokens > 0 &&
  second.cached_tokens > 0 &&
  second.cache_write_tokens === 0;

console.log(
  JSON.stringify(
    {
      eval: 'production_sized_flex_prompt_cache_read_after_write_pt5',
      model,
      stable_prefix_chars: stablePrefix.length,
      passed,
      first,
      second,
    },
    null,
    2
  )
);

if (!passed) process.exitCode = 1;
