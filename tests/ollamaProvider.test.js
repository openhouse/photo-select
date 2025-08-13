import { describe, it, expect, vi, beforeEach } from 'vitest';

async function loadProvider() {
  const mod = await import('../src/providers/ollama.js');
  return mod.default;
}

let chatMock;
vi.hoisted(() => {
  globalThis.__chatMock = vi.fn(async () => ({ message: { content: 'ok' } }));
});

vi.mock('ollama', () => ({
  Ollama: vi.fn(() => ({ chat: globalThis.__chatMock })),
}));

vi.mock('../src/chatClient.js', () => ({
  buildMessages: vi.fn(async () => ({
    messages: [
      { role: 'system', content: 'sys' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'info' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/jpeg;base64,abc' },
          },
        ],
      },
    ],
  })),
  MAX_RESPONSE_TOKENS: 128,
}));

vi.mock('../src/config.js', () => ({ delay: vi.fn() }));

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.PHOTO_SELECT_OLLAMA_FORMAT;
    globalThis.__chatMock.mockClear();
  });

  it('includes images within the user message', async () => {
    process.env.PHOTO_SELECT_OLLAMA_FORMAT = 'json';
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    await provider.chat({ prompt: 'p', images: ['img.jpg'], model: 'm' });
    const body = globalThis.__chatMock.mock.calls[0][0];
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].images).toEqual(['img.jpg']);
  });

  it('saves the request payload when provided', async () => {
    process.env.PHOTO_SELECT_OLLAMA_FORMAT = 'json';
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    const saver = vi.fn();
    await provider.chat({
      prompt: 'p',
      images: ['img.jpg'],
      model: 'm',
      savePayload: saver,
    });
    expect(saver).toHaveBeenCalled();
    const payload = saver.mock.calls[0][0];
    expect(payload).toHaveProperty('model', 'm');
    expect(payload).toHaveProperty('messages');
  });

  it('omits legacy json format when images are included', async () => {
    process.env.PHOTO_SELECT_OLLAMA_FORMAT = 'json';
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    await provider.chat({ prompt: 'p', images: ['img.jpg'], model: 'm' });
    const body = globalThis.__chatMock.mock.calls[0][0];
    expect(body).not.toHaveProperty('format');
  });

  it('passes schema format even with images', async () => {
    process.env.PHOTO_SELECT_OLLAMA_FORMAT = '{"type":"object"}';
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    await provider.chat({ prompt: 'p', images: ['img.jpg'], model: 'm' });
    const body = globalThis.__chatMock.mock.calls[0][0];
    expect(body.format).toEqual({ type: 'object' });
  });

  it('generates schema when no override is set', async () => {
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    await provider.chat({
      prompt: 'p',
      images: [],
      model: 'm',
      expectFieldNotesInstructions: true,
    });
    const body = globalThis.__chatMock.mock.calls[0][0];
    expect(body.format.properties).toHaveProperty('field_notes_instructions');
    expect(body.format.properties).toHaveProperty('minutes');
  });

  it('includes minutes bounds in schema', async () => {
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    await provider.chat({ prompt: 'p', images: [], model: 'm', minutesMin: 2, minutesMax: 4 });
    const body = globalThis.__chatMock.mock.calls[0][0];
    expect(body.format.properties.minutes.minItems).toBe(2);
    expect(body.format.properties.minutes.maxItems).toBe(4);
  });
});
