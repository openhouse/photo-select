import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
describe('--adaptive-workers', () => {
  it('advertises an opt-in adaptive window with the existing workers value as its ceiling', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ['src/index.js', '--help'],
      { cwd: process.cwd() }
    );
    expect(stdout).toContain('--adaptive-workers');
    expect(stdout).toContain('--adaptive-min-workers <n>');
    expect(stdout).toMatch(/dynamically tune OpenAI request concurrency/i);
  });
  it('rejects a minimum greater than the workers ceiling', async () => {
    await expect(
      execFileAsync(
        process.execPath,
        ['src/index.js', '--provider', 'ollama', '--adaptive-workers',
          '--adaptive-min-workers', '6', '--workers', '5'],
        { cwd: process.cwd() }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('cannot exceed --workers'),
    });
  });
});
