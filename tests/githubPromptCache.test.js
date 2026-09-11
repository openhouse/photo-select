import {requestInstructions,githubRequestData} from './helpers/githubRequest.js';
import {expect,it} from 'vitest';
import {GithubCurationProvider} from '../src/providers/github.js';
import {GithubBatchTransport} from '../src/githubBatch.js';
const brief=Array.from({length:300},(_,i)=>`Record ${i}: amber bridge cedar delta field.\n`).join('');
const tunnelId='tunnel_'+'a'.repeat(32),base=['Base'];
const reply=(filename,speaker='Base')=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({minutes:[{speaker,text:'What next?'}],decisions:[{filename,decision:'keep',reason:'Visible form.'}]})}]}]});
async function requests(){
 const calls=[];const p=new GithubCurationProvider({tunnelId,curators:base,brief,encodeImage:async file=>Buffer.from(file),respond:async r=>{calls.push(r);return reply(calls.length===1?'a.jpg':'b.jpg');}});
 await p.chat({model:'gpt-5.6-terra',images:['a.jpg'],reasoningEffort:'high'});
 await p.chat({model:'gpt-5.6-terra',images:['b.jpg'],curators:['Base','Guest'],photoPeople:[{file:'b.jpg',people:['Guest']}],minutesMax:4,reasoningEffort:'high'});
 return calls;
}
it('caches the entire unchanged user brief before filenames, voices, metadata and images',async()=>{
 const [a,b]=await requests();
 expect(a.prompt_cache_options).toEqual({mode:'explicit',ttl:'30m'});
 expect(a.prompt_cache_key).toMatch(/^photo-select:github-v3:/);expect(a.prompt_cache_key).toBe(b.prompt_cache_key);
 expect(a.instructions).toBe(b.instructions);expect(a.text).toEqual(b.text);expect(a.tools).toEqual(b.tools);
 expect(a.input[0].content[0]).toEqual(b.input[0].content[0]);expect(a.input[0].role).toBe('developer');
 expect(a.input[0].content[0].text).toContain(brief);
 expect(a.input[0].content[0].prompt_cache_breakpoint).toEqual({mode:'explicit'});
 expect(JSON.stringify(a).split('Record 299:')).toHaveLength(2);
 expect(b.input[0].content[1].text).toContain('Guest');
 expect(githubRequestData(b).curators).toEqual(['Base','Guest']);
 expect(b.input.at(-1).content[1].text).toContain('Guest');
});
it.each(['voice','filename'])('retains local %s validation with a stable schema and repairs after the breakpoint',async kind=>{
 const calls=[],saved=[];const p=new GithubCurationProvider({tunnelId,curators:base,brief,encodeImage:async()=>Buffer.from('image'),save:async r=>saved.push(r),respond:async r=>{
  calls.push(r);const result=reply(kind==='filename'?'invented.jpg':'a.jpg',kind==='voice'?123:'Base');
  return result;
 }});
 await expect(p.chat({model:'gpt-5.6-terra',images:['a.jpg'],minutesMin:1,minutesMax:1})).rejects.toThrow();
 expect(calls).toHaveLength(2);expect(calls[0].prompt_cache_key).toBeTruthy();expect(calls[1].prompt_cache_key).toBe(calls[0].prompt_cache_key);
 expect(calls[1].instructions).toBe(calls[0].instructions);expect(calls[1].input[0].content[0]).toEqual(calls[0].input[0].content[0]);expect(calls[1].input.at(-1)).toEqual(calls[0].input.at(-1));expect(requestInstructions(calls[1])).toContain('Repair');expect(saved[0].status).toBe('held');
});
function fixture({missAt=0,failAt=0,blockAt=0}={}){
 const files=new Map(),batches=new Map(),sizes=[],rows=[],events=[];let next=0,executed=0,release;
 const blocked=new Promise(resolve=>release=resolve);
 const client={files:{create:async({file})=>{const id='f'+(++next);files.set(id,await file.text());return {id};},content:async id=>({text:async()=>files.get(id)}),del:async id=>files.delete(id)},batches:{create:async({input_file_id})=>{
  const jobs=files.get(input_file_id).trim().split('\n').map(JSON.parse);sizes.push(jobs.length);
  const id='b'+(++next),output='f'+(++next),results=[];
  for(const job of jobs){rows.push(job);const number=++executed;if(number===blockAt)await blocked;
   results.push({custom_id:job.custom_id,response:number===failAt?{status_code:400,body:{error:{code:'billing_hard_limit_reached'}}}:{status_code:200,body:{...reply('a.jpg'),usage:{input_tokens:4500,input_tokens_details:{cached_tokens:number===1||number===missAt?0:4000,cache_write_tokens:number===1||number===missAt?4000:0}}}}});}
  files.set(output,results.map(x=>JSON.stringify(x)).join('\n'));batches.set(id,{id,status:'completed',output_file_id:output});return {id};
 },retrieve:async id=>batches.get(id),cancel:async()=>{}}};
 return {client,sizes,rows,events,release};
}
it('uses real Batch seed then probe barriers, sharing a cohort across staggered arrivals',async()=>{
 const [body]=await requests(),f=fixture({blockAt:1});const t=new GithubBatchTransport({client:f.client,flushMs:1,progress:e=>f.events.push(e)});
 const first=t.respond(body);await new Promise(r=>setTimeout(r,15));
 const pending=Array.from({length:19},()=>t.respond(body));await new Promise(r=>setTimeout(r,15));expect(f.sizes).toEqual([1]);f.release();
 const result=await Promise.all([first,...pending]);expect(f.sizes.slice(0,2)).toEqual([1,1]);expect(Math.max(...f.sizes)).toBeLessThanOrEqual(8);
 expect(result.map(r=>r._photoSelectCache.role).slice(0,3)).toEqual(['seed','probe','reader']);
 expect(result[0]._photoSelectCache).toMatchObject({cachedTokens:0,writeTokens:4000,verified:false});expect(result[1]._photoSelectCache.verified).toBe(true);
 expect(f.rows.every(x=>x.body.tools[0].tunnel_id===tunnelId&&!x.body.service_tier)).toBe(true);
 expect(f.events.join('\n')).toMatch(/probe/);expect(f.events.join('\n')).toMatch(/cached/);
});
it.each([{missAt:2},{failAt:1},{missAt:2,partial:true}])('holds unsent work on a miss or billing failure and never treats writes as reads: %j',async options=>{
 const [body]=await requests(),f=fixture(options);
 if(options.partial){const content=f.client.files.content;f.client.files.content=async id=>{const r=await content(id);return {text:async()=>(await r.text()).replaceAll('"cached_tokens":0','"cached_tokens":128')};};}
 const t=new GithubBatchTransport({client:f.client,flushMs:1});const result=await Promise.allSettled(Array.from({length:20},()=>t.respond(body)));
 expect(f.sizes).toEqual(options.failAt?[1]:[1,1]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(options.failAt?0:2);
 await expect(t.respond(body)).rejects.toThrow(options.failAt?/billing/:/cache/i);expect(f.sizes).toHaveLength(options.failAt?1:2);
});
it('preserves completed reader results on a late miss but stops the next wave',async()=>{
 const [body]=await requests(),f=fixture({missAt:3}),t=new GithubBatchTransport({client:f.client,flushMs:1});
 const result=await Promise.allSettled(Array.from({length:20},()=>t.respond(body)));
 expect(f.sizes).toEqual([1,1,8]);expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(10);expect(result.filter(r=>r.status==='rejected')).toHaveLength(10);
});
it('invalidates the key for brief, model, effort, verbosity or tunnel changes',async()=>{
 const keys=[];
 for(const change of [{},{brief:brief+'A different ending.'},{model:'gpt-5.6-sol'},{reasoningEffort:'low'},{verbosity:'low'},{tunnelId:'tunnel_'+'b'.repeat(32)}]){
  const p=new GithubCurationProvider({tunnelId:change.tunnelId||tunnelId,curators:base,brief:change.brief||brief,encodeImage:async()=>Buffer.from('image'),respond:async r=>{keys.push(r.prompt_cache_key);return reply('a.jpg');}});
  await p.chat({model:'gpt-5.6-terra',reasoningEffort:'high',images:['a.jpg'],...change});
 }
 expect(keys.every(Boolean)).toBe(true);expect(new Set(keys).size).toBe(keys.length);
});
it.each([{model:'gpt-5.5',text:brief},{model:'gpt-5.6-terra',text:'Short brief.'},{model:'gpt-5.6-terra',text:'a'.repeat(5000)}])('does not impose explicit caching on unsupported models or fewer than 1024 tokens: %j',async({model,text})=>{
 let request;const p=new GithubCurationProvider({tunnelId,curators:base,brief:text,encodeImage:async()=>Buffer.from('image'),respond:async r=>{request=r;return reply('a.jpg');}});
 await p.chat({model,images:['a.jpg']});expect(request.prompt_cache_options).toBeUndefined();expect(requestInstructions(request)).toContain(text);
});
it('requires a new probe after idle time rather than trusting an old hit',async()=>{
 const [body]=await requests(),f=fixture();let now=1;const t=new GithubBatchTransport({client:f.client,flushMs:1,now:()=>now});
 await t.respond(body);await t.respond(body);now+=21*60*1000;
 const [probe,reader]=await Promise.all([t.respond(body),t.respond(body)]);
 expect(probe._photoSelectCache.role).toBe('probe');expect(reader._photoSelectCache.role).toBe('reader');expect(f.sizes).toEqual([1,1,1,1]);
});
it('rejects queued and future requests when cancelled during seed',async()=>{
 const [body]=await requests(),f=fixture({blockAt:1}),abort=new AbortController(),t=new GithubBatchTransport({client:f.client,flushMs:1,signal:abort.signal});
 const pending=Promise.allSettled(Array.from({length:20},()=>t.respond(body)));await new Promise(r=>setTimeout(r,15));abort.abort();f.release();
 const result=await pending;expect(result.every(r=>r.status==='rejected')).toBe(true);await expect(t.respond(body)).rejects.toThrow(/cancel/i);expect(f.sizes).toEqual([1]);
});
it('holds fanout when seed usage is absent and keeps the completed result',async()=>{
 const [body]=await requests(),f=fixture();const content=f.client.files.content;
 f.client.files.content=async id=>{const r=await content(id);return {text:async()=>(await r.text()).replace(/,"usage":\{[^\n]+?\}\}/g,'')};};
 const t=new GithubBatchTransport({client:f.client,flushMs:1});const result=await Promise.allSettled([t.respond(body),t.respond(body)]);
 expect(f.sizes).toEqual([1]);expect(result[0].status).toBe('fulfilled');expect(result[0].value._photoSelectCache.cachedTokens).toBeNull();expect(result[1].status).toBe('rejected');
});
it('does not promote writes, tiny reads, missing tools or stale code to live acceptance',async()=>{
 const {evaluateGithubCacheCanary}=await import('../evals/evaluate-github-cache.mjs');
 const hash='a'.repeat(64),receipt={status:'passed',requested:3,completed:3,implementationSha256:{'src/fixture.js':hash},usages:['seed','probe','reader'].map(role=>({role,key:'shared',curationStatus:'completed',githubToolCalled:true,inputTokens:4500,cachedTokens:role==='seed'?0:4000,writeTokens:role==='seed'?4000:0,requiredCachedTokens:3500,verified:role!=='seed'}))};
 expect(evaluateGithubCacheCanary(receipt,receipt.implementationSha256)).toEqual([]);
 for(const mutate of [r=>{r.usages[1].cachedTokens=0;r.usages[1].writeTokens=4000;},r=>{r.usages[1].cachedTokens=128;},r=>{r.usages[1].githubToolCalled=false;},r=>{r.usages.pop();},r=>{r.status='held';}]){const changed=structuredClone(receipt);mutate(changed);expect(evaluateGithubCacheCanary(changed,receipt.implementationSha256).length).toBeGreaterThan(0);}
 expect(evaluateGithubCacheCanary(receipt,{'src/fixture.js':'b'.repeat(64)})).toContain('implementation-changed');
});
it('states dynamic minutes bounds when a direct caller supplies no rendered prompt',async()=>{
 let request;const p=new GithubCurationProvider({tunnelId,curators:base,brief,encodeImage:async()=>Buffer.from('image'),respond:async r=>{request=r;return reply('a.jpg');}});
 await p.chat({model:'gpt-5.6-terra',images:['a.jpg'],minutesMin:1,minutesMax:7});
 expect(requestInstructions(request)).toContain('Produce between 1 and 7 diarized items');
});

