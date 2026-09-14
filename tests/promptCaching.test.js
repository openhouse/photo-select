import { describe, expect, it } from 'vitest';
import {
  buildCacheableResponsesPrompt,
  promptCacheHitFromUsage,
  stabilizeResponseSchemaForPromptCache,
} from '../src/core/promptCaching.js';

const stable = 'Stable curatorial context. '.repeat(300);
const input = [
  {
    role: 'user',
    content: [{ type: 'input_text', text: 'Here are the images: JSON' }],
  },
];

describe('buildCacheableResponsesPrompt', () => {
  it('removes only request-specific schema constraints from cached requests', () => {
    const schema = {
      properties: {
        minutes: { minItems: 23, maxItems: 34 },
        decisions: {
          minItems: 10,
          maxItems: 10,
          items: {
            properties: {
              filename: { enum: ['a.jpg', 'b.jpg'] },
              decision: { enum: ['keep', 'aside'] },
            },
          },
        },
      },
    };
    const stableSchema = stabilizeResponseSchemaForPromptCache(schema);
    expect(stableSchema.properties.minutes).toEqual({});
    expect(stableSchema.properties.decisions).not.toHaveProperty('minItems');
    expect(stableSchema.properties.decisions).not.toHaveProperty('maxItems');
    expect(stableSchema.properties.decisions.items.properties.filename).toEqual({});
    expect(stableSchema.properties.decisions.items.properties.decision.enum)
      .toEqual(['keep', 'aside']);
    expect(schema.properties.minutes.minItems).toBe(23);
    expect(schema.properties.decisions.items.properties.filename.enum)
      .toEqual(['a.jpg', 'b.jpg']);
  });

  it('requires a reported cache read before releasing readers', () => {
    expect(promptCacheHitFromUsage({
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 6000 },
    })).toBe(false);
    expect(promptCacheHitFromUsage({
      input_tokens_details: { cached_tokens: 6000, cache_write_tokens: 0 },
    })).toBe(true);
    expect(promptCacheHitFromUsage({
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    })).toBe(false);
    expect(promptCacheHitFromUsage()).toBe(false);
  });

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
    expect(request.prompt_cache_key).toMatch(/^photo-select:v2:[a-f0-9]{32}$/);
  });

  it('reuses only the stable key while retaining batch-specific curators', () => {
    const aliceBatch = 'Role play as Bob, Alice. Review a.jpg.';
    const carolBatch = 'Role play as Bob, Carol. Review b.jpg.';
    const first = buildCacheableResponsesPrompt({
      model: 'gpt-5.6-terra',
      instructions: stable + aliceBatch,
      input,
      promptCachePrefix: stable,
    });
    const second = buildCacheableResponsesPrompt({
      model: 'gpt-5.6-terra',
      instructions: stable + carolBatch,
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
    expect(first.input[0].content[1].text).toBe(aliceBatch);
    expect(second.input[0].content[1].text).toBe(carolBatch);
    expect(first.input[0].content.map((part) => part.text).join('')).toBe(
      stable + aliceBatch
    );
    expect(second.input[0].content.map((part) => part.text).join('')).toBe(
      stable + carolBatch
    );
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
