import { describe, it, expect, vi, beforeEach } from 'vitest';

async function loadProvider() {
  const mod = await import('../src/providers/openai.js');
  return mod.default;
}

let callArgs;
vi.hoisted(() => {
  globalThis.__chatCompletion = vi.fn(async (opts) => {
    callArgs = opts;
    return 'ok';
  });
});

vi.mock('../src/chatClient.js', () => ({
  chatCompletion: globalThis.__chatCompletion,
}));

describe('OpenAIProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.PHOTO_SELECT_OPENAI_FORMAT;
    callArgs = undefined;
  });

  it('generates schema when env is unset', async () => {
    const OpenAIProvider = await loadProvider();
    const provider = new OpenAIProvider();
    await provider.chat({ expectFieldNotesInstructions: true });
    expect(callArgs.responseFormat.schema.properties).toHaveProperty(
      'field_notes_instructions'
    );
  });

  it('uses override string', async () => {
    process.env.PHOTO_SELECT_OPENAI_FORMAT = 'json_object';
    const OpenAIProvider = await loadProvider();
    const provider = new OpenAIProvider();
    await provider.chat();
    expect(callArgs.responseFormat).toEqual({ type: 'json_object' });
  });

  it('omits parameter when empty', async () => {
    process.env.PHOTO_SELECT_OPENAI_FORMAT = '';
    const OpenAIProvider = await loadProvider();
    const provider = new OpenAIProvider();
    await provider.chat();
    expect(callArgs.responseFormat).toBeUndefined();
  });

  it('includes minutes bounds in schema', async () => {
    const OpenAIProvider = await loadProvider();
    const provider = new OpenAIProvider();
    await provider.chat({ minutesMin: 2, minutesMax: 4 });
    expect(callArgs.responseFormat.schema.properties.minutes.minItems).toBe(2);
    expect(callArgs.responseFormat.schema.properties.minutes.maxItems).toBe(4);
  });
});
