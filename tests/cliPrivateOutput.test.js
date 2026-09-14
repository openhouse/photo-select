import {afterEach, expect, it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../src/index.js',import.meta.url));
const temporary=[];
afterEach(async()=>{await Promise.all(temporary.splice(0).map(p=>fs.rm(p,{recursive:true,force:true})));});

// Exercise the real CLI's stream routing. Replace only the private tunnel/run
// startup and image curation, which would otherwise call paid external APIs.
async function run({verbose=false,fail=false}={}) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'photo-select-output-'));temporary.push(root);
  const startup=`import fs from 'node:fs/promises';
    export async function startGithubRun(){
      const root=process.env.TEST_OUTPUT_ROOT;await fs.mkdir(root+'/images');
      return {root,images:root+'/images',provider:{curators:['Synthetic Curator'],promptPath:'unused'},stop:async()=>{}};
    }`;
  const curation=`export async function triageDirectory(){
    console.log('Synthetic Curator: completed ten image decisions.');
    await new Promise(resolve=>process.stdout.write(Buffer.from('Café output\\n'),resolve));
    await new Promise(resolve=>process.stderr.write('Synthetic warning: two responses held.\\n',resolve));
    if(process.env.TEST_OUTPUT_FAIL==='1')throw Object.assign(new Error('Synthetic curation failure.'),{code:'KNOWLEDGE_HELD'});
  }`;
  const loader=path.join(root,'loader.mjs');
  await fs.writeFile(loader,`const modules=${JSON.stringify({'./githubRun.js':startup,'./orchestrator.js':curation})};
    export async function resolve(specifier,context,next){
      if(context.parentURL?.endsWith('/src/index.js') && modules[specifier])return {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true};
      return next(specifier,context);
    }`);
  const args=['--loader',loader,cli,'--github-all','--provider','openai-batch','--dir',root];
  if(verbose)args.push('--verbose');
  const env={...process.env,OPENAI_API_KEY:'synthetic-test-key',NODE_NO_WARNINGS:'1',PHOTO_SELECT_HTTP_DRIVER:'',PHOTO_SELECT_VERBOSE:'',TEST_OUTPUT_ROOT:root,TEST_OUTPUT_FAIL:fail?'1':'0'};
  let result;
  try{result={...await exec(process.execPath,args,{cwd:root,env,timeout:15000}),code:0};}
  catch(error){result={stdout:error.stdout,stderr:error.stderr,code:error.code};}
  return {...result,log:await fs.readFile(path.join(root,'runtime.log'),'utf8'),mode:(await fs.stat(path.join(root,'runtime.log'))).mode&0o777};
}

it('shows verbose curation stdout and stderr while retaining the private log',async()=>{
  const result=await run({verbose:true});
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Synthetic Curator: completed ten image decisions.');
  expect(result.stdout).toContain('Café output');
  expect(result.stderr).toContain('Synthetic warning: two responses held.');
  expect(result.stdout).not.toContain('Synthetic warning');
  expect(result.log).toContain('Synthetic Curator: completed ten image decisions.');
  expect(result.log).toContain('Café output');
  expect(result.log).toContain('Synthetic warning: two responses held.');
  expect(result.mode).toBe(0o600);
});

it('keeps detailed output in the private log without verbose and restores the completion message',async()=>{
  const result=await run();
  expect(result.code).toBe(0);
  expect(result.stdout).not.toContain('Synthetic Curator');
  expect(result.stderr).not.toContain('Synthetic warning');
  expect(result.log).toContain('Synthetic Curator');
  expect(result.log).toContain('Synthetic warning');
  expect(result.stdout).toContain('curation and field notes saved');
  expect(result.log).not.toContain('curation and field notes saved');
});

it.each([false,true])('restores terminal error reporting after a failed private run (verbose=%s)',async(verbose)=>{
  const result=await run({verbose,fail:true});
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('knowledge: held — Synthetic curation failure.');
  expect(result.log).not.toContain('knowledge: held — Synthetic curation failure.');
  expect(result.log).toContain('Synthetic warning');
  expect(result.stdout).not.toContain('curation and field notes saved');
});
