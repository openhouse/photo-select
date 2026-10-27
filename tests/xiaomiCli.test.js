import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile), roots = [];
const cli = fileURLToPath(new URL('../src/index.js', import.meta.url));
const launcher = fileURLToPath(new URL('../photo-select-here.sh', import.meta.url));
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function run(args = [], { provider = 'xiaomi', env: overrides = {}, throughLauncher = false, observe = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaomi-cli-')); roots.push(root);
  const brief = path.join(root, 'brief.txt'); await fs.writeFile(brief, 'Complete exhibition context.\nKeep every paragraph.');
  const loader = path.join(root, 'loader.mjs');
  const stub = `import fs from 'node:fs/promises';export async function triageDirectory(options){console.log('OBSERVED='+JSON.stringify({...options,provider:options.provider.name,effectiveBatchSize:Number(process.env.PHOTO_SELECT_BATCH_SIZE),context:options.contextPath?await fs.readFile(options.contextPath,'utf8'):null}));}`;
  await fs.writeFile(loader, `export async function resolve(specifier,context,next){if(specifier==='./orchestrator.js'&&context.parentURL?.endsWith('/src/index.js'))return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(stub)}),shortCircuit:true};return next(specifier,context);}`);
  const env = { ...process.env, PATH: path.dirname(process.execPath) + ':' + process.env.PATH, NVM_DIR: path.join(root, 'absent-nvm'), DOTENV_CONFIG_PATH: path.join(root, 'absent.env'), NODE_NO_WARNINGS: '1', OPENAI_API_KEY: '', DEEPINFRA_API_KEY: 'synthetic-deepinfra-key', MIMO_API_KEY: 'synthetic-mimo-key', MIMO_BASE_URL: '', DEEPINFRA_BASE_URL: '', PHOTO_SELECT_MODEL: '', PHOTO_SELECT_PROVIDER: '', PHOTO_SELECT_REASONING_EFFORT: '', PHOTO_SELECT_VERBOSITY: '', PHOTO_SELECT_RETRY_NEEDS_REVIEW: '0', PHOTO_SELECT_ADAPTIVE_WORKERS: '0', PHOTO_SELECT_DISABLE_PEOPLE: '1', PHOTO_SELECT_HOSTED_BASE: path.join(root, 'audit'), ...overrides };
  const flags = ['--provider', provider, ...args.map(arg => arg === '$BRIEF' ? brief : arg)];
  let command, commandArgs;
  if (throughLauncher) { command = 'bash'; commandArgs = [launcher, ...flags]; if (observe) env.NODE_OPTIONS = '--loader=' + loader; }
  else { command = process.execPath; commandArgs = [...(observe ? ['--loader', loader] : []), cli, '--dir', root, ...flags]; }
  try { return { ...await exec(command, commandArgs, { cwd: root, env, timeout: 15000 }), code: 0, root }; }
  catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code, root }; }
}
const readObserved = result => JSON.parse(result.stdout.split('\n').find(line => line.startsWith('OBSERVED=')).slice('OBSERVED='.length));

