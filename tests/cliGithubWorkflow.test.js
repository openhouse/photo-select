import {originalPromptSource, renderOriginalPrompt} from './helpers/originalPrompt.js';
import {requestInstructions} from './helpers/githubRequest.js';
import {buildPrompt,DEFAULT_PROMPT_PATH} from '../src/templates.js';
import {afterEach,expect,it} from 'vitest';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import sharp from 'sharp';
const exec=promisify(execFile),cli=fileURLToPath(new URL('../src/index.js',import.meta.url));
const requestHelpers=new URL('./helpers/githubRequest.js',import.meta.url).href;
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
 const wrapper=`import fs from 'node:fs/promises';import {startGithubRun as actual} from ${JSON.stringify(productionRun)};import {githubRequestData,requestInstructions} from ${JSON.stringify(requestHelpers)};
 export async function startGithubRun(options){
  const files=new Map(),batches=new Map();let next=0,count=0;
  const client={files:{create:async({file})=>{const id='file-'+(++next);files.set(id,await file.text());return {id};},content:async id=>({text:async()=>files.get(id)}),del:async id=>{files.delete(id);return {deleted:true};}},batches:{
   create:async({input_file_id})=>{const id='batch-'+(++next),output='file-'+(++next),rows=[];
    for(const line of files.get(input_file_id).trim().split('\\n')){const job=JSON.parse(line),request=job.body,user=request.input.at(-1),brief=githubRequestData(request);count++;
     await fs.appendFile(process.env.TEST_CALLS,JSON.stringify({filenames:brief.filenames,curators:brief.curators,speakers:request.text.format.schema.properties.minutes.items.properties.speaker.enum,instructions:requestInstructions(request),tools:request.tools,cacheKey:request.prompt_cache_key,labels:user.content.filter(x=>x.type==='input_text').slice(1).map(x=>JSON.parse(x.text))})+'\\n');
     if(process.env.TEST_FAIL_AFTER && count>Number(process.env.TEST_FAIL_AFTER)){rows.push({custom_id:job.custom_id,response:{status_code:503,body:{error:{code:'rate_limit_exceeded',message:'Synthetic interruption'}}}});continue;}
     const minutes=Array.from({length:brief.minutesMin},(_,i)=>({speaker:brief.curators[i%brief.curators.length],text:'Synthetic visual reading. What next?'}));
     const json={minutes,decisions:brief.filenames.map(filename=>({filename,decision:filename.startsWith('keep-')?'keep':'aside',reason:'Synthetic image decision.'}))};
     rows.push({custom_id:job.custom_id,response:{status_code:200,body:{status:'completed',usage:{input_tokens:6000,input_tokens_details:{cached_tokens:count===1?0:5000,cache_write_tokens:count===1?5000:0}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(json)}]}]}}});
    }
    files.set(output,rows.map(x=>JSON.stringify(x)).join('\\n'));batches.set(id,{id,status:'completed',output_file_id:output});return {id};
   },retrieve:async id=>batches.get(id),cancel:async()=>{}}};
  client.responses={create:async(request)=>{
   const ordinal=++count;const user=request.input.at(-1),brief=githubRequestData(request);
   await fs.appendFile(process.env.TEST_CALLS,JSON.stringify({filenames:brief.filenames,curators:brief.curators,serviceTier:request.service_tier,tools:request.tools})+'\\n');
   if(process.env.TEST_DISCOVERY_FAILURE==='1'&&ordinal===3)throw Object.assign(Error("424 Error retrieving tool list from MCP server: 'github'. Http status code: 424 (Failed Dependency)"),{status:424,code:'http_error',type:'external_connector_error',param:'tools'});
   const minimum=brief.minutesMin;
   return {id:'response-'+ordinal,status:'completed',service_tier:'flex',output:[{type:'reasoning',summary:[],encrypted_content:'gAAAAA'+'X'.repeat(50)+'sk-'+'A'.repeat(80)}],usage:{input_tokens:6000,input_tokens_details:{cached_tokens:ordinal===1?0:5000,cache_write_tokens:ordinal===1?5000:0}},output_text:JSON.stringify({minutes:Array.from({length:minimum},(_,i)=>({speaker:brief.curators[i%brief.curators.length],text:'Synthetic visual reading. What next?'})),decisions:brief.filenames.map(filename=>({filename,decision:filename.startsWith('keep-')?'keep':'aside',reason:'Synthetic image decision.'}))})};
  }};
  return actual({...options,base:process.env.TEST_AUDIT,tunnelId:'tunnel_'+'a'.repeat(32)},{startTunnel:async()=>({assertCurrent:async()=>{},stop:async()=>{}}),client});
 }`;
 const loader=path.join(root,'loader.mjs');await fs.writeFile(loader,`export async function resolve(specifier,context,next){if(specifier==='./githubRun.js'&&context.parentURL?.endsWith('/src/index.js'))return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(wrapper)}),shortCircuit:true};return next(specifier,context);}`);
 async function run({failAfter,recurse=false,disablePeople=false,curators,identityPolicy='passthrough',context,prompt,knowledgeBrief,workers=1,discoveryFailure=false}={}){
  const args=['--loader',loader,cli,'--github-all','--provider','openai-batch','--model','gpt-5.6-terra','--workers',String(workers),'--verbose','--dir',source];if(!recurse)args.push('--no-recurse');if(disablePeople)args.push('--disable-photo-filter');if(curators)args.push('--curators',curators.join(','));
  if(knowledgeBrief)args.push("--knowledge-brief",knowledgeBrief);
  if(prompt){const file=path.join(root,'custom.hbs');await fs.writeFile(file,prompt);args.push('--prompt',file);}
  if(context){const file=path.join(root,'context.txt');await fs.writeFile(file,context);args.push('--context',file);}
  const env={...process.env,OPENAI_API_KEY:'synthetic-test-key',NODE_NO_WARNINGS:'1',PHOTO_SELECT_HTTP_DRIVER:'',PHOTO_SELECT_DISABLE_PEOPLE:'0',PHOTO_SELECT_IDENTITY_POLICY:identityPolicy,PHOTO_FILTER_API_BASE:peopleBase,TEST_AUDIT:audit,TEST_CALLS:calls,TEST_FAIL_AFTER:failAfter?String(failAfter):'',TEST_DISCOVERY_FAILURE:discoveryFailure?'1':''};
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
 expect(calls).toHaveLength(1);expect(calls[0].curators).toEqual(expected);expect(calls[0].speakers).toBeUndefined();
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
 expect(result.stdout+result.stderr).toContain('Flex at Batch rates');
 const sent=(await fs.readFile(f.calls,'utf8')).trim().split('\n').map(JSON.parse);expect(sent.every(r=>r.serviceTier==='flex')).toBe(true);
 expect(await jpgs(path.join(f.source,'_keep'))).toHaveLength(10);expect(await jpgs(path.join(f.source,'_aside'))).toHaveLength(10);
 const audit=path.join(f.audit,(await fs.readdir(f.audit))[0]),records=await Promise.all((await fs.readdir(audit)).filter(n=>/^curation-/.test(n)).sort().map(async n=>JSON.parse(await fs.readFile(path.join(audit,n),'utf8'))));
 expect(records).toHaveLength(3);expect(records.map(r=>r.attempts[0].response._photoSelectCache.role)).toEqual(['seed','probe','reader']);
 for(const record of records){expect(requestInstructions(record.request)).toContain(context);expect(record.status).toBe('completed');expect(record.request.service_tier).toBe('flex');expect(record.attempts[0].request_sha256).toBe(record.model_sha256);}
 expect(new Set(records.map(r=>r.request.prompt_cache_key)).size).toBe(1);
},30000);

