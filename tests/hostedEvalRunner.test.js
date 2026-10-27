import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runFocusedHostedTests } from '../scripts/eval-hosted-open-weights.mjs';

const roots = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() { const scratch = mkdtempSync(path.join(tmpdir(), 'hosted-runner-test-')); roots.push(scratch); return { root: scratch, scratch }; }
const passed = { numTotalTests: 1, numPassedTests: 1, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults: [] };
// Replace only the external command. Exercise real subprocess buffering and
// report parsing, without recursively launching another Vitest process.
function noisyChild(report, exitCode = 0) {
  return (_file, args, options) => {
    const output = args.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length);
    const code = `require('node:fs').writeFileSync(${JSON.stringify(output)}, ${JSON.stringify(JSON.stringify(report))});process.stdout.write('routine output '.repeat(160000));process.exitCode=${exitCode};`;
    return spawnSync(process.execPath, ['-e', code], options);
  };
}
it('accepts a successful focused run whose routine output exceeds one MiB', () => {
  const result = runFocusedHostedTests({ ...fixture(), spawn: noisyChild(passed) });
  expect(result.numPassedTests).toBe(1);
});
it('reports the actual failed assertion instead of the tail of routine output', () => {
  const report = { ...passed, numPassedTests: 0, numFailedTests: 1, testResults: [{ name: 'contract.test.js', assertionResults: [
    { status: 'failed', fullName: 'filename contract', failureMessages: ['Expected exact whitelist; missing ten.jpg'] },
  ] }] };
  expect(() => runFocusedHostedTests({ ...fixture(), spawn: noisyChild(report, 1) })).toThrow(/filename contract: Expected exact whitelist; missing ten\.jpg/);
});
it('retains the subprocess error code even when routine stdout exists', () => {
  const spawn = () => ({ error: Object.assign(new Error('spawn failed'), { code: 'ENOENT' }), status: null, signal: null, stdout: 'routine output', stderr: '' });
  expect(() => runFocusedHostedTests({ ...fixture(), spawn })).toThrow(/spawn=ENOENT/);
});