describe('Xiaomi through the ordinary launcher', () => {
  it('defaults to ten-image requests, one worker and automatic reasoning', async () => {
    const result = await run([], { observe: true }); expect(result.code, result.stderr).toBe(0);
    expect(readObserved(result)).toMatchObject({ provider: 'xiaomi', model: 'mimo-v2.6-pro', batchSize: 10, workers: 1, reasoningEffort: 'auto', recurse: true });
  });
  it('preserves caller directory, seventeen exact curators, context and the recursive stopping target', async () => {
    const curators = ['Prof. Ingeborg Gerdes', 'Prof. Warren Sack', 'Yehuda Katz', 'Vivian Gornick', 'Zora Neale Hurston', 'Deborah Treisman', 'Curator 07 (artist)', 'Curator 08', 'Curator 09', 'Curator 10', 'Curator 11', 'Curator 12', 'Curator 13', 'Curator 14', 'Curator 15', 'Curator 16', 'Curator 17'];
    const result = await run(['--batch-size', '10', '--target-level-size', '10', '--curators', curators.join(','), '--context', '$BRIEF'], { observe: true, throughLauncher: true });
    expect(result.code, result.stderr).toBe(0);
    expect(readObserved(result)).toMatchObject({ dir: await fs.realpath(result.root), batchSize: 10, targetLevelSize: 10, curators, context: 'Complete exhibition context.\nKeep every paragraph.', recurse: true });
  });
  it('keeps request size independent of target-level-size', async () => {
    const result = await run(['--batch-size', '7', '--target-level-size', '10'], { observe: true });
    expect(result.code, result.stderr).toBe(0); expect(readObserved(result)).toMatchObject({ batchSize: 7, targetLevelSize: 10 });
  });
  it.each(['0', '-1', '1.5', 'abc'])('rejects an invalid request batch size (%s)', async value => {
    const result = await run(['--batch-size', value]); expect(result.code).not.toBe(0); expect(result.stderr).toMatch(/positive integer/);
  });
  it('rejects request sizes above the global ten-image limit', async () => {
    const result = await run(['--batch-size', '11']); expect(result.code).not.toBe(0); expect(result.stderr).toMatch(/10/); expect(result.stdout).not.toContain('private audit');
  });
  it('preserves the dedicated DeepInfra four-image limit', async () => {
    const result = await run(['--batch-size', '5'], { provider: 'deepinfra' }); expect(result.code).not.toBe(0); expect(result.stderr).toMatch(/4/); expect(result.stdout).not.toContain('private audit');
  });
  it.each([{args:['--workers','3']}, {args:['--workers','50','--adaptive-workers','--adaptive-min-workers','1']}, {args:['--workers','3','--concurrency','2']}])('accepts a genuine Xiaomi parallel ceiling ($args)', async ({args}) => {
    const result = await run(args,{observe:true}); expect(result.code,result.stderr).toBe(0); expect(readObserved(result).batchSize).toBe(10);
  });
  it.each([{args:['--workers','51']}, {args:['--workers','0']}, {args:['--workers','1.5']}, {args:['--workers','abc']}, {args:['--workers','3','--concurrency','1.5']}, {args:['--workers','3','--adaptive-min-workers','4','--adaptive-workers']}, {args:['--workers','2','--concurrency','3']}, {args:['--retry-needs-review']}])('holds an invalid Xiaomi capacity or generic retry request ($args)', async ({args}) => {
    const result = await run(args); expect(result.code).not.toBe(0); expect(result.stderr).toMatch(/Xiaomi|workers/); expect(result.stdout).not.toContain('private audit');
  });
  it('ignores an inherited adaptive minimum when fixed Xiaomi capacity is selected',async()=>{
    const result=await run(['--workers','3'],{observe:true,env:{PHOTO_SELECT_ADAPTIVE_MIN_WORKERS:'4'}});expect(result.code,result.stderr).toBe(0);expect(readObserved(result).workers).toBe(3);
  });
  it.each(['xhigh', 'minimal', 'high'])('rejects an unverified reasoning setting (%s)', async effort => {
    const result = await run(['--reasoning-effort', effort]); expect(result.code).not.toBe(0); expect(result.stderr).toContain('auto'); expect(result.stdout).not.toContain('private audit');
  });
  it('requires its dedicated credential even if another provider is authorized', async () => {
    const result = await run([], { env: { MIMO_API_KEY: '', OPENAI_API_KEY: 'synthetic-openai-key' } }); expect(result.code).not.toBe(0); expect(result.stderr).toContain('MIMO_API_KEY'); expect(result.stdout).not.toContain('private audit');
  });
  it('holds an OpenAI key flag and explicit verbosity', async () => {
    for (const args of [['--api-key','synthetic-wrong-key'], ['--verbosity','high']]) {
      const result = await run(args); expect(result.code).not.toBe(0); expect(result.stderr).toMatch(/MIMO_API_KEY|verbosity/); expect(result.stdout).not.toContain('private audit');
    }
  });
  it.each([{provider:'openai',args:['--workers','1'],want:8}, {provider:'openai-batch',args:['--model','gpt-6.1-terra','--workers','50','--adaptive-workers','--reasoning-effort','xhigh'],want:10}, {provider:'ollama',args:['--batch-size','3'],want:3}])('preserves other provider batch defaults or an explicit override ($provider)', async ({provider,args,want}) => {
    const result=await run(args,{provider,observe:true,env:{OPENAI_API_KEY:'synthetic-openai-key'}});expect(result.code,result.stderr).toBe(0);expect(readObserved(result).effectiveBatchSize).toBe(want);
    if(provider==='openai-batch')expect(readObserved(result)).toMatchObject({workers:50,reasoningEffort:'xhigh'});
  });
  it.each(['--github-all', '--knowledge-live'])('holds unsupported knowledge transports (%s)', async flag => {
    const result = await run([flag]); expect(result.code).not.toBe(0); expect(result.stderr).toContain('openai'); expect(result.stdout).not.toContain('private audit');
  });
});
