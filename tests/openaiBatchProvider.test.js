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
    delete process.env.PHOTO_SELECT_MAX_OUTPUT_RETRIES;
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

  it('limits safeId length for deeply nested level directories', async () => {
    const provider = new OpenAIBatchProvider({ client, enableFallback: false, helpers });
    let longDir = tmpDir;
    for (let i = 0; i < 5; i += 1) {
      longDir = path.join(longDir, `segment-${i}-${'x'.repeat(40)}`);
    }
    await fs.mkdir(longDir, { recursive: true });
    const imagePath = path.join(longDir, 'image.jpg');
    await fs.writeFile(imagePath, 'data');
    const handle = await provider.submit({
      levelDir: longDir,
      prompt: 'prompt',
      images: [imagePath],
      model: 'gpt-5',
    });
    expect(handle.safeId.length).toBeLessThanOrEqual(200);
    const ticketPath = path.join(longDir, '.batch', 'tickets', `${handle.safeId}.ticket.json`);
    await expect(fs.stat(ticketPath)).resolves.toBeTruthy();
  });

  it('collects completed batch results', async () => {
    process.env.PHOTO_SELECT_MAX_OUTPUT_RETRIES = '0';
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

  it('wraps chat completions fallback schema and preserves messages', async () => {
    const imagePath = path.join(tmpDir, 'with-people.jpg');
    await fs.writeFile(imagePath, 'data');

    const messagePayload = [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({ filename: 'with-people.jpg', people: ['Ada', { name: 'Bob' }] }),
          },
          { type: 'input_image_url', image_url: { url: 'data:image/jpeg;base64,AAA' } },
        ],
      },
    ];
    const replySchema = { type: 'object', properties: { minutes: { type: 'array' } } };

    helpers.buildMessages = vi.fn(async () => ({ messages: messagePayload, used: [imagePath] }));
    helpers.buildReplySchema = vi.fn(() => replySchema);

    const provider = new OpenAIBatchProvider({ client, helpers });
    client.batches.create
      .mockRejectedValueOnce(new Error('responses submit failed'))
      .mockResolvedValueOnce({ id: 'batch_fb', status: 'validating' });
    client.files.create
      .mockResolvedValueOnce({ id: 'file_default' })
      .mockResolvedValueOnce({ id: 'file_fallback' });

    const handle = await provider.submit({
      levelDir: tmpDir,
      prompt: 'prompt',
      images: [imagePath],
      model: 'gpt-5',
      curators: ['Curator'],
    });

    expect(handle.endpoint).toBe('/v1/chat/completions');
    const inputsDir = path.join(tmpDir, '.batch', 'inputs');
    const files = await fs.readdir(inputsDir);
    const jsonl = await fs.readFile(path.join(inputsDir, files[0]), 'utf8');
    const line = JSON.parse(jsonl.trim());
    expect(line.url).toBe('/v1/chat/completions');
    expect(line.body.messages).toEqual(messagePayload);
    expect(line.body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'photo_select_reply', schema: replySchema, strict: true },
    });
  });

  it('rejects incomplete Responses envelopes without returning raw JSON text when retries are disabled', async () => {
    process.env.PHOTO_SELECT_MAX_OUTPUT_RETRIES = '0';
    const provider = new OpenAIBatchProvider({
      client,
      enableFallback: false,
      pollIntervalMs: 0,
      helpers,
    });
    const imagePath = path.join(tmpDir, 'a.jpg');
    await fs.writeFile(imagePath, 'data');
    const handle = await provider.submit({ levelDir: tmpDir, prompt: 'prompt', images: [imagePath], model: 'gpt-5' });
    client.batches.retrieve.mockResolvedValue({ status: 'completed', id: 'batch_123', output_file_id: 'out_1' });
    const body = {
      id: 'resp_bad',
      object: 'response',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'reasoning', summary: [] }],
      text: { format: { type: 'json_schema', schema: { properties: { decisions: { items: { properties: { filename: { enum: ['a.jpg', 'b.jpg'] }, decision: { enum: ['keep', 'aside'] } } } } } } } },
      usage: { output_tokens: 8192, output_tokens_details: { reasoning_tokens: 8192 } },
    };
    client.files.content.mockResolvedValue({
      text: async () => JSON.stringify({ custom_id: handle.customId, response: { status_code: 200, body } }) + '\n',
    });
    await expect(provider.collect(handle)).rejects.toMatchObject({ code: 'OPENAI_RESPONSE_INCOMPLETE' });
  });

  it('rejects completed Responses envelopes with no assistant output', async () => {
    const provider = new OpenAIBatchProvider({ client, enableFallback: false, pollIntervalMs: 0, helpers });
    const imagePath = path.join(tmpDir, 'a.jpg');
    await fs.writeFile(imagePath, 'data');
    const handle = await provider.submit({ levelDir: tmpDir, prompt: 'prompt', images: [imagePath], model: 'gpt-5' });
    client.batches.retrieve.mockResolvedValue({ status: 'completed', id: 'batch_123', output_file_id: 'out_1' });
    client.files.content.mockResolvedValue({
      text: async () => JSON.stringify({ custom_id: handle.customId, response: { status_code: 200, body: { id: 'resp_empty', object: 'response', status: 'completed', output: [{ type: 'reasoning', summary: [] }] } } }) + '\n',
    });
    await expect(provider.collect(handle)).rejects.toMatchObject({ code: 'OPENAI_RESPONSE_NO_OUTPUT' });
  });

  it('accepts xhigh and rejects invalid reasoning effort before submission', async () => {
    const provider = new OpenAIBatchProvider({ client, enableFallback: false, helpers });
    await expect(provider.submit({ levelDir: tmpDir, prompt: 'prompt', reasoningEffort: 'xhigh' })).resolves.toMatchObject({ provider: 'openai-batch' });
    await expect(provider.submit({ levelDir: tmpDir, prompt: 'prompt', reasoningEffort: 'extreme' })).rejects.toThrow(/reasoningEffort/);
  });


  it('resubmits max_output_tokens incomplete responses with a larger budget before succeeding', async () => {
    process.env.PHOTO_SELECT_MAX_OUTPUT_RETRIES = '1';
    const provider = new OpenAIBatchProvider({ client, enableFallback: false, pollIntervalMs: 0, helpers });
    const imagePath = path.join(tmpDir, 'a.jpg');
    await fs.writeFile(imagePath, 'data');
    client.batches.create
      .mockResolvedValueOnce({ id: 'batch_1', status: 'validating' })
      .mockResolvedValueOnce({ id: 'batch_2', status: 'validating' });
    const handle = await provider.submit({ levelDir: tmpDir, prompt: 'prompt', images: [imagePath], model: 'gpt-5', reasoningEffort: 'xhigh' });
    client.batches.retrieve.mockResolvedValue({ status: 'completed', output_file_id: 'out' });
    const incomplete = {
      id: 'resp_bad',
      object: 'response',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [{ type: 'reasoning', summary: [] }],
      usage: { output_tokens: 8192, output_tokens_details: { reasoning_tokens: 8192 } },
    };
    let contentCalls = 0;
    client.files.content.mockImplementation(async () => ({
      text: async () => {
        contentCalls += 1;
        if (contentCalls === 1) {
          return JSON.stringify({ custom_id: handle.customId, response: { status_code: 200, body: incomplete } }) + '\n';
        }
        const inputsDir = path.join(tmpDir, '.batch', 'inputs');
        const files = await fs.readdir(inputsDir);
        const rows = await Promise.all(files.map(async (file) => JSON.parse((await fs.readFile(path.join(inputsDir, file), 'utf8')).trim())));
        const retryRow = rows.find((row) => row.custom_id !== handle.customId);
        return JSON.stringify({
          custom_id: retryRow.custom_id,
          response: {
            status_code: 200,
            body: { output_text: '{"decisions":[{"filename":"a.jpg","decision":"keep","reason":"ok"}]}' },
            usage: { output_tokens: 1000, output_tokens_details: { reasoning_tokens: 100 } },
          },
        }) + '\n';
      },
    }));

    const result = await provider.collect(handle);
    expect(result.raw).toContain('decisions');
    expect(client.batches.create).toHaveBeenCalledTimes(2);
    const inputsDir = path.join(tmpDir, '.batch', 'inputs');
    const files = await fs.readdir(inputsDir);
    const budgets = await Promise.all(files.map(async (file) => JSON.parse((await fs.readFile(path.join(inputsDir, file), 'utf8')).trim()).body.max_output_tokens));
    expect(Math.max(...budgets)).toBeGreaterThan(Math.min(...budgets));
  });

});
