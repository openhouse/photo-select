import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.mock('../src/config.js', () => ({ delay: vi.fn() }));
vi.mock('openai', () => ({ OpenAI: vi.fn(() => ({})), NotFoundError: class {} }));

import { buildMessages } from '../src/chatClient.js';

beforeAll(() => {
  global.fetch = vi.fn();
});

afterAll(() => {
  global.fetch = undefined;
});

describe('prompt people sanitization', () => {
  it('filters placeholder people from notes', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-prompt-'));
    const img = path.join(dir, 'A.jpg');
    await fs.writeFile(img, 'a');
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: ['_UNKNOWN_', 'Olivia J Mann'] }),
    });
    const { messages } = await buildMessages('prompt', [img]);
    const meta = JSON.parse(messages[1].content[1].text);
    expect(meta).toEqual({ filename: 'A.jpg', people: ['Olivia J Mann'] });
    await fs.rm(dir, { recursive: true, force: true });
  });
});
