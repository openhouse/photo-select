import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { estimateHostedCost, evaluateHostedProposal, evaluateXiaomiProfile } from '../src/core/hostedOpenWeights.js';

const testFiles = ['tests/hostedOpenWeights.test.js', 'tests/hostedEvalRunner.test.js', 'tests/deepinfraProvider.test.js',
  'tests/deepinfraErrors.test.js', 'tests/deepinfraCli.test.js', 'tests/deepinfraWorkflow.test.js', 'tests/hostedRun.test.js',
  'tests/xiaomiProvider.test.js', 'tests/xiaomiCli.test.js', 'tests/xiaomiWorkflow.test.js', 'tests/xiaomiLauncher.test.js',
  'tests/hostedConcurrency.test.js', 'tests/xiaomiParallelLauncher.test.js'];
export function runFocusedHostedTests({ root, scratch, spawn = spawnSync }) {
  const testResult = path.join(scratch, 'vitest.json');
  const run = spawn(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...testFiles, '--maxWorkers=1', '--minWorkers=1', '--reporter=json', `--outputFile=${testResult}`], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  let result, reportError;
  try { result = JSON.parse(readFileSync(testResult, 'utf8')); }
  catch (error) { reportError = error.code || error.message; }
  if (run.error || run.status !== 0 || !result?.numTotalTests || result.numFailedTests || result.numPendingTests || result.numTodoTests) {
    const details = [`exit=${run.status ?? 'unknown'}`, `signal=${run.signal || 'none'}`];
    if (run.error) details.push(`spawn=${run.error.code || run.error.name}: ${run.error.message}`);
    if (reportError) details.push(`report=${reportError}`);
    const failures = (result?.testResults || []).flatMap(file => {
      const assertions = (file.assertionResults || []).filter(test => test.status === 'failed')
        .map(test => `${test.fullName}: ${(test.failureMessages || []).join('\n')}`);
      return assertions.length ? assertions : file.message ? [`${file.name}: ${file.message}`] : [];
    });
    if (failures.length) details.push(failures.join('\n').slice(0, 12000));
    else details.push((run.stderr || run.stdout || 'No child diagnostics.').slice(-4000));
    throw new Error(`Focused eval failed: ${details.join('\n')}`);
  }
  return result;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = mkdtempSync(path.join(tmpdir(), 'hosted-weights-eval-'));
const json = file => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
try {
  const proposal = json('evals/hosted-open-weights.json'), graph = json('wiki/graph.json');
  const xiaomi = json('evals/xiaomi-open-weights.json');
  const historicalPilotBytes = readFileSync(path.join(root, 'evals/reports/xiaomi-direct-compatibility-pilot-2026-10-26.json'));
  const xiaomiFailures = evaluateXiaomiProfile({ profile: xiaomi, historicalPilot: JSON.parse(historicalPilotBytes),
    historicalPilotSha256: createHash('sha256').update(historicalPilotBytes).digest('hex') });
  if (xiaomiFailures.length) throw new Error(`Xiaomi profile rejected: ${xiaomiFailures.join(', ')}`);
  const files = execFileSync('git', ['-c', 'core.excludesFile=/dev/null', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0').filter(file => file && existsSync(path.join(root, file)));
  const documents = Object.fromEntries((graph.nodes || []).filter(n => n.path && files.includes(n.path)).map(n => [n.path, readFileSync(path.join(root, n.path), 'utf8')]));
  const failures = evaluateHostedProposal({ proposal, graph, files, documents });
  if (failures.length) throw new Error(`Proposal or graph rejected: ${failures.join(', ')}`);
  const inputs = [...new Set(['AGENTS.md', 'README.md', '.env.example', 'package.json', 'package-lock.json', 'evals/hosted-open-weights.json',
    'evals/xiaomi-open-weights.json', xiaomi.historicalPilot.path, 'wiki/graph.json',
    'scripts/eval-hosted-open-weights.mjs', ...testFiles, ...files.filter(file => file.startsWith('src/') || file.startsWith('prompts/')),
    ...graph.nodes.filter(n => n.path).map(n => n.path)])].sort();
  const fingerprint = () => Object.fromEntries(inputs.map(file => [file, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')]));
  const before = fingerprint(), result = runFocusedHostedTests({ root, scratch });
  if (JSON.stringify(before) !== JSON.stringify(fingerprint())) throw new Error('Evaluated inputs changed during evaluation');
  const usage = { inputTokens: 100000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 10000, reasoningTokens: null, outputIncludesReasoning: true };
  const report = { schemaVersion: 1, scope: 'offline-hosted-provider-runtime-graph-and-cost-contract', status: 'passed',
    inputSha256: before, graph: { nodes: graph.nodes.length, edges: graph.edges.length },
    tests: { passed: result.numPassedTests, failed: result.numFailedTests, skipped: result.numPendingTests },
    stage: proposal.stage, implementation: proposal.implementation, ready: false, modelRequests: 0, sourceAccess: false,
    xiaomi: { provider: xiaomi.provider, model: xiaomi.model, implementation: xiaomi.implementation,
      maxImages: xiaomi.maxImages, responseMode: xiaomi.responseMode, concurrency: xiaomi.concurrency,
      ready: xiaomi.ready, historicalPilot: xiaomi.historicalPilot },
    syntheticContractChecks: result.testResults.map(file => ({ file: path.relative(root, file.name),
      passed: file.assertionResults.filter(test => test.status === 'passed').length,
      jsonAndRepairCases: /(?:deepinfra|xiaomi)(?:Provider|Workflow)\.test\.js$/.test(file.name)
        ? file.assertionResults.filter(test => /json|repair|truncat/i.test(test.fullName)).map(test => test.fullName) : [] })),
    json_validity_rate: null, retry_recovery_rate: null, visualUsefulness: 'unmeasured',
    illustrativeCost: { provider: proposal.provider, model: proposal.model, usage, ...estimateHostedCost({ ...proposal, usage }) },
    xiaomiIllustrativeCost: { provider: xiaomi.provider, model: xiaomi.model, usage, ...estimateHostedCost({ ...xiaomi, usage }) },
    actualUsage: null, actualCostUsd: null,
    limitation: 'Named synthetic contract checks exercise local runtime behavior. Their pass counts are not model JSON-validity or retry-recovery samples. This offline receipt does not measure live acceptance, cache behavior, visual usefulness or savings; bounded live results are recorded separately.' };
  mkdirSync(path.join(root, 'evals/reports'), { recursive: true });
  writeFileSync(path.join(root, 'evals/reports/hosted-open-weights.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`OBSERVATION: ${error.message}\nFEELING: concerned\nNEED: contract integrity\nREQUEST: Repair the candidate and rerun the offline hosted-weights eval.`);
  process.exitCode = 1;
} finally { rmSync(scratch, { recursive: true, force: true }); }
}
