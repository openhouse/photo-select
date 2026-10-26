import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../src/index.js', import.meta.url));
const roots = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function run(args = [], overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deepinfra-cli-')); roots.push(root);
  const env = { ...process.env, DOTENV_CONFIG_PATH: path.join(root, 'absent.env'), OPENAI_API_KEY: '', DEEPINFRA_API_KEY: 'synthetic-deepinfra-key', DEEPINFRA_BASE_URL: '', PHOTO_SELECT_PROVIDER: '', PHOTO_SELECT_MODEL: '', PHOTO_SELECT_REASONING_EFFORT: '', PHOTO_SELECT_VERBOSITY: '', PHOTO_SELECT_DISABLE_PEOPLE: '1', PHOTO_SELECT_HOSTED_BASE: path.join(root, 'audit'), ...overrides };
  try { return { ...await exec(process.execPath, [cli, '--provider', 'deepinfra', '--dir', root, '--no-recurse', ...args], { cwd: root, env, timeout: 15000 }), code: 0 }; }
  catch (err) { return { code: err.code, stdout: err.stdout, stderr: err.stderr }; }
}

describe('dedicated DeepInfra CLI boundary', () => {
  it('can scan an empty directory with only a DeepInfra credential', async () => {
    const result = await run();
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('Finished triaging');
  });
  it('does not use an OpenAI credential when the DeepInfra credential is missing', async () => {
    const result = await run([], { DEEPINFRA_API_KEY: '', OPENAI_API_KEY: 'synthetic-openai-key' });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('DEEPINFRA_API_KEY is missing');
    expect(result.stdout).not.toContain('Scanning');
  });
  it('rejects the OpenAI key flag rather than routing it to DeepInfra', async () => {
    const result = await run(['--api-key', 'synthetic-wrong-destination']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('DEEPINFRA_API_KEY');
    expect(result.stdout).not.toContain('Scanning');
  });
  it.each(['https://evil.example/v1/openai', 'http://api.deepinfra.com/v1/openai', 'https://api.deepinfra.com.evil.example/v1/openai'])('rejects a credential destination outside the official endpoint (%s)', async endpoint => {
    const result = await run([], { DEEPINFRA_BASE_URL: endpoint });
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/official HTTPS endpoint|https:\/\/api.deepinfra.com\/v1\/openai/);
    expect(result.stdout).not.toContain('Scanning');
  });
  it.each(['--github-all', '--knowledge-live', '--knowledge-discover', '--knowledge-research-only'])('rejects unsupported knowledge mode before scanning (%s)', async mode => {
    const result = await run([mode]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/openai/);
    expect(result.stdout).not.toContain('Scanning');
  });
  it.each([{args: ['--workers', '2']}, {args: ['--adaptive-workers']}, {args: ['--retry-needs-review']}])('holds unverified hosted capacity or generic repair options ($args)', async ({args}) => {
    const result = await run(args);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('DeepInfra');
    expect(result.stdout).not.toContain('Scanning');
  });
  it('holds an unverified model before inspecting or uploading the corpus', async () => {
    const result = await run(['--model', 'unverified/model']);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('XiaomiMiMo/MiMo-V2.6-Pro');
    expect(result.stdout).not.toContain('Scanning');
    expect(result.stdout).not.toContain('private audit');
  });
  it.each([{args: ['--verbosity', 'high'], env: {}}, {args: [], env: {PHOTO_SELECT_VERBOSITY: 'high'}}])('holds an explicit unsupported verbosity request ($args)', async ({args, env}) => {
    const result = await run(args, env);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('verbosity');
    expect(result.stdout).not.toContain('Scanning');
  });
  it.each(['minimal', 'low', 'medium', 'high', 'xhigh'])('rejects unverified MiMo reasoning instead of silently mapping it (%s)', async effort => {
    const result = await run(['--reasoning-effort', effort]);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('auto');
    expect(result.stdout).not.toContain('Scanning');
  });
});