it('accepts four complete Flex curations and rejects a miss in either reader',async()=>{
 const {evaluateGithubCacheCanary}=await import('../evals/evaluate-github-cache.mjs');
 const hash='a'.repeat(64),receipt={schemaVersion:2,transport:'flex',context:{textTokens:3600},status:'passed',requested:4,completed:4,implementationSha256:{'src/fixture.js':hash},usages:['seed','probe','reader','reader'].map(role=>({role,key:'shared',serviceTier:'flex',requestedTier:'flex',fullBriefPreserved:true,curationStatus:'completed',githubToolCalled:true,inputTokens:4500,cachedTokens:role==='seed'?0:4000,writeTokens:role==='seed'?4000:0,requiredCachedTokens:3500,verified:role!=='seed'}))};
 expect(evaluateGithubCacheCanary(receipt,receipt.implementationSha256)).toEqual([]);
 for(const mutate of [r=>{r.usages[3].cachedTokens=0;r.usages[3].writeTokens=4000;},r=>{r.usages[2].cachedTokens=128;},r=>{r.usages[3].serviceTier='default';},r=>{r.usages[1].requestedTier='default';},r=>{r.usages[1].fullBriefPreserved=false;},r=>{r.usages[3].githubToolCalled=false;},r=>{r.transport='batch';},r=>{r.context.textTokens=10;},r=>{r.usages[3].key='changed';},r=>{r.usages.pop();},r=>{r.status='held';}]){const changed=structuredClone(receipt);mutate(changed);expect(evaluateGithubCacheCanary(changed,receipt.implementationSha256).length).toBeGreaterThan(0);}
 expect(evaluateGithubCacheCanary(receipt,{'src/fixture.js':'b'.repeat(64)})).toContain('implementation-changed');
 const warm=structuredClone(receipt);Object.assign(warm.usages[0],{cachedTokens:4000,writeTokens:0,verified:true});warm.usages[1].role='reader';
 expect(evaluateGithubCacheCanary(warm,receipt.implementationSha256)).toEqual([]);
});

