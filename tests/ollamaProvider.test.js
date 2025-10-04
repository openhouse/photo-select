import { describe, it, expect, vi, beforeEach } from 'vitest';

async function loadProvider() {
  const mod = await import('../src/providers/ollama.js');
  return mod.default;
}

vi.hoisted(() => {
  globalThis.__chatMock = vi.fn(async () => ({ message: { content: 'ok' } }));
  globalThis.__ollamaListMock = vi.fn(async () => ({}));
  globalThis.__ollamaShowMock = vi.fn(async () => ({}));
});

vi.mock('ollama', () => ({
  Ollama: vi.fn(() => ({
    chat: globalThis.__chatMock,
    list: globalThis.__ollamaListMock,
    show: globalThis.__ollamaShowMock,
  })),
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
    globalThis.__ollamaListMock.mockClear();
    globalThis.__ollamaShowMock.mockClear();
    globalThis.__ollamaListMock.mockResolvedValue({});
    globalThis.__ollamaShowMock.mockResolvedValue({});
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

  it('throws a helpful error when the Ollama daemon is unavailable', async () => {
    const connectionError = new Error('fetch failed');
    connectionError.cause = new Error('ECONNREFUSED');
    globalThis.__ollamaListMock.mockRejectedValueOnce(connectionError);
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    await expect(
      provider.chat({ prompt: 'p', images: [], model: 'm' })
    ).rejects.toThrow(/Unable to reach Ollama/);
    expect(globalThis.__ollamaListMock).toHaveBeenCalled();
  });

  it('suggests pulling the model when it is missing', async () => {
    const missingModelError = new Error('not found');
    missingModelError.name = 'ResponseError';
    missingModelError.status_code = 404;
    globalThis.__ollamaShowMock.mockRejectedValueOnce(missingModelError);
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    await expect(
      provider.chat({ prompt: 'p', images: [], model: 'm' })
    ).rejects.toThrow(/ollama pull m/);
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
});