it('runs the actual CLI, adapter and private journal with only the hosted transport substituted', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deepinfra-cli-flow-')); roots.push(root);
  const source = path.join(root, 'photos'), audit = path.join(root, 'audit'), calls = path.join(root, 'calls.jsonl');
  await fs.mkdir(source);
  const sharp = (await import('sharp')).default;
  const jpeg = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#807060' } }).jpeg().toBuffer();
  await Promise.all(['keep.jpg', 'aside.jpg'].map(name => fs.writeFile(path.join(source, name), jpeg)));
  const implementation = new URL('../src/providers/deepinfra.js', import.meta.url).href;
  const wrapper = `import fs from 'node:fs/promises';import DeepInfraProvider from ${JSON.stringify(implementation)};
    export async function getProvider(name, options) {
      if (name !== 'deepinfra') throw Error('Wrong provider');
      return new DeepInfraProvider({...options,fetch:async(url, init)=>{
        if(url!=='https://api.deepinfra.com/v1/openai/chat/completions'||init.headers.Authorization!=='Bearer synthetic-deepinfra-key')throw Error('Wrong credential destination');
        if(process.env.TEST_HTTP402==='1'){await fs.appendFile(process.env.TEST_CALLS,JSON.stringify({url,status:402})+'\\n');return new Response(JSON.stringify({error:{message:'Add more credits.'}}),{status:402,headers:{'content-type':'application/json'}});}
        const request=JSON.parse(init.body),schema=request.response_format.json_schema.schema;
        const labels=request.messages[1].content.filter(part=>part.type==='text').flatMap(part=>{try{const value=JSON.parse(part.text);return value.filename?[value]:[];}catch{return [];}});
        const json=schema.required.includes('field_notes_md')?{field_notes_md:'# Completed sequence\\n\\nGrounded photographic notes.'}:{minutes:Array.from({length:schema.properties.minutes.minItems},()=>({speaker:'Ingeborg Gerdes',text:'Visible light gives the sequence a rhythm; what should follow?'})),decisions:labels.map(label=>({filename:label.filename,decision:label.filename==='keep.jpg'?'keep':'aside',reason:'Visible photographic evidence.'})),...(schema.required.includes('field_notes_diff')?{field_notes_diff:'--- old\\n+++ new\\n@@ -0,0 +1 @@\\n+# Completed sequence'}:{})};
        await fs.appendFile(process.env.TEST_CALLS,JSON.stringify({url,request})+'\\n');
        return new Response(JSON.stringify({id:'synthetic-completion',object:'chat.completion',created:1,model:request.model,choices:[{index:0,message:{role:'assistant',content:JSON.stringify(json)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:0,cache_write_tokens:0},completion_tokens_details:{reasoning_tokens:0}}}),{status:200,headers:{'content-type':'application/json'}});
      }});
    }`;
  const loader = path.join(root, 'loader.mjs');
  await fs.writeFile(loader, `export async function resolve(specifier,context,next){if(specifier==='./providers/index.js'&&context.parentURL?.endsWith('/src/index.js'))return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(wrapper)}),shortCircuit:true};return next(specifier,context);}`);
  const env = { ...process.env, NODE_NO_WARNINGS: '1', DOTENV_CONFIG_PATH: path.join(root, 'absent.env'), OPENAI_API_KEY: '', OPENAI_BASE_URL: 'https://wrong-openai.example', DEEPINFRA_API_KEY: 'synthetic-deepinfra-key', DEEPINFRA_BASE_URL: '', PHOTO_SELECT_HOSTED_BASE: audit, PHOTO_SELECT_DISABLE_PEOPLE: '1', PHOTO_SELECT_REASONING_EFFORT: '', PHOTO_SELECT_VERBOSITY: '', PHOTO_SELECT_MODEL: '', PHOTO_SELECT_DEBUG_DIR: root, TEST_CALLS: calls };
  const result = await exec(process.execPath, ['--loader', loader, cli, '--provider', 'deepinfra', '--dir', source, '--no-recurse', '--field-notes'], { cwd: root, env, timeout: 20000 });
  expect(result.stdout).toContain('Finished triaging');
  expect((await fs.readdir(source)).filter(name => name.endsWith('.jpg'))).toEqual([]);
  expect(await fs.readdir(path.join(source, '_keep'))).toContain('keep.jpg');
  expect(await fs.readdir(path.join(source, '_aside'))).toContain('aside.jpg');
  expect(await fs.readFile(path.join(source, '_level-001', 'field-notes.md'), 'utf8')).toContain('# Completed sequence');
  const sent = (await fs.readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
  expect(sent).toHaveLength(2);
  expect(sent.every(call => call.request.model === 'XiaomiMiMo/MiMo-V2.6-Pro' && call.request.stream === false && call.request.response_format.json_schema.strict === true)).toBe(true);
  const privateRoot = path.join(audit, (await fs.readdir(audit))[0]);
  const receipts = await Promise.all((await fs.readdir(path.join(privateRoot, 'requests'))).map(async name => JSON.parse(await fs.readFile(path.join(privateRoot, 'requests', name), 'utf8'))));
  expect(receipts).toHaveLength(2);
  expect(receipts.every(receipt => receipt.status === 'completed' && receipt.identity.provider === 'deepinfra')).toBe(true);
  expect(await fs.readFile(path.join(privateRoot, 'field-notes.md'), 'utf8')).toContain('# Completed sequence');
  const git = await exec('git', ['-C', privateRoot, 'status', '--porcelain']);
  expect(git.stdout).toBe('');
  const billingSource = path.join(root, 'billing-photos'); await fs.mkdir(billingSource);
  await fs.writeFile(path.join(billingSource, 'keep.jpg'), jpeg);
  const billingArgs = ['--loader', loader, cli, '--provider', 'deepinfra', '--dir', billingSource, '--no-recurse'];
  const billing = await exec(process.execPath, billingArgs, { cwd: root, env: { ...env, TEST_HTTP402: '1' }, timeout: 15000 }).catch(error => error);
  expect(billing.code).toBe(75);
  expect(billing.stderr).toContain('DeepInfra API credits exhausted');
  expect(await fs.readdir(billingSource)).toContain('keep.jpg');
  expect(await fs.readFile(path.join(billingSource, '_level-001', '.batch', 'billing-pause.json'), 'utf8')).toContain('billing_exhausted');
  const resumed = await exec(process.execPath, billingArgs, { cwd: root, env: { ...env, TEST_HTTP402: '1' }, timeout: 15000 }).catch(error => error);
  expect(resumed.code).toBe(75);
  const allCalls = (await fs.readFile(calls, 'utf8')).trim().split('\n').map(JSON.parse);
  expect(allCalls.filter(call => call.status === 402)).toHaveLength(1);
}, 25000);

