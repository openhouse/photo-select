import {expect,it} from 'vitest';
import {GithubCurationProvider} from '../src/providers/github.js';
import {GithubBatchTransport} from '../src/githubBatch.js';
import {sha256} from '../src/core/knowledgeLive.js';
const tunnelId='tunnel_'+'a'.repeat(32),brief=Array.from({length:300},(_,i)=>`Record ${i}: amber bridge cedar delta field.\n`).join('');
const cipher='gAAAAA'+'X'.repeat(80)+'sk-'+'A'.repeat(703)+'-opaque';
const value={minutes:[{speaker:'Base',text:'What next?'}],decisions:[{filename:'a.jpg',decision:'keep',reason:'Visible form.'}]};
const response={id:'synthetic-response',status:'completed',output:[{type:'reasoning',id:'synthetic-reasoning',summary:[],encrypted_content:cipher},{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]};
function provider(reply=response){const saved=[],calls=[];return {saved,calls,p:new GithubCurationProvider({tunnelId,curators:['Base'],encodeImage:async()=>Buffer.from('image'),save:async r=>saved.push(r),respond:async body=>{calls.push(structuredClone(body));return reply;}})};}
it('accepts curation when only opaque API reasoning matches a credential pattern, saving omission hashes',async()=>{
 const f=provider();expect((await f.p.chat({images:['a.jpg']})).json).toEqual(value);
 expect(f.calls).toHaveLength(1);expect(f.saved[0].status).toBe('completed');
 const attempt=f.saved[0].attempts[0];expect(attempt.response_sha256).toBe(sha256(response));
 expect(attempt.response.output[0]).not.toHaveProperty('encrypted_content');
 expect(attempt.omittedEncryptedReasoning).toEqual([{path:['output',0,'encrypted_content'],sha256:sha256(cipher),bytes:Buffer.byteLength(cipher)}]);
 expect(JSON.stringify(f.saved)).not.toContain(cipher);expect(response.output[0].encrypted_content).toBe(cipher);
});
it.each(['summary','tool-output','message','nested-tool-reasoning'])('still holds readable credentials in %s while omitting opaque API ciphertext',async location=>{
 const secret='ghp_'+'B'.repeat(36),r=structuredClone(response);
 if(location==='summary')r.output[0].summary=[{type:'summary_text',text:secret}];
 if(location==='tool-output')r.output.push({type:'mcp_call',name:'get_file_contents',output:JSON.stringify({encrypted_content:secret})});
 if(location==='message')r.output[1].content[0].text=secret;
 if(location==='nested-tool-reasoning')r.output.push({type:'mcp_call',output:JSON.stringify({type:'reasoning',encrypted_content:secret})});
 const f=provider(r);await expect(f.p.chat({images:['a.jpg']})).rejects.toThrow(/Credential/);
 expect(f.saved[0].status).toBe('held');expect(JSON.stringify(f.saved)).not.toContain(secret);expect(JSON.stringify(f.saved)).not.toContain(cipher);
 expect(f.saved[0].attempts[0].omittedEncryptedReasoning).toHaveLength(1);
});
const discoveryError=()=>Object.assign(Error("424 Error retrieving tool list from MCP server: 'github'. Http status code: 424 (Failed Dependency)"),{status:424,code:'http_error',type:'external_connector_error',param:'tools'});
function transportFixture(create,{signal,retryDelayMs=1}={}){
 const calls=[],saved=[],receipts=[],progress=[];
 const client={responses:{create:async(body,options)=>{calls.push({body:structuredClone(body),options});const number=calls.length;await create?.(number,options);const filenames=JSON.parse(body.input.at(-1).content[0].text).filenames;return {id:'response-'+number,status:'completed',service_tier:'flex',usage:{input_tokens:4500,input_tokens_details:{cached_tokens:number===1?0:4000,cache_write_tokens:number===1?4000:0}},output:[{...response.output[0]},...response.output.slice(1).map(item=>({...item,content:[{type:'output_text',text:JSON.stringify({...value,decisions:filenames.map(filename=>({...value.decisions[0],filename}))})}]}))]};}}};
 const transport=new GithubBatchTransport({client,signal,retryDelayMs,saveReceipt:async r=>receipts.push(structuredClone(r)),progress:line=>progress.push(line)});
 const p=new GithubCurationProvider({tunnelId,curators:['Base'],brief,cacheServiceTier:'flex',respond:body=>transport.respond(body),encodeImage:async()=>Buffer.from('image'),save:async r=>saved.push(r)});
 return {p,calls,saved,receipts,progress};
}
const chat=(p,i=0)=>p.chat({model:'gpt-5.6-terra',images:[i+'.jpg']});
it('recovers a transient tool-discovery failure in a reader wave and completes all twenty queued curations',async()=>{
 const f=transportFixture(async n=>{if(n===12)throw discoveryError();});
 const results=await Promise.allSettled(Array.from({length:20},(_,i)=>chat(f.p,i)));
 expect(results.every(r=>r.status==='fulfilled')).toBe(true);expect(f.saved).toHaveLength(20);
 expect(f.calls).toHaveLength(21);expect(f.saved.every(r=>r.status==='completed')).toBe(true);
 const retry=f.receipts.find(r=>r.status==='retrying');expect(retry.errors[0]).toMatchObject({status:424,type:'external_connector_error'});
 expect(f.receipts.filter(r=>r.runId===retry.runId).at(-1)).toMatchObject({status:'completed',attempt:2});
 expect(f.progress.join('\n')).toContain('tool discovery');
});
it('bounds persistent discovery recovery and preserves every failed-attempt diagnostic',async()=>{
 const f=transportFixture(async()=>{throw discoveryError();});
 await expect(chat(f.p)).rejects.toThrow(/GitHub/);expect(f.calls).toHaveLength(5);
 expect(f.receipts.at(-1)).toMatchObject({status:'held',attempt:5});expect(f.receipts.at(-1).errors).toHaveLength(5);
});
it.each(['other-server','unknown-424','auth','mid-inference'])('does not replay an unclassified or later failure: %s',async kind=>{
 const error=discoveryError();if(kind==='other-server')error.message=error.message.replace("'github'","'other'");
 if(kind==='unknown-424')error.message='dependency failure';if(kind==='auth')error.status=401;
 if(kind==='mid-inference')error.message='Error calling tool get_file_contents';
 const f=transportFixture(async()=>{throw error;});await expect(chat(f.p)).rejects.toThrow();expect(f.calls).toHaveLength(1);
});
it('cancels during discovery backoff without sending another request',async()=>{
 const abort=new AbortController(),f=transportFixture(async()=>{setTimeout(()=>abort.abort(),5);throw discoveryError();},{signal:abort.signal,retryDelayMs:100});
 await expect(chat(f.p)).rejects.toThrow();expect(f.calls).toHaveLength(1);expect(abort.signal.aborted).toBe(true);expect(f.receipts.at(-1).status).toBe('cancelled');
});
