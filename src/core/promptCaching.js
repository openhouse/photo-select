import crypto from 'node:crypto';

const CACHE_KEY_VERSION = 'v2';
const MIN_CACHE_PREFIX_CHARS = 4096;

export function promptCacheHitFromUsage(usage = {}) {
  const details = usage.input_tokens_details || {};
  return Number(details.cached_tokens || 0) > 0;
}

// The API renders Structured Output schemas before messages. Stabilize only
// request-specific constraints; the prompt and validator still enforce them.
export function stabilizeResponseSchemaForPromptCache(schema) {
  const stable = structuredClone(schema);
  const minutes = stable?.properties?.minutes;
  if (minutes && typeof minutes === 'object') {
    delete minutes.minItems; delete minutes.maxItems;
  }
  const decisions = stable?.properties?.decisions;
  if (decisions && typeof decisions === 'object') {
    delete decisions.minItems; delete decisions.maxItems;
    const filename = decisions.items?.properties?.filename;
    if (filename && typeof filename === 'object') delete filename.enum;
  }
  return stable;
}

function isGpt56OrLater(model = '') {
  const match = String(model).match(/^gpt-(\d+)\.(\d+)(?:$|[-.])/i);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 5 || (major === 5 && minor >= 6);
}

function cacheKey(model, promptCachePrefix) {
  const digest = crypto
    .createHash('sha256')
    .update(CACHE_KEY_VERSION)
    .update('\0')
    .update(String(model))
    .update('\0')
    .update(promptCachePrefix)
    .digest('hex')
    .slice(0, 32);
  return `photo-select:${CACHE_KEY_VERSION}:${digest}`;
}

/**
 * Preserve legacy Responses request fields unless a GPT-5.6+ request carries a
 * verified, sufficiently large stable prefix. For eligible requests, render the
 * same developer instructions as two adjacent content blocks and mark only the
 * stable block for explicit caching.
 */
export function buildCacheableResponsesPrompt({
  model,
  instructions,
  input,
  promptCachePrefix,
}) {
  const legacy = { instructions, input };
  if (
    !isGpt56OrLater(model) ||
    typeof promptCachePrefix !== 'string' ||
    promptCachePrefix.length < MIN_CACHE_PREFIX_CHARS ||
    !String(instructions).startsWith(promptCachePrefix)
  ) {
    return legacy;
  }

  const dynamicSuffix = String(instructions).slice(promptCachePrefix.length);
  const developerContent = [
    {
      type: 'input_text',
      text: promptCachePrefix,
      prompt_cache_breakpoint: { mode: 'explicit' },
    },
  ];
  if (dynamicSuffix) {
    developerContent.push({ type: 'input_text', text: dynamicSuffix });
  }

  return {
    input: [
      { role: 'developer', content: developerContent },
      ...(Array.isArray(input) ? input : []),
    ],
    prompt_cache_key: cacheKey(model, promptCachePrefix),
    prompt_cache_options: { mode: 'explicit', ttl: '30m' },
  };
}

export default buildCacheableResponsesPrompt;