it.each(['repair', 'billing'])('reports a hosted %s hold through the CLI without a paid retry', async scenario => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deepinfra-cli-hold-')); roots.push(root);
  const loader = path.join(root, 'loader.mjs');
  const implementation = scenario === 'repair'
    ? `export async function triageDirectory(){throw Object.assign(Error('Synthetic terminal repair.'),{code:'DEEPINFRA_HELD',repairSuggestion:{type:'repair_suggestion',patch:'--- a/reply.json\\n+++ b/reply.json\\n'}});}`
    : `export async function triageDirectory(){throw Object.assign(Error('Synthetic billing pause.'),{code:'BILLING_LIMIT',exitCode:75,remainingImages:2});}`;
  await fs.writeFile(loader, `export async function resolve(specifier,context,next){if(specifier==='./orchestrator.js'&&context.parentURL?.endsWith('/src/index.js'))return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(implementation)}),shortCircuit:true};return next(specifier,context);}`);
  const env = { ...process.env, NODE_NO_WARNINGS: '1', DOTENV_CONFIG_PATH: path.join(root, 'absent.env'), OPENAI_API_KEY: '', DEEPINFRA_API_KEY: 'synthetic-deepinfra-key', DEEPINFRA_BASE_URL: '', PHOTO_SELECT_HOSTED_BASE: path.join(root, 'audit'), PHOTO_SELECT_DISABLE_PEOPLE: '1', PHOTO_SELECT_REASONING_EFFORT: '', PHOTO_SELECT_VERBOSITY: '', PHOTO_SELECT_MODEL: '' };
  const error = await exec(process.execPath, ['--loader', loader, cli, '--provider', 'deepinfra', '--dir', root, '--no-recurse'], { cwd: root, env, timeout: 15000 }).catch(error => error);
  expect(error.code).toBe(scenario === 'billing' ? 75 : 1);
  if (scenario === 'repair') {
    const line = error.stderr.split('\n').find(line => line.startsWith('{"type":"repair_suggestion"'));
    expect(line).toBeDefined();
    expect(JSON.parse(line)).toEqual({ type: 'repair_suggestion', patch: '--- a/reply.json\n+++ b/reply.json\n' });
  } else {
    expect(error.stderr).toContain('DeepInfra API credits exhausted');
    expect(error.stderr).not.toContain('OpenAI API credits exhausted');
  }
});
