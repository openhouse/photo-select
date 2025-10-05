import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';

async function loadProvider() {
  const mod = await import('../src/providers/ollama.js');
  return mod.default;
}

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
vi.mock('../src/imagePreprocessor.js', () => ({
  getSurrogateImage: vi.fn(async () => Buffer.from('image-bytes')),
}));

const fetchMock = vi.fn();
let originalFetch;

function makeResponse(body, init = {}) {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const buffer = new TextEncoder().encode(text).buffer;
  return {
    ok,
    status,
    text: async () => text,
    arrayBuffer: async () => buffer,
  };
}

function setFetchHandlers(overrides = {}) {
  const handlers = {
    tags: () => Promise.resolve(makeResponse({})),
    show: () => Promise.resolve(makeResponse({})),
    chat: () => Promise.resolve(makeResponse({ message: { content: 'ok' } })),
    ...overrides,
  };
  fetchMock.mockImplementation((input, init) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (url.endsWith('/api/tags')) return handlers.tags(input, init);
    if (url.endsWith('/api/show')) return handlers.show(input, init);
    if (url.endsWith('/api/chat')) return handlers.chat(input, init);
    throw new Error(`Unexpected fetch to ${url}`);
  });
}

beforeAll(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock;
});

afterAll(() => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
  } else {
    delete globalThis.fetch;
  }
});

describe('OllamaProvider', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.PHOTO_SELECT_OLLAMA_FORMAT;
    fetchMock.mockReset();
    setFetchHandlers();
  });

  it('includes images within the user message', async () => {
    process.env.PHOTO_SELECT_OLLAMA_FORMAT = 'json';
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    await provider.chat({ prompt: 'p', images: ['img.jpg'], model: 'm' });
    const chatCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/chat'));
    expect(chatCall).toBeTruthy();
    const [, init] = chatCall;
    const body = JSON.parse(init.body);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].images).toEqual(['aW1hZ2UtYnl0ZXM=']);
    expect(body.options).toEqual({
      num_predict: 128,
      num_ctx: 32_768,
      num_keep: -1,
    });
  });

  it('throws a helpful error when the Ollama daemon is unavailable', async () => {
    const connectionError = new Error('fetch failed');
    connectionError.cause = new Error('ECONNREFUSED');
    setFetchHandlers({
      tags: () => Promise.reject(connectionError),
    });
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    await expect(
      provider.chat({ prompt: 'p', images: [], model: 'm' })
    ).rejects.toThrow(/Unable to reach Ollama/);
    const tagsCalls = fetchMock.mock.calls.filter(([url]) => url.endsWith('/api/tags'));
    expect(tagsCalls.length).toBeGreaterThan(0);
  });

  it('suggests pulling the model when it is missing', async () => {
    setFetchHandlers({
      show: () => Promise.resolve(makeResponse({}, { status: 404 })),
    });
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
    const chatCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/chat'));
    const [, init] = chatCall;
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty('format');
  });

  it('passes schema format even with images', async () => {
    process.env.PHOTO_SELECT_OLLAMA_FORMAT = '{"type":"object"}';
    const OllamaProvider = await loadProvider();
    const provider = new OllamaProvider();
    await provider.chat({ prompt: 'p', images: ['img.jpg'], model: 'm' });
    const chatCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/chat'));
    const [, init] = chatCall;
    const body = JSON.parse(init.body);
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
    const chatCall = fetchMock.mock.calls.find(([url]) => url.endsWith('/api/chat'));
    const [, init] = chatCall;
    const body = JSON.parse(init.body);
    expect(body.format.properties).toHaveProperty('field_notes_instructions');
    expect(body.format.properties).toHaveProperty('minutes');
  });
});
