import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import sharp from 'sharp';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../src/index.js',import.meta.url));
const productionRun=new URL('../src/githubRun.js',import.meta.url).href;
const roots=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(p=>fs.rm(p,{recursive:true,force:true})));});
async function setup(pairs=1){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'github-workflow-')));roots.push(root);
 const source=path.join(root,'photos'),audit=path.join(root,'audit'),calls=path.join(root,'calls.jsonl');await fs.mkdir(source);
 const jpeg=await sharp({create:{width:24,height:24,channels:3,background:'#805040'}}).jpeg().toBuffer();
 for(let i=0;i<pairs;i++)for(const kind of ['keep','aside'])await fs.writeFile(path.join(source,`${kind}-${i}.jpg`),jpeg);
 // Real CLI, source setup, provider, Batch transport, audit and orchestrator.
 // Only external tunnel/OpenAI operations are substituted with deterministic IO.
 const wrapper=`import fs from 'node:fs/promises';import {startGithubRun as actual} from ${JSON.stringify(productionRun)};
 export async function startGithubRun(options){
  const files=new Map(),batches=new Map();let next=0,count=0;
  const client={files:{create:async({file})=>{const id='file-'+(++next);files.set(id,await file.text());return {id};},content:async id=>({text:async()=>files.get(id)}),del:async id=>{files.delete(id);return {deleted:true};}},batches:{
   create:async({input_file_id})=>{const id='batch-'+(++next),output='file-'+(++next),rows=[];
    for(const line of files.get(input_file_id).trim().split('\\n')){const job=JSON.parse(line),request=job.body,brief=JSON.parse(request.input[0].content[0].text);count++;
     await fs.appendFile(process.env.TEST_CALLS,JSON.stringify({filenames:brief.filenames})+'\\n');
     if(process.env.TEST_FAIL_AFTER && count>Number(process.env.TEST_FAIL_AFTER)){rows.push({custom_id:job.custom_id,response:{status_code:503,body:{error:{code:'rate_limit_exceeded',message:'Synthetic interruption'}}}});continue;}
     const minutes=Array.from({length:request.text.format.schema.properties.minutes.minItems},(_,i)=>({speaker:brief.curators[i%brief.curators.length],text:'Synthetic visual reading. What next?'}));
     const json={minutes,decisions:brief.filenames.map(filename=>({filename,decision:filename.startsWith('keep-')?'keep':'aside',reason:'Synthetic image decision.'}))};
     rows.push({custom_id:job.custom_id,response:{status_code:200,body:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(json)}]}]}}});
    }
    files.set(output,rows.map(x=>JSON.stringify(x)).join('\\n'));batches.set(id,{id,status:'completed',output_file_id:output});return {id};
   },retrieve:async id=>batches.get(id),cancel:async()=>{}}};
  return actual({...options,base:process.env.TEST_AUDIT,tunnelId:'tunnel_'+'a'.repeat(32)},{startTunnel:async()=>({assertCurrent:async()=>{},stop:async()=>{}}),client});
 }`;
 const loader=path.join(root,'loader.mjs');await fs.writeFile(loader,`export async function resolve(specifier,context,next){if(specifier==='./githubRun.js'&&context.parentURL?.endsWith('/src/index.js'))return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(wrapper)}),shortCircuit:true};return next(specifier,context);}`);
 async function run({failAfter,recurse=false}={}){
  const args=['--loader',loader,cli,'--github-all','--provider','openai-batch','--model','gpt-5.6-terra','--workers','1','--verbose','--dir',source];if(!recurse)args.push('--no-recurse');
  const env={...process.env,OPENAI_API_KEY:'synthetic-test-key',NODE_NO_WARNINGS:'1',PHOTO_SELECT_HTTP_DRIVER:'',TEST_AUDIT:audit,TEST_CALLS:calls,TEST_FAIL_AFTER:failAfter?String(failAfter):''};
  try{return {...await exec(process.execPath,args,{cwd:root,env,timeout:25000,maxBuffer:1024*1024}),code:0};}catch(e){return {code:e.code,stdout:e.stdout,stderr:e.stderr};}
 }
 return {root,source,audit,calls,run};
}
const jpgs=async dir=>{try{return (await fs.readdir(dir)).filter(f=>f.endsWith('.jpg')).sort();}catch(e){if(e.code==='ENOENT')return [];throw e;}};
it('places GitHub-mode decisions, explanations and the level snapshot in the chosen image directory',async()=>{
 const f=await setup(),result=await f.run();expect(result.code,result.stderr).toBe(0);
 expect(await fs.readdir(f.source)).toEqual(expect.arrayContaining(['_keep','_aside','_level-001']));
 expect(await jpgs(path.join(f.source,'_keep'))).toEqual(['keep-0.jpg']);expect(await jpgs(path.join(f.source,'_aside'))).toEqual(['aside-0.jpg']);expect(await jpgs(f.source)).toEqual([]);
 expect(await jpgs(path.join(f.source,'_level-001'))).toEqual(['aside-0.jpg','keep-0.jpg']);
 expect(await fs.readFile(path.join(f.source,'_keep','keep-0.txt'),'utf8')).toContain('Synthetic image decision.');
 const audit=path.join(f.audit,(await fs.readdir(f.audit))[0]);expect(await fs.readdir(audit)).toContain('curation-0001.json');expect(await fs.readdir(audit)).not.toContain('images');
 const corpus=JSON.parse(await fs.readFile(path.join(audit,'corpus.json'),'utf8'));expect(corpus.source).toBe(await fs.realpath(f.source));expect(corpus.images).toHaveLength(2);expect(corpus.images.every(x=>/^[a-f0-9]{64}$/.test(x.sha256))).toBe(true);
 expect(await fs.readdir(f.source)).not.toContain('.git');
},30000);
it('resumes an interrupted invocation without requesting decisions again for already sorted images',async()=>{
 const f=await setup(10);expect((await f.run({failAfter:1})).code).toBe(1);
 expect((await fs.readdir(f.source)).some(name=>['_keep','_aside'].includes(name))).toBe(true);
 const first=[...await jpgs(path.join(f.source,'_keep')),...await jpgs(path.join(f.source,'_aside'))];expect(first).toHaveLength(8);
 expect(await jpgs(f.source)).toHaveLength(12);await fs.writeFile(f.calls,'');
 const resumed=await f.run();expect(resumed.code,resumed.stderr).toBe(0);
 const sent=(await fs.readFile(f.calls,'utf8')).trim().split('\n').flatMap(s=>JSON.parse(s).filenames);
 expect(sent).toHaveLength(12);expect(sent.some(name=>first.includes(name))).toBe(false);
 expect(await jpgs(f.source)).toEqual([]);expect(await jpgs(path.join(f.source,'_keep'))).toHaveLength(10);expect(await jpgs(path.join(f.source,'_aside'))).toHaveLength(10);
 expect(await jpgs(path.join(f.source,'_level-001'))).toHaveLength(20);expect(await fs.readdir(f.audit)).toHaveLength(2);
},30000);
it('recurses into the source keep directory and resumes when no top-level images remain',async()=>{
 const f=await setup(2);expect((await f.run()).code).toBe(0);
 expect(await fs.readdir(f.source)).toContain('_keep');
 const resumed=await f.run({recurse:true});expect(resumed.code,resumed.stderr).toBe(0);
 expect(await jpgs(path.join(f.source,'_keep','_keep'))).toEqual(['keep-0.jpg','keep-1.jpg']);
 expect(await jpgs(path.join(f.source,'_keep','_level-002'))).toEqual(['keep-0.jpg','keep-1.jpg']);
 const manifests=await Promise.all((await fs.readdir(f.audit)).map(async name=>JSON.parse(await fs.readFile(path.join(f.audit,name,'corpus.json'),'utf8'))));
 expect(manifests.some(m=>m.images.some(x=>x.filename==='_keep/keep-0.jpg'))).toBe(true);
},30000);
