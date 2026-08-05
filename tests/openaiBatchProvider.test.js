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
    expect(ticket.output_budget.max_output_tokens).toBeGreaterThanOrEqual(8192);
    expect(ticket.output_budget.estimated_input_tokens).toBeGreaterThan(0);
    expect(ticket.output_budget.image_count).toBe(1);
    const ledger = await fs.readFile(path.join(tmpDir, '.batch', 'jobs.ndjson'), 'utf8');
    expect(ledger).toContain('output_budget');
  });

  it('coalesces compatible concurrent submissions into one multi-line Batch job', async () => {
    const provider = new OpenAIBatchProvider({
      client,
      enableFallback: false,
      helpers,
      aggregationWindowMs: 25,
    });
    const firstImage = path.join(tmpDir, '1.jpg');
    const secondImage = path.join(tmpDir, '2.jpg');
    await Promise.all([
      fs.writeFile(firstImage, 'first'),
      fs.writeFile(secondImage, 'second'),
    ]);

    const handles = await Promise.all([
      provider.submit({
        levelDir: tmpDir,
        prompt: 'stable context\nreview 1.jpg',
        images: [firstImage],
        model: 'gpt-5.6-terra',
      }),
      provider.submit({
        levelDir: tmpDir,
        prompt: 'stable context\nreview 2.jpg',
        images: [secondImage],
        model: 'gpt-5.6-terra',
      }),
    ]);

    expect(client.files.create).toHaveBeenCalledTimes(1);
    expect(client.batches.create).toHaveBeenCalledTimes(1);
    expect(new Set(handles.map((handle) => handle.customId)).size).toBe(2);
    expect(new Set(handles.map((handle) => handle.batchId))).toEqual(
      new Set(['batch_123'])
    );

    const inputsDir = path.join(tmpDir, '.batch', 'inputs');
    const inputFiles = await fs.readdir(inputsDir);
    expect(inputFiles).toHaveLength(1);
    const lines = (await fs.readFile(path.join(inputsDir, inputFiles[0]), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(new Set(lines.map((line) => line.custom_id))).toEqual(
      new Set(handles.map((handle) => handle.customId))
    );
  });

  it('coalesces worker submissions before staggered request preparation can split the Batch', async () => {
    const immediateBuildInput = helpers.buildInput;
    helpers.buildInput = vi.fn(async (prompt, images, curators) => {
      if (path.basename(images[0]) === 'slow.jpg') {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return immediateBuildInput(prompt, images, curators);
    });
    const provider = new OpenAIBatchProvider({
      client,
      enableFallback: false,
      helpers,
      aggregationWindowMs: 10,
    });
    const fastImage = path.join(tmpDir, 'fast.jpg');
    const slowImage = path.join(tmpDir, 'slow.jpg');
    await Promise.all([
      fs.writeFile(fastImage, 'fast'),
      fs.writeFile(slowImage, 'slow'),
    ]);

    await Promise.all([
      provider.submit({
        levelDir: tmpDir,
        prompt: 'stable context\nreview fast.jpg',
        images: [fastImage],
        model: 'gpt-5.6-terra',
      }),
      provider.submit({
        levelDir: tmpDir,
        prompt: 'stable context\nreview slow.jpg',
        images: [slowImage],
        model: 'gpt-5.6-terra',
      }),
    ]);

    const inputsDir = path.join(tmpDir, '.batch', 'inputs');
    const inputFiles = await fs.readdir(inputsDir);
    expect(inputFiles).toHaveLength(1);
    const lines = (await fs.readFile(path.join(inputsDir, inputFiles[0]), 'utf8'))
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
  });

  it('keeps valid cohort members grouped when one request cannot be prepared', async () => {
    const immediateBuildInput = helpers.buildInput;
    helpers.buildInput = vi.fn(async (prompt, images, curators) => {
      if (path.basename(images[0]) === 'broken.jpg') {
        throw new Error('synthetic preparation failure');
      }
      return immediateBuildInput(prompt, images, curators);
    });
    const provider = new OpenAIBatchProvider({
      client,
      enableFallback: false,
      helpers,
      aggregationWindowMs: 10,
    });
    const imagePaths = ['first.jpg', 'broken.jpg', 'third.jpg']
      .map((name) => path.join(tmpDir, name));
    await Promise.all(imagePaths.map((file) => fs.writeFile(file, 'data')));

    const results = await Promise.allSettled(imagePaths.map((file) =>
      provider.submit({
        levelDir: tmpDir,
        prompt: `stable context\nreview ${path.basename(file)}`,
        images: [file],
        model: 'gpt-5.6-terra',
      })
    ));

    expect(results.map((result) => result.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
    ]);
    const inputsDir = path.join(tmpDir, '.batch', 'inputs');
    const inputFiles = await fs.readdir(inputsDir);
    expect(inputFiles).toHaveLength(1);
    const lines = (await fs.readFile(path.join(inputsDir, inputFiles[0]), 'utf8'))
      .trim()
      .split('\n');
    expect(lines).toHaveLength(2);
  });

  it('splits an aggregate before the configured Batch request limit', async () => {
    const provider = new OpenAIBatchProvider({
      client,
      enableFallback: false,
      helpers,
      aggregationWindowMs: 25,
      maxBatchRequests: 1,
    });
    const firstImage = path.join(tmpDir, '1.jpg');
    const secondImage = path.join(tmpDir, '2.jpg');
    await Promise.all([
      fs.writeFile(firstImage, 'first'),
      fs.writeFile(secondImage, 'second'),
    ]);

    await Promise.all([
      provider.submit({
        levelDir: tmpDir,
        prompt: 'review 1.jpg',
        images: [firstImage],
        model: 'gpt-5.6-terra',
      }),
      provider.submit({
        levelDir: tmpDir,
        prompt: 'review 2.jpg',
        images: [secondImage],
        model: 'gpt-5.6-terra',
      }),
    ]);

    expect(client.files.create).toHaveBeenCalledTimes(2);
    expect(client.batches.create).toHaveBeenCalledTimes(2);
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

  it('rejects incomplete Responses envelopes without returning raw JSON text', async () => {
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

  it('accepts xhigh reasoning effort and uses dynamic output budget', async () => {
    const provider = new OpenAIBatchProvider({ client, enableFallback: false, helpers });
    const imagePath = path.join(tmpDir, 'a.jpg');
    await fs.writeFile(imagePath, 'data');
    const handle = await provider.submit({
      levelDir: tmpDir,
      prompt: 'p'.repeat(1000),
      images: [imagePath],
      model: 'gpt-5.4',
      reasoningEffort: 'xhigh',
      curators: Array.from({ length: 20 }, (_, i) => `Curator ${i}`),
      baseCuratorCount: 10,
      dynamicCuratorCount: 10,
      minutesMax: 77,
      verbosity: 'high',
    });
    const inputsDir = path.join(tmpDir, '.batch', 'inputs');
    const files = await fs.readdir(inputsDir);
    const jsonl = await fs.readFile(path.join(inputsDir, files[0]), 'utf8');
    const line = JSON.parse(jsonl.trim());
    expect(line.body.reasoning.effort).toBe('xhigh');
    expect(line.body.max_output_tokens).toBeGreaterThanOrEqual(64000);
    expect(line.body.max_output_tokens).not.toBe(8192);
    const ticket = JSON.parse(await fs.readFile(path.join(tmpDir, '.batch', 'tickets', `${handle.safeId}.ticket.json`), 'utf8'));
    expect(ticket.output_budget.effort).toBe('xhigh');
    expect(ticket.output_budget.dynamic_curator_count).toBe(10);
  });

  it('serializes an explicit stable-prefix cache plan for GPT-5.6', async () => {
    const stablePrefix = 'Stable curatorial context. '.repeat(300);
    const dynamicSuffix = 'Review only a.jpg.';
    const imagePath = path.join(tmpDir, 'a.jpg');
    await fs.writeFile(imagePath, 'data');
    const provider = new OpenAIBatchProvider({
      client,
      enableFallback: false,
      helpers,
    });

    await provider.submit({
      levelDir: tmpDir,
      prompt: stablePrefix + dynamicSuffix,
      promptCachePrefix: stablePrefix,
      images: [imagePath],
      model: 'gpt-5.6-terra',
      reasoningEffort: 'xhigh',
    });

    const inputsDir = path.join(tmpDir, '.batch', 'inputs');
    const [inputFile] = await fs.readdir(inputsDir);
    const line = JSON.parse(
      await fs.readFile(path.join(inputsDir, inputFile), 'utf8')
    );
    expect(line.body.instructions).toBeUndefined();
    expect(line.body.prompt_cache_options).toEqual({
      mode: 'explicit',
      ttl: '30m',
    });
    expect(line.body.prompt_cache_key).toMatch(
      /^photo-select:v1:[a-f0-9]{32}$/
    );
    expect(
      line.body.input[0].content.map((part) => part.text).join('')
    ).toBe(stablePrefix + dynamicSuffix);
    expect(
      line.body.input[0].content[0].prompt_cache_breakpoint
    ).toEqual({ mode: 'explicit' });
  });

  it('rejects invalid reasoning effort before submission', async () => {
    const provider = new OpenAIBatchProvider({ client, enableFallback: false, helpers });
    await expect(provider.submit({ levelDir: tmpDir, prompt: 'prompt', reasoningEffort: 'extreme' })).rejects.toThrow(/reasoningEffort/);
    expect(client.files.create).not.toHaveBeenCalled();
  });

});