it('finishes the real CLI with twenty workers despite ciphertext matches and one discovery outage',async()=>{
 const f=await setup(30),context=Array.from({length:300},(_,i)=>`Record ${i}: amber bridge cedar delta field.\n`).join('');
 const result=await f.run({context,curators:['Base'],workers:20,discoveryFailure:true});
 expect(result.code,result.stderr).toBe(0);expect(result.stdout).toContain('tool discovery unavailable');
 expect(await jpgs(f.source)).toEqual([]);expect(await jpgs(path.join(f.source,'_keep'))).toHaveLength(30);expect(await jpgs(path.join(f.source,'_aside'))).toHaveLength(30);
 const audit=path.join(f.audit,(await fs.readdir(f.audit))[0]),records=await Promise.all((await fs.readdir(audit)).filter(n=>/^curation-/.test(n)).map(async n=>JSON.parse(await fs.readFile(path.join(audit,n),'utf8'))));
 expect(records).toHaveLength(6);expect(records.every(r=>r.status==='completed')).toBe(true);
 expect(records.flatMap(r=>r.json.decisions)).toHaveLength(60);expect(new Set(records.flatMap(r=>r.json.decisions.map(d=>d.filename))).size).toBe(60);
 expect(records.every(r=>r.attempts[0].omittedEncryptedReasoning.length===1)).toBe(true);
 expect(records.some(r=>r.attempts[0].response._photoSelectFlex.attempt===2)).toBe(true);
});

