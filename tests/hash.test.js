import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../src/hash.js';

describe('sha256', () => {
  it('produces stable hashes for file contents', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hash-'));
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, 'hello');
    const h1 = await sha256(file);
    const h2 = await sha256(file);
    expect(h1).toBe(h2);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
