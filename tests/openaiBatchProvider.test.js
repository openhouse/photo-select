import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('handlebars', () => ({
  default: {
    compile: () => () => '',
  },
}));
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const createClient = () => {
  const files = {
    create: vi.fn(async () => ({ id: 'file_123' })),
    content: vi.fn(),
  };
  const batches = {
    create: vi.fn(async () => ({ id: 'batch_123', status: 'validating' })),
    retrieve: vi.fn(),
    cancel: vi.fn(async () => ({})),
  };
  return { files, batches };
};

describe('OpenAIBatchProvider', () => {
  let tmpDir;
  let client;
  let OpenAIBatchProvider;
  let helpers;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-batch-'));
    client = createClient();
    process.env.OPENAI_API_KEY = 'test-key';
    helpers = {
      buildInput: vi.fn(async (prompt, images) => ({
        instructions: prompt,
        input: [
          {
            role: 'user',
            content: [],
          },
        ],
        used: images,
      })),
      buildMessages: vi.fn(async (prompt) => ({
        messages: [{ role: 'user', content: prompt }],
        used: [],
      })),
      schemaForBatch: vi.fn((used) => ({
        name: 'PhotoSelectPanelV1',
        schema: {
          type: 'object',
          properties: {
            minutes: { type: 'array' },
            decisions: { type: 'array' },
          },
        },
      })),
      buildReplySchema: vi.fn(() => ({
        type: 'object',
        properties: {
          minutes: { type: 'array' },
          decisions: { type: 'array' },
        },
      })),
    };
    ({ default: OpenAIBatchProvider } = await import('../src/providers/openai-batch.js'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it('writes JSONL input and ticket on submit', async () => {
    const provider = new OpenAIBatchProvider({ client, enableFallback: false, helpers });
    const imagePath = path.join(tmpDir, '1.jpg');
    await fs.writeFile(imagePath, 'data');
    const handle = await provider.submit({
      levelDir: tmpDir,
      prompt: 'prompt',
      images: [imagePath],
      model: 'gpt-5',
      curators: ['Curator'],
    });
    expect(handle.customId).toMatch(/^ps:/);
    expect(client.files.create).toHaveBeenCalledTimes(1);
    expect(client.batches.create).toHaveBeenCalledTimes(1);
    const inputsDir = path.join(tmpDir, '.batch', 'inputs');
    const files = await fs.readdir(inputsDir);
    expect(files.length).toBe(1);
    const jsonl = await fs.readFile(path.join(inputsDir, files[0]), 'utf8');
    const line = JSON.parse(jsonl.trim());
    expect(line.custom_id).toBe(handle.customId);
    expect(line.url).toBe('/v1/responses');
    const ticketPath = path.join(tmpDir, '.batch', 'tickets', `${handle.safeId}.ticket.json`);
    const ticket = JSON.parse(await fs.readFile(ticketPath, 'utf8'));
    expect(ticket.batch_id).toBe('batch_123');
    expect(ticket.used_images).toEqual(['1.jpg']);
  });

  it('collects completed batch results', async () => {
    const provider = new OpenAIBatchProvider({
      client,
      enableFallback: false,
      pollIntervalMs: 0,
      helpers,
    });
    const imagePath = path.join(tmpDir, '1.jpg');
    await fs.writeFile(imagePath, 'data');
    const handle = await provider.submit({
      levelDir: tmpDir,
      prompt: 'prompt',
      images: [imagePath],
      model: 'gpt-5',
    });
    client.batches.retrieve
      .mockResolvedValueOnce({ status: 'in_progress', id: 'batch_123' })
      .mockResolvedValueOnce({
        status: 'completed',
        id: 'batch_123',
        output_file_id: 'out_1',
      });
    const payload = JSON.stringify({
      id: 'item_1',
      custom_id: handle.customId,
      response: {
        status_code: 200,
        body: JSON.stringify({
          output: [
            {
              type: 'message',
              content: [
                {
                  type: 'output_json',
                  json: { minutes: [], decisions: [] },
                },
              ],
            },
          ],
        }),
        usage: { total_tokens: 12 },
      },
    });
    client.files.content.mockResolvedValue({
      text: async () => payload + '\n',
    });
    const result = await provider.collect(handle);
    expect(result.raw).toBe(JSON.stringify({ minutes: [], decisions: [] }));
    expect(result.json).toEqual({ minutes: [], decisions: [] });
    expect(client.batches.retrieve).toHaveBeenCalledTimes(2);
    expect(client.files.content).toHaveBeenCalledWith('out_1');
    const ticketPath = path.join(tmpDir, '.batch', 'tickets', `${handle.safeId}.ticket.json`);
    const ticket = JSON.parse(await fs.readFile(ticketPath, 'utf8'));
    expect(ticket.status).toBe('completed');
    const resultsPath = path.join(tmpDir, '.batch', 'results', `${handle.batchId}.jsonl`);
    await expect(fs.stat(resultsPath)).resolves.toBeTruthy();
  });
});
