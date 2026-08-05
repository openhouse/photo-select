import { describe, expect, it } from 'vitest';
import { buildCacheableResponsesPrompt } from '../src/core/promptCaching.js';

const stable = 'Stable curatorial context. '.repeat(300);
const input = [
  {
    role: 'user',
    content: [{ type: 'input_text', text: 'Here are the images: JSON' }],
  },
];

describe('buildCacheableResponsesPrompt', () => {
  it('marks the stable GPT-5.6 prefix without changing prompt text or user input', () => {
    const dynamic = 'Role play as Curator A. Review a.jpg.';
    const request = buildCacheableResponsesPrompt({
      model: 'gpt-5.6-terra',
      instructions: stable + dynamic,
      input,
      promptCachePrefix: stable,
    });

    expect(request.instructions).toBeUndefined();
    expect(request.input.slice(1)).toEqual(input);
    expect(request.input[0].role).toBe('developer');
    expect(request.input[0].content.map((part) => part.text).join('')).toBe(
      stable + dynamic
    );
    expect(request.input[0].content[0].prompt_cache_breakpoint).toEqual({
      mode: 'explicit',
    });
    expect(request.input[0].content[1]).not.toHaveProperty(
      'prompt_cache_breakpoint'
    );
    expect(request.prompt_cache_options).toEqual({
      mode: 'explicit',
      ttl: '30m',
    });
    expect(request.prompt_cache_key).toMatch(/^photo-select:v1:[a-f0-9]{32}$/);
  });

  it('reuses a key across changing suffixes and changes it with the stable prefix', () => {
    const first = buildCacheableResponsesPrompt({
      model: 'gpt-5.6-terra',
      instructions: `${stable}Review a.jpg.`,
      input,
      promptCachePrefix: stable,
    });
    const second = buildCacheableResponsesPrompt({
      model: 'gpt-5.6-terra',
      instructions: `${stable}Review b.jpg.`,
      input,
      promptCachePrefix: stable,
    });
    const changed = buildCacheableResponsesPrompt({
      model: 'gpt-5.6-terra',
      instructions: `${stable}Additional stable fact. Review c.jpg.`,
      input,
      promptCachePrefix: `${stable}Additional stable fact. `,
    });

    expect(first.prompt_cache_key).toBe(second.prompt_cache_key);
    expect(first.prompt_cache_key).not.toBe(changed.prompt_cache_key);
  });

  it('preserves the legacy request shape for earlier models', () => {
    expect(
      buildCacheableResponsesPrompt({
        model: 'gpt-5.4',
        instructions: `${stable}Review a.jpg.`,
        input,
        promptCachePrefix: stable,
      })
    ).toEqual({ instructions: `${stable}Review a.jpg.`, input });
  });

  it('preserves the legacy request shape when no safe boundary is available', () => {
    expect(
      buildCacheableResponsesPrompt({
        model: 'gpt-5.6-terra',
        instructions: 'Custom prompt without a context boundary.',
        input,
      })
    ).toEqual({
      instructions: 'Custom prompt without a context boundary.',
      input,
    });
  });
});
