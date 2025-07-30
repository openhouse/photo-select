import { describe, it, expect, vi } from 'vitest';
import OllamaProvider from '../src/providers/ollama.js';

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
  it('includes images within the user message', async () => {
    const provider = new OllamaProvider();
    await provider.chat({ prompt: 'p', images: ['img.jpg'], model: 'm' });
    const body = globalThis.__chatMock.mock.calls[0][0];
    expect(body.messages).toHaveLength(2);
    expect(body.messages[1].images).toEqual(['img.jpg']);
  });

  it('saves the request payload when provided', async () => {
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
});