it.each(['default','custom','inline'])('sends the ordinary rendered prompt through the actual CLI (%s)',async kind=>{
 const f=await setup(),context='Exhibition brief with a private GitHub link: https://github.com/fixture/private.';
 const prompt=kind==='custom'?(await fs.readFile(DEFAULT_PROMPT_PATH,'utf8')).replace('You are moderating a collaborative curatorial session','Use the requested custom exhibition format. You are moderating a collaborative curatorial session'):undefined;
 const result=await f.run({context:kind==='inline'?undefined:context,knowledgeBrief:kind==='inline'?context:undefined,prompt,curators:['Base A','Base B']});
 expect(result.code,result.stderr).toBe(0);
 const call=JSON.parse((await fs.readFile(f.calls,'utf8')).trim());
 const contextPath=path.join(f.root,'expected-context.txt');await fs.writeFile(contextPath,context);
 const original=await buildPrompt(kind==='custom'?path.join(f.root,'custom.hbs'):DEFAULT_PROMPT_PATH,{curators:call.curators,images:call.filenames,contextPath});
 expect(call.instructions).toBe(original.prompt);expect(call.tools[0].server_label).toBe('github');
 expect(call.instructions).toContain('If uncertain, choose "aside"');
 expect(call.instructions).toContain("Read Jamie's notes");
},30000);

