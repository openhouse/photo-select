import { describe, it, expect, vi } from 'vitest';
import OllamaProvider from '../src/providers/ollama.js';

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
  it('includes images within the user message', async () => {
    const provider = new OllamaProvider();
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ message: { content: 'ok' } }),
    }));
    await provider.chat({ prompt: 'p', images: ['img.jpg'], model: 'm' });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0].images).toEqual(['abc']);
    expect(body.images).toBeUndefined();
  });
});
