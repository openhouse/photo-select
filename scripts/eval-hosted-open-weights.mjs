import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateHostedCost, evaluateHostedProposal } from '../src/core/hostedOpenWeights.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(path.join(tmpdir(), 'hosted-weights-eval-'));
const json = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
try {
  const proposal = json('evals/hosted-open-weights.json'), graph = json('wiki/graph.json');
  const files = execFileSync('git', ['-c', 'core.excludesFile=/dev/null', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file && existsSync(path.join(root, file)));
  const documents = Object.fromEntries((graph.nodes || []).filter(n => n.path && files.includes(n.path)).map(n => [n.path, readFileSync(path.join(root, n.path), 'utf8')]));
  const failures = evaluateHostedProposal({ proposal, graph, files, documents });
  if (failures.length) throw new Error(`Proposal or graph rejected: ${failures.join(', ')}`);
  const inputs = [...new Set(['package.json', 'evals/hosted-open-weights.json', 'wiki/graph.json',
    'src/core/hostedOpenWeights.js', 'tests/hostedOpenWeights.test.js', 'scripts/eval-hosted-open-weights.mjs',
    ...graph.nodes.filter(n => n.path).map(n => n.path)])].sort();
  const fingerprint = () => Object.fromEntries(inputs.map(file => [file, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')]));
  const before = fingerprint(), testResult = path.join(scratch, 'vitest.json');
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/hostedOpenWeights.test.js', '--maxWorkers=2', '--minWorkers=2', '--reporter=json', `--outputFile=${testResult}`], { cwd: root, encoding: 'utf8' });
  if (run.error || run.status !== 0) throw new Error(`Focused eval failed: ${(run.stderr || run.stdout || String(run.error)).slice(-4000)}`);
  const result = JSON.parse(readFileSync(testResult, 'utf8'));
  if (!result.numTotalTests || result.numFailedTests || result.numPendingTests || result.numTodoTests) throw new Error('Incomplete focused evaluation');
  if (JSON.stringify(before) !== JSON.stringify(fingerprint())) throw new Error('Evaluated inputs changed during evaluation');
  const usage = { inputTokens: 100000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10000, reasoningTokens: null, outputIncludesReasoning: true };
  const report = { schemaVersion: 1, scope: 'offline-proposal-graph-and-cost-contract', status: 'passed',
    inputSha256: before, graph: { nodes: graph.nodes.length, edges: graph.edges.length },
    tests: { passed: result.numPassedTests, failed: result.numFailedTests, skipped: result.numPendingTests },
    stage: proposal.stage, ready: false, modelRequests: 0, sourceAccess: false,
    json_validity_rate: null, retry_recovery_rate: null, visualUsefulness: 'unmeasured',
    illustrativeCost: { provider: proposal.provider, model: proposal.model, usage, ...estimateHostedCost({ ...proposal, usage }) },
    actualUsage: null, actualCostUsd: null,
    limitation: 'Synthetic contract tests and an authored graph do not establish provider compatibility, live JSON validity, visual usefulness, cache behavior, or measured savings.' };
  mkdirSync(path.join(root, 'evals/reports'), { recursive: true });
  writeFileSync(path.join(root, 'evals/reports/hosted-open-weights.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`OBSERVATION: ${error.message}\nFEELING: concerned\nNEED: contract integrity\nREQUEST: Repair the candidate and rerun the offline hosted-weights eval.`);
  process.exitCode = 1;
} finally { rmSync(scratch, { recursive: true, force: true }); }
