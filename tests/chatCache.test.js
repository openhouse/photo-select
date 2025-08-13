import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeCache, readCache } from '../src/chatCache.js';

const cacheDir = path.resolve('.cache');

beforeEach(async () => {
  await fs.rm(cacheDir, { recursive: true, force: true });
});

afterEach(async () => {
  await fs.rm(cacheDir, { recursive: true, force: true });
});

describe('chatCache', () => {
  it('writeCache skips zero-decision entries', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await writeCache('t1', JSON.stringify({ decisions: [] }));
    await expect(fs.stat(path.join(cacheDir, 't1.txt'))).rejects.toBeTruthy();
    log.mockRestore();
  });

  it('readCache evicts zero-decision entries', async () => {
    await fs.mkdir(cacheDir, { recursive: true });
    const p = path.join(cacheDir, 't2.txt');
    await fs.writeFile(p, JSON.stringify({ decisions: [] }), 'utf8');
    const val = await readCache('t2');
    expect(val).toBeNull();
    await expect(fs.stat(p)).rejects.toBeTruthy();
  });
});
