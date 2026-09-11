import { evaluateGithubReadiness, evaluateGithubCanary } from '../evals/evaluate-curation-exploration.mjs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = 'evals/reports/knowledge-context.json';
const testFiles = ['tests/knowledgeContext.test.js', 'tests/liveExploration.test.js', 'tests/knowledgeLive.test.js', 'tests/knowledgeRun.test.js', 'tests/cliKnowledge.test.js', 'tests/knowledgeOrchestrator.test.js', 'tests/curationExploration.test.js', 'tests/githubBridge.test.js', 'tests/githubCuration.test.js', 'tests/githubBatch.test.js', 'tests/githubRun.test.js', 'tests/knowledgeLauncher.test.js', 'tests/cliGithub.test.js', 'tests/cliPrivateOutput.test.js', 'tests/githubCanary.test.js'];
function fingerprint() {
  const files = [...new Set(execFileSync('git', ['-c', 'core.excludesFile=/dev/null', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\0'))]
    .filter(p => p && p !== reportPath).sort();
  const hash = createHash('sha256');
  for (const file of files) hash.update(file).update('\0').update(createHash('sha256').update(readFileSync(path.join(root, file))).digest()).update('\0');
  return { sha256: hash.digest('hex'), files: files.length };
}
const scratch = mkdtempSync(path.join(tmpdir(), 'knowledge-eval-'));
try {
  const before = fingerprint();
  const jsonPath = path.join(scratch, 'vitest.json');
  const run = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', ...testFiles, '--maxWorkers=2', '--minWorkers=2', '--reporter=json', `--outputFile=${jsonPath}`], { cwd: root, encoding: 'utf8' });
  if (run.error || run.status !== 0) {
    console.error((run.stderr || run.stdout || String(run.error)).slice(-6000));
    throw new Error('Focused eval failed; inspect the failing suite above.');
  }
  const result = JSON.parse(readFileSync(jsonPath, 'utf8'));
  if (testFiles.some(file => !result.testResults.some(suite => path.resolve(suite.name) === path.join(root, file)))) throw new Error('An expected eval suite did not run.');
  if (result.numTotalTests < 1 || result.numFailedTests || result.numPendingTests || result.numTodoTests) throw new Error('Incomplete eval result.');
  if (fingerprint().sha256 !== before.sha256) throw new Error('Candidate changed during evaluation.');
  const readiness = JSON.parse(readFileSync(path.join(root, 'evals/github-inference-readiness.json'), 'utf8'));
  const unmetGates = evaluateGithubReadiness(readiness.gates);
  if (readiness.liveEvidence) {
    const receipt = JSON.parse(readFileSync(path.join(root, readiness.liveEvidence), 'utf8'));
    const actualHashes = {};
    for (const file of Object.keys(receipt.implementationSha256 || {})) {
      if (path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Invalid canary implementation path.');
      actualHashes[file] = createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
    }
    const failures = evaluateGithubCanary(receipt, actualHashes);
    if (failures.length && readiness.gates.privateGithubDuringCuration === 'passed') throw new Error('Live canary evidence is stale or incomplete: ' + failures.join(', '));
  } else if (readiness.gates.privateGithubDuringCuration === 'passed') throw new Error('Live GitHub acceptance evidence is missing.');
  if (readiness.ready !== (unmetGates.length === 0)) throw new Error('GitHub readiness disagrees with its acceptance gates.');
  const report = { schemaVersion: 1, scope: 'offline-contract-and-implementation', candidate: before,
    githubDuringCuration: { ready: readiness.ready, unmetGates },
    passed: result.numPassedTests, failed: result.numFailedTests, skipped: result.numPendingTests,
    sourceAccess: false, modelRequests: 0, publicationAuthority: 'none',
    json_validity_rate: null, retry_recovery_rate: null, usefulness: 'unmeasured',
    limitation: 'Offline reference and implementation tests mock network boundaries. Actual source access and model canaries are recorded separately; editorial usefulness and general model resistance remain unmeasured.' };
  mkdirSync(path.join(root, 'evals/reports'), { recursive: true });
  writeFileSync(path.join(root, reportPath), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(`OBSERVATION: ${error.message}\nFEELING: concerned\nNEED: contract integrity\nREQUEST: Repair the candidate and rerun the focused eval.`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