it.each(['default', 'custom', 'inline'])('preserves the historical prompt through cached CLI batches (%s)', async kind => {
 const people = Object.fromEntries(Array.from({length: 10}, (_, i) =>
  ['keep', 'aside'].map(type => [`${type}-${i}.jpg`, ['Tagged Guest']])).flat());
 const f = await setup(10, {people});
 const context = Array.from({length: 300}, (_, i) => `Record ${i}: amber bridge cedar delta field.\n`).join('');
 const source = await originalPromptSource();
 const custom = kind === 'custom' ? source.replace('You are moderating', 'Use the artist-selected custom format. You are moderating') : undefined;
 const result = await f.run({context: kind === 'inline' ? undefined : context,
  knowledgeBrief: kind === 'inline' ? context : undefined, prompt: custom, curators: ['Base A', 'Base B']});
 expect(result.code, result.stderr).toBe(0);
 const audit = path.join(f.audit, (await fs.readdir(f.audit))[0]);
 const records = await Promise.all((await fs.readdir(audit)).filter(name => /^curation-/.test(name)).sort()
  .map(async name => JSON.parse(await fs.readFile(path.join(audit, name), 'utf8'))));
 expect(records).toHaveLength(3);
 expect(records.map(record => record.attempts[0].response._photoSelectCache.role)).toEqual(['seed', 'probe', 'reader']);
 const prompts = [], prefixes = [], keys = [];
 for (const record of records) {
  expect(record.status).toBe('completed');
  const request = record.request, user = request.input.at(-1);
  const labels = user.content.filter(part => part.type === 'input_text').slice(1).map(part => JSON.parse(part.text));
  const expected = await renderOriginalPrompt({images: labels.map(label => label.filename),
   curators: ['Base A', 'Base B', 'Tagged Guest'], context, source: custom});
  const prompt = requestInstructions(request);
  expect(prompt).toBe(expected.prompt);
  expect(request.service_tier).toBe('flex');
  expect(request.tools[0]).toMatchObject({type: 'mcp', server_label: 'github'});
  expect(request.tools[0]).not.toHaveProperty('authorization');
  expect(labels.every(label => label.people.includes('Tagged Guest'))).toBe(true);
  expect(user.content[0].text).toBe('Here are the images:\nRespond in json format.');
  expect(user.content.filter(part => part.type === 'input_image')).toHaveLength(labels.length);
  const allText = (request.instructions ?? '') + request.input.flatMap(message => message.content.filter(part => part.type === 'input_text').map(part => part.text)).join('');
  expect(allText.split(context)).toHaveLength(2);
  prompts.push(prompt); prefixes.push(request.input[0].content[0].text); keys.push(request.prompt_cache_key);
 }
 expect(new Set(prompts).size).toBe(3); // Different filename lists must reach each request.
 expect(new Set(prefixes).size).toBe(1); // Those lists must remain outside the shared prefix.
 expect(new Set(keys).size).toBe(1);
 expect(keys[0]).toMatch(/^photo-select:github-v3:/);
 expect(result.stdout + result.stderr).toContain('github cache: probe');
 expect(result.stdout + result.stderr).toContain('cached=');
 expect(await jpgs(f.source)).toEqual([]);
 expect(await jpgs(path.join(f.source, '_keep'))).toHaveLength(10);
 expect(await jpgs(path.join(f.source, '_aside'))).toHaveLength(10);
}, 30000);

it('finishes quoted multiline context with twenty workers without counting JSON transport escapes', async () => {
 const f = await setup(30), context = 'A "quoted" line.\n'.repeat(850);
 const result = await f.run({context, curators: ['Base'], workers: 20});
 expect(result.code, result.stderr).toBe(0);
 expect(await jpgs(f.source)).toEqual([]);
 expect(await jpgs(path.join(f.source, '_keep'))).toHaveLength(30);
 expect(await jpgs(path.join(f.source, '_aside'))).toHaveLength(30);
 const audit = path.join(f.audit, (await fs.readdir(f.audit))[0]);
 const records = await Promise.all((await fs.readdir(audit)).filter(name => /^curation-/.test(name)).sort()
  .map(async name => JSON.parse(await fs.readFile(path.join(audit, name), 'utf8'))));
 expect(records).toHaveLength(6);
 expect(records.every(record => record.status === 'completed')).toBe(true);
 const roles = records.map(record => record.attempts[0].response._photoSelectCache.role);
 expect(roles.slice(0, 2)).toEqual(['seed', 'probe']);
 expect(roles.slice(2)).toEqual(['reader', 'reader', 'reader', 'reader']);
 for (const record of records) {
  expect(requestInstructions(record.request)).toContain(context);
  expect(record.request.service_tier).toBe('flex');
  expect(record.attempts[0].response._photoSelectCache.requiredCachedTokens).toBeLessThan(5000);
 }
 expect(new Set(records.flatMap(record => record.json.decisions.map(decision => decision.filename))).size).toBe(60);
 expect(result.stdout + result.stderr).toContain('prefix=');
}, 30000);