it('evaluates supplied-context cache reuse separately from discretionary GitHub tool execution',async()=>{
 const {evaluateGithubCacheCanary}=await import('../evals/evaluate-github-cache.mjs');
 const hash='a'.repeat(64),receipt={schemaVersion:2,transport:'flex',toolUseRequired:false,context:{textTokens:3600},status:'passed',requested:4,completed:4,implementationSha256:{'src/fixture.js':hash},usages:['seed','probe','reader','reader'].map(role=>({role,key:'shared',serviceTier:'flex',requestedTier:'flex',fullBriefPreserved:true,curationStatus:'completed',githubToolAvailable:true,githubToolCalled:false,inputTokens:4500,cachedTokens:role==='seed'?0:4000,writeTokens:role==='seed'?4000:0,requiredCachedTokens:3500,verified:role!=='seed'}))};
 expect(evaluateGithubCacheCanary(receipt,receipt.implementationSha256)).toEqual([]);
 for(const mutate of [r=>{delete r.toolUseRequired;},r=>{r.usages[2].githubToolAvailable=false;},r=>{r.usages[2].fullBriefPreserved=false;},r=>{r.usages[2].cachedTokens=0;r.usages[2].writeTokens=4000;}]){
  const changed=structuredClone(receipt);mutate(changed);
  expect(evaluateGithubCacheCanary(changed,receipt.implementationSha256).length).toBeGreaterThan(0);
 }
});
