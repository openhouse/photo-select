import {afterEach,expect,it} from 'vitest';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import sharp from 'sharp';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../src/index.js',import.meta.url));
const productionRun=new URL('../src/githubRun.js',import.meta.url).href;
const roots=[],servers=[];afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise(resolve=>s.close(resolve))));await Promise.all(roots.splice(0).map(p=>fs.rm(p,{recursive:true,force:true})));});
async function setup(pairs=1,{people={},legacy=false}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'github-workflow-')));roots.push(root);
 const source=path.join(root,'photos'),audit=path.join(root,'audit'),calls=path.join(root,'calls.jsonl');await fs.mkdir(source);
 const jpeg=await sharp({create:{width:24,height:24,channels:3,background:'#805040'}}).jpeg().toBuffer();
 for(let i=0;i<pairs;i++)for(const kind of ['keep','aside'])await fs.writeFile(path.join(source,`${kind}-${i}.jpg`),jpeg);
 const metadataRequests=[];
 const server=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');metadataRequests.push(req.url);
  if(req.method==='POST'&&req.url==='/api/photos/by-filenames/persons'){
   if(legacy){res.writeHead(404);res.end('{}');return;}
   let body='';for await(const chunk of req)body+=chunk;
   const {filenames}=JSON.parse(body);
   res.end(JSON.stringify({data:filenames.map(filename=>({filename,resolvedFilename:filename,status:'exact',people:people[filename]||[]})),meta:{schemaVersion:1,corpusSha256:'a'.repeat(64),sourceCount:1,indexStatus:'verified',sourceFreshness:'unknown'}}));return;
  }
  const match=req.url.match(/^\/api\/photos\/by-filename\/(.+)\/persons$/);
  if(match){res.end(JSON.stringify({people:people[decodeURIComponent(match[1])]||[]}));return;}
  res.writeHead(404);res.end('{}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);
 const peopleBase='http://127.0.0.1:'+server.address().port;
 // Real CLI, source setup, provider, Batch transport, audit and orchestrator.
 // Only external tunnel/OpenAI operations are substituted with deterministic IO.
 const wrapper=`import fs from 'node:fs/promises';import {startGithubRun as actual} from ${JSON.stringify(productionRun)};
 export async function startGithubRun(options){
  const files=new Map(),batches=new Map();let next=0,count=0;
  const client={files:{create:async({file})=>{const id='file-'+(++next);files.set(id,await file.text());return {id};},content:async id=>({text:async()=>files.get(id)}),del:async id=>{files.delete(id);return {deleted:true};}},batches:{
   create:async({input_file_id})=>{const id='batch-'+(++next),output='file-'+(++next),rows=[];
    for(const line of files.get(input_file_id).trim().split('\\n')){const job=JSON.parse(line),request=job.body,user=request.input.at(-1),brief=JSON.parse(user.content[0].text);count++;
     await fs.appendFile(process.env.TEST_CALLS,JSON.stringify({filenames:brief.filenames,curators:brief.curators,speakers:request.text.format.schema.properties.minutes.items.properties.speaker.enum,instructions:request.instructions,tools:request.tools,cacheKey:request.prompt_cache_key,labels:user.content.filter(x=>x.type==='input_text').slice(1).map(x=>JSON.parse(x.text))})+'\\n');
     if(process.env.TEST_FAIL_AFTER && count>Number(process.env.TEST_FAIL_AFTER)){rows.push({custom_id:job.custom_id,response:{status_code:503,body:{error:{code:'rate_limit_exceeded',message:'Synthetic interruption'}}}});continue;}
     const minutes=Array.from({length:request.text.format.schema.properties.minutes.minItems??Number(request.input[1].content[0].text.match(/between ([0-9]+) and/)[1])},(_,i)=>({speaker:brief.curators[i%brief.curators.length],text:'Synthetic visual reading. What next?'}));
     const json={minutes,decisions:brief.filenames.map(filename=>({filename,decision:filename.startsWith('keep-')?'keep':'aside',reason:'Synthetic image decision.'}))};
     rows.push({custom_id:job.custom_id,response:{status_code:200,body:{status:'completed',usage:{input_tokens:6000,input_tokens_details:{cached_tokens:count===1?0:5000,cache_write_tokens:count===1?5000:0}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(json)}]}]}}});
    }
    files.set(output,rows.map(x=>JSON.stringify(x)).join('\\n'));batches.set(id,{id,status:'completed',output_file_id:output});return {id};
   },retrieve:async id=>batches.get(id),cancel:async()=>{}}};
  return actual({...options,base:process.env.TEST_AUDIT,tunnelId:'tunnel_'+'a'.repeat(32)},{startTunnel:async()=>({assertCurrent:async()=>{},stop:async()=>{}}),client});
 }`;
 const loader=path.join(root,'loader.mjs');await fs.writeFile(loader,`export async function resolve(specifier,context,next){if(specifier==='./githubRun.js'&&context.parentURL?.endsWith('/src/index.js'))return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(wrapper)}),shortCircuit:true};return next(specifier,context);}`);
 async function run({failAfter,recurse=false,disablePeople=false,curators,identityPolicy='passthrough',context}={}){
  const args=['--loader',loader,cli,'--github-all','--provider','openai-batch','--model','gpt-5.6-terra','--workers','1','--verbose','--dir',source];if(!recurse)args.push('--no-recurse');if(disablePeople)args.push('--disable-photo-filter');if(curators)args.push('--curators',curators.join(','));
  if(context){const file=path.join(root,'context.txt');await fs.writeFile(file,context);args.push('--context',file);}
  const env={...process.env,OPENAI_API_KEY:'synthetic-test-key',NODE_NO_WARNINGS:'1',PHOTO_SELECT_HTTP_DRIVER:'',PHOTO_SELECT_DISABLE_PEOPLE:'0',PHOTO_SELECT_IDENTITY_POLICY:identityPolicy,PHOTO_FILTER_API_BASE:peopleBase,TEST_AUDIT:audit,TEST_CALLS:calls,TEST_FAIL_AFTER:failAfter?String(failAfter):''};
  try{return {...await exec(process.execPath,args,{cwd:root,env,timeout:25000,maxBuffer:1024*1024}),code:0};}catch(e){return {code:e.code,stdout:e.stdout,stderr:e.stderr};}
 }
 return {root,source,audit,calls,run,metadataRequests};
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

it.each([{legacy:false,identityPolicy:'passthrough'},{legacy:true,identityPolicy:'passthrough'},{legacy:false,identityPolicy:'canonicalize'}])('adds repeated photo tags to the actual GitHub Batch request and saved minutes (%j)',async({legacy,identityPolicy})=>{
 const guest='Pat (artist + neighbor)',people={'keep-0.jpg':[guest,'Base A','_UNKNOWN_'],'aside-0.jpg':[guest,'Base A','One appearance']};
 const f=await setup(1,{people,legacy}),result=await f.run({curators:['Base A','Base B'],identityPolicy});expect(result.code,result.stderr).toBe(0);
 const calls=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(s=>JSON.parse(s));
 const added=identityPolicy==='canonicalize'?'Pat artist  neighbor':guest,expected=['Base A','Base B',added];
 expect(calls).toHaveLength(1);expect(calls[0].curators).toEqual(expected);expect(calls[0].speakers).toEqual(expected);
 expect(calls[0].instructions).toContain(added);expect(calls[0].tools[0].server_label).toBe('github');
 expect(calls[0].labels.sort((a,b)=>a.filename.localeCompare(b.filename))).toEqual([{filename:'aside-0.jpg',people:[guest,'Base A','One appearance']},{filename:'keep-0.jpg',people:[guest,'Base A']}]);
 expect(result.stdout).toContain('additional curators from tags: '+added);
 const audit=path.join(f.audit,(await fs.readdir(f.audit))[0]),record=JSON.parse(await fs.readFile(path.join(audit,'curation-0001.json'),'utf8'));
 expect(record.status).toBe('completed');expect(record.json.minutes.some(x=>x.speaker===added)).toBe(true);
 expect(await jpgs(path.join(f.source,'_keep'))).toEqual(['keep-0.jpg']);expect(await jpgs(path.join(f.source,'_aside'))).toEqual(['aside-0.jpg']);
 expect(f.metadataRequests).toContain('/api/photos/by-filenames/persons');
 expect(f.metadataRequests.filter(x=>x.includes('/by-filename/'))).toHaveLength(legacy?2:0);
},30000);
it('honors an explicit people-lookup opt-out in GitHub mode',async()=>{
 const f=await setup(1,{people:{'keep-0.jpg':['Pat'],'aside-0.jpg':['Pat']}}),result=await f.run({disablePeople:true});
 expect(result.code,result.stderr).toBe(0);expect(f.metadataRequests).toEqual([]);
 const call=JSON.parse((await fs.readFile(f.calls,'utf8')).trim());expect(call.curators).not.toContain('Pat');
 expect(result.stdout).not.toContain('additional curators from tags:');
},30000);

it('honors canonicalization of the base roster as well as additional names',async()=>{
 const f=await setup(),result=await f.run({curators:['Prof. Curator A'],identityPolicy:'canonicalize'});
 expect(result.code,result.stderr).toBe(0);
 const call=JSON.parse((await fs.readFile(f.calls,'utf8')).trim());expect(call.curators).toEqual(['Prof Curator A']);
},30000);

it('keeps full context, sorting and private cache usage through the actual CLI',async()=>{
 const f=await setup(10),context=Array.from({length:300},(_,i)=>`Record ${i}: amber bridge cedar delta field.\n`).join('');
 const result=await f.run({context,curators:['Base']});expect(result.code,result.stderr).toBe(0);
 expect(result.stdout+result.stderr).toContain('github cache: probe');
 expect(await jpgs(path.join(f.source,'_keep'))).toHaveLength(10);expect(await jpgs(path.join(f.source,'_aside'))).toHaveLength(10);
 const audit=path.join(f.audit,(await fs.readdir(f.audit))[0]),records=await Promise.all((await fs.readdir(audit)).filter(n=>/^curation-/.test(n)).sort().map(async n=>JSON.parse(await fs.readFile(path.join(audit,n),'utf8'))));
 expect(records).toHaveLength(3);expect(records.map(r=>r.attempts[0].response._photoSelectCache.role)).toEqual(['seed','probe','reader']);
 for(const record of records){expect(JSON.parse(record.request.input[0].content[0].text).brief).toBe(context);expect(record.status).toBe('completed');}
 expect(new Set(records.map(r=>r.request.prompt_cache_key)).size).toBe(1);
},30000);
