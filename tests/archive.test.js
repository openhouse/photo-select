import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

vi.hoisted(() => {
  process.env.OPENAI_API_KEY = 'test';
});

vi.mock('../src/chatClient.js', async () => {
  const actual = await vi.importActual('../src/chatClient.js');
  return {
    ...actual,
    chatCompletion: vi.fn().mockResolvedValue(JSON.stringify({
      minutes: [{ speaker: 'A', text: 'done?' }],
      decision: { keep: [], aside: ['a.jpg'] }
    }))
  };
});

import { chatCompletion } from '../src/chatClient.js';
import { triageDirectory } from '../src/orchestrator.js';

let dir, promptFile;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arc-'));
  await fs.writeFile(path.join(dir, 'a.jpg'), 'a');
  promptFile = path.join(dir, 'p.hbs');
  await fs.writeFile(promptFile, 'prompt');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dir, { recursive: true, force: true });
});

describe('archive reply', () => {
  it('writes raw reply file', async () => {
    await triageDirectory({ dir, promptPath: promptFile, model: 'x', recurse: false });
    const levelDir = path.join(dir, '_level-001');
    const replies = await fs.readdir(path.join(levelDir, 'replies'));
    expect(replies.length).toBe(1);
  });
});
