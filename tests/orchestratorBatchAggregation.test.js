import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    getPeople: vi.fn().mockResolvedValue([]),
  };
});

import { getPeople } from '../src/chatClient.js';
import { batchStore } from '../src/batchContext.js';
import { triageDirectory } from '../src/orchestrator.js';
import OpenAIBatchProvider from '../src/providers/openai-batch.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('orchestrator Batch aggregation', () => {
  let tmpDir;
  let promptFile;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-orchestrator-batch-'));
    promptFile = path.join(tmpDir, 'prompt.txt');
    await fs.writeFile(
      promptFile,
      'Curators: {{curators}}\nReview exactly these files:\n{{images}}'
    );
    await Promise.all(Array.from({ length: 11 }, (_, index) =>
      fs.writeFile(path.join(tmpDir, `${index + 1}.jpg`), 'image')
    ));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('coalesces active workers before delayed people lookup reaches the provider', async () => {
    let peopleCall = 0;
    getPeople.mockImplementation(async () => {
      peopleCall += 1;
      if (peopleCall === 1) await wait(100);
      return ['Alice'];
    });

    let fileId = 0;
    let batchId = 0;
    const preparationContexts = [];
    const client = {
      files: {
        create: vi.fn(async () => ({ id: `file_${++fileId}` })),
      },
      batches: {
        create: vi.fn(async () => ({
          id: `batch_${++batchId}`,
          status: 'validating',
        })),
      },
    };
    const provider = new OpenAIBatchProvider({
      client,
      enableFallback: false,
      aggregationWindowMs: 10,
      helpers: {
        buildInput: async (prompt, images) => {
          preparationContexts.push(batchStore.getStore()?.batch);
          return {
            instructions: prompt,
            input: [{ role: 'user', content: [] }],
            used: images,
          };
        },
        schemaForBatch: () => ({
          name: 'PhotoSelectOrchestratorAggregation',
          schema: { type: 'object', properties: {} },
        }),
      },
    });
    vi.spyOn(provider, 'collect').mockImplementation(async (handle) => {
      const json = {
        minutes: [],
        decisions: handle.used.map((file) => ({
          filename: path.basename(file),
          decision: 'keep',
          reason: '',
        })),
      };
      return { raw: JSON.stringify(json), json };
    });

    await triageDirectory({
      dir: tmpDir,
      promptPath: promptFile,
      provider,
      model: 'gpt-5.6-terra',
      workers: 2,
      recurse: false,
      curators: ['Base Curator'],
    });

    const inputDir = path.join(tmpDir, '_level-001', '.batch', 'inputs');
    const inputFiles = await fs.readdir(inputDir);
    expect(inputFiles).toHaveLength(1);
    const rows = (await fs.readFile(path.join(inputDir, inputFiles[0]), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(rows).toHaveLength(2);
    expect(preparationContexts.sort((a, b) => a - b)).toEqual([1, 2]);
    expect(rows.some((row) =>
      row.body.instructions?.includes('Curators: Base Curator, Alice')
    )).toBe(true);
  });
});
