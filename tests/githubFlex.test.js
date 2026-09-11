import {expect,it,vi} from 'vitest';
import {GithubCurationProvider} from '../src/providers/github.js';
import {GithubBatchTransport} from '../src/githubBatch.js';
import {sha256} from '../src/core/knowledgeLive.js';
const brief=Array.from({length:300},(_,i)=>`Record ${i}: amber bridge cedar delta field.\n`).join('');
const tunnelId='tunnel_'+'a'.repeat(32);
const reply=(body,number=1)=>({id:'response-'+number,status:'completed',service_tier:'flex',usage:{input_tokens:4500,input_tokens_details:{cached_tokens:number===1?0:4000,cache_write_tokens:number===1?4000:0}},output_text:JSON.stringify({minutes:[{speaker:'Base',text:'What next?'}],decisions:JSON.parse(body.input.at(-1).content[0].text).filenames.map(filename=>({filename,decision:'keep',reason:'Visible form.'}))})});
function fixture(create){const calls=[],receipts=[],saved=[],progress=[];const client={responses:{create:(body,options)=>{calls.push({body:structuredClone(body),options});return create?create(body,calls.length,options):Promise.resolve(reply(body,calls.length));}},files:{create:async()=>{throw Error('Cacheable requests must not upload Batch files.');}}};const transport=new GithubBatchTransport({client,flushMs:1,progress:line=>progress.push(line),saveReceipt:async r=>receipts.push(structuredClone(r)),retryDelayMs:1});const provider=new GithubCurationProvider({tunnelId,curators:['Base'],brief,cacheServiceTier:'flex',respond:body=>transport.respond(body),encodeImage:async()=>Buffer.from('image'),save:async r=>saved.push(r)});return {provider,transport,calls,receipts,saved,progress};}
const chat=(provider,file='a.jpg')=>provider.chat({model:'gpt-5.6-terra',reasoningEffort:'high',images:[file]});
it('routes cacheable GitHub curation through explicit Flex with matching private request hashes',async()=>{
 const f=fixture();await chat(f.provider);await chat(f.provider,'b.jpg');
 expect(f.calls).toHaveLength(2);for(const c of f.calls){expect(c.body.service_tier).toBe('flex');expect(c.body.store).toBe(false);expect(c.body.tools[0].tunnel_id).toBe(tunnelId);expect(c.options).toMatchObject({timeout:900000,maxRetries:0});}
 expect(f.saved.map(r=>r.attempts[0].response._photoSelectCache.role)).toEqual(['seed','probe']);
 for(let i=0;i<2;i++){expect(f.saved[i].request).toEqual(f.calls[i].body);expect(f.saved[i].attempts[0].request_sha256).toBe(sha256(f.calls[i].body));}
 expect(f.receipts.filter(r=>r.status==='completed')).toHaveLength(2);expect(f.receipts.every(r=>r.transport==='flex')).toBe(true);
 expect(f.progress.join('\n')).toContain('Flex');expect(JSON.parse(f.calls[1].body.input[0].content[0].text).brief).toBe(brief);
});
it('holds twenty pending jobs behind the Flex seed and confirms reuse before parallel readers',async()=>{
 let active=0,peak=0,release;const gate=new Promise(resolve=>release=resolve);const f=fixture(async(body,n)=>{active++;peak=Math.max(peak,active);if(n===1)await gate;await new Promise(r=>setTimeout(r,2));active--;return reply(body,n);});
 const pending=Promise.allSettled(Array.from({length:20},(_,i)=>chat(f.provider,i+'.jpg')));
 await new Promise(r=>setTimeout(r,15));expect(f.calls).toHaveLength(1);release();expect((await pending).every(r=>r.status==='fulfilled')).toBe(true);
 expect(peak).toBe(8);expect(f.calls).toHaveLength(20);expect(f.saved).toHaveLength(20);expect(f.saved.every(r=>r.status==='completed')).toBe(true);
 expect(f.saved.slice(0,2).map(r=>r.attempts[0].response._photoSelectCache.role)).toEqual(['seed','probe']);
});
it.each(['billing_hard_limit_reached','invalid_api_key'])('does not retry or change tier on %s',async code=>{
 const f=fixture(async()=>{throw Object.assign(Error('Do not echo raw API prose'),{code,status:400});});
 const result=await Promise.allSettled(Array.from({length:20},()=>chat(f.provider)));
 expect(f.calls).toHaveLength(1);expect(result.every(r=>r.status==='rejected')).toBe(true);expect(f.receipts.at(-1).errors[0].code).toBe(code);expect(f.saved.every(r=>r.status==='held')).toBe(true);
});
it('retries a rejected Flex resource request in the same tier, with a bounded policy',async()=>{
 const f=fixture(async(body,n)=>{if(n<3)throw Object.assign(Error('Unavailable'),{code:'resource_unavailable',status:429});return reply(body,1);});
 await chat(f.provider);expect(f.calls).toHaveLength(3);expect(f.calls.every(c=>c.body.service_tier==='flex')).toBe(true);expect(f.saved[0].status).toBe('completed');
 const rejected=fixture(async()=>{throw Object.assign(Error('Unavailable'),{code:'resource_unavailable',status:429});});
 await expect(chat(rejected.provider)).rejects.toThrow(/Flex/);expect(rejected.calls).toHaveLength(3);
});
it('retains a response but holds curation and the queue if the API returns a different tier',async()=>{
 const f=fixture(async body=>({...reply(body),service_tier:'default'}));
 const results=await Promise.allSettled([chat(f.provider),chat(f.provider,'b.jpg')]);
 expect(f.calls).toHaveLength(1);expect(results.every(r=>r.status==='rejected')).toBe(true);expect(f.saved.some(r=>r.attempts[0]?.response.service_tier==='default')).toBe(true);
});
it('never retries an uncertain connection timeout or a successful cache miss',async()=>{
 const f=fixture(async()=>{throw Object.assign(Error('timeout'),{name:'APIConnectionTimeoutError'});});await expect(chat(f.provider)).rejects.toThrow();expect(f.calls).toHaveLength(1);
 const miss=fixture(async body=>reply(body,1));const r=await Promise.allSettled([chat(miss.provider),chat(miss.provider,'b.jpg'),chat(miss.provider,'c.jpg')]);expect(miss.calls).toHaveLength(2);expect(r.map(x=>x.status)).toEqual(['fulfilled','fulfilled','rejected']);
});
