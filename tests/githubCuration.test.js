import {githubRequestData} from './helpers/githubRequest.js';
import {it,expect,vi} from 'vitest';
import {GithubCurationProvider} from '../src/providers/github.js';
import {githubTool,validateGithubReply} from '../src/core/githubCuration.js';
const tunnelId='tunnel_'+ 'a'.repeat(32),curators=['Prof. Margaret Morse','MM Bakhtin'];
const json={minutes:[{speaker:curators[0],text:'Visible form.'},{speaker:curators[1],text:'What should we read next?'}],decisions:[{filename:'one.jpg',decision:'keep',reason:'Form.'}]};
const response=value=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
it('attaches a credential-free private tunnel to the image call with the exact custom roster',async()=>{
 const calls=[],saved=[];const p=new GithubCurationProvider({tunnelId,curators,brief:'Read https://github.com/colleague/private-wiki',respond:async r=>{calls.push(r);return response(json);},encodeImage:async()=>Buffer.from('synthetic'),save:async r=>saved.push(r)});
 expect(calls).toHaveLength(0);expect((await p.chat({model:'gpt-5.6-terra',images:['/private/one.jpg'],reasoningEffort:'high'})).json).toEqual(json);
 const r=calls[0];expect(r.model).toBe('gpt-5.6-terra');expect(r.reasoning.effort).toBe('high');expect(r.tools).toEqual([githubTool(tunnelId)]);expect(r.tools[0]).not.toHaveProperty('authorization');expect(r.tools[0]).not.toHaveProperty('server_url');expect(r.store).toBe(false);
 expect(r.input[0].content.some(p=>p.type==='input_image')).toBe(true);expect(r.text.format.schema.properties.minutes.items.properties.speaker).toEqual({type:'string'});expect(saved[0].attempts[0].response).toEqual(response(json));
});
it('repairs once with the same images, brief, tools and roster, saving both attempts',async()=>{
 const calls=[],saved=[];const p=new GithubCurationProvider({tunnelId,curators,respond:async r=>{calls.push(r);return calls.length===1?response({...json,minutes:[{speaker:123,text:'Hi?'}]}):response(json);},encodeImage:async()=>Buffer.from('image'),save:async r=>saved.push(r)});
 await p.chat({model:'gpt-5.6-terra',images:['one.jpg']});expect(calls).toHaveLength(2);for(const key of ['input','tools','text'])expect(calls[1][key]).toEqual(calls[0][key]);expect(saved[0].retry_recovered).toBe(true);expect(saved[0].attempts).toHaveLength(2);
});
it('holds missing or duplicate image decisions and non-text speaker labels',()=>{
 for(const bad of [{...json,decisions:[]},{...json,decisions:[...json.decisions,...json.decisions]},{...json,minutes:[{speaker:123,text:'Next?'}]}])expect(()=>validateGithubReply(bad,['one.jpg'],curators,[])).toThrow();
});
it('accepts ordinary GitHub links without imposing an additional citation contract',()=>{
 const source={type:'mcp_call',server_label:'github',name:'get_file_contents',arguments:JSON.stringify({owner:'colleague',repo:'wiki',path:'notes.md',ref:'a'.repeat(40)}),output:'source text'};
 const url='https://github.com/colleague/wiki/blob/'+ 'a'.repeat(40)+'/notes.md';
 expect(()=>validateGithubReply({...json,decisions:[{...json.decisions[0],reason:url}]},['one.jpg'],curators,[source])).not.toThrow();
 expect(()=>validateGithubReply({...json,decisions:[{...json.decisions[0],reason:url+'/invented'}]},['one.jpg'],curators,[source])).not.toThrow();
});
it('holds approval requests, incomplete replies and tool errors without pretending curation succeeded',async()=>{
 for(const value of [{...response(json),status:'incomplete'},{...response(json),output:[{type:'mcp_approval_request'}]},{...response(json),output:[...response(json).output,{type:'mcp_call',error:{message:'denied'}}]}]){
  const save=vi.fn();const p=new GithubCurationProvider({tunnelId,curators,respond:async()=>value,encodeImage:async()=>Buffer.from('x'),save});await expect(p.chat({images:['one.jpg']})).rejects.toThrow();expect(save.mock.calls.at(-1)[0].status).toBe('held');
 }
});
it('fails after two invalid replies and keeps their audit',async()=>{
 const respond=vi.fn(async()=>response({})),save=vi.fn();const p=new GithubCurationProvider({tunnelId,curators,respond,save,encodeImage:async()=>Buffer.from('x')});await expect(p.chat({images:['one.jpg']})).rejects.toThrow();expect(respond).toHaveBeenCalledTimes(2);expect(save.mock.calls.at(-1)[0].attempts).toHaveLength(2);
});
it('rejects unknown tunnel IDs before requesting or encoding anything',()=>{expect(()=>githubTool('https://elsewhere.invalid')).toThrow();});
it('never repeats a paid curation when private persistence fails',async()=>{
 const respond=vi.fn(async()=>response(json)),save=vi.fn(async()=>{throw Error('disk unavailable');});const p=new GithubCurationProvider({tunnelId,curators,respond,save,encodeImage:async()=>Buffer.from('x')});await expect(p.chat({images:['one.jpg']})).rejects.toThrow();expect(respond).toHaveBeenCalledTimes(1);
});

it('accepts an immutable file citation when GitHub calls the commit parameter sha',()=>{
 const sha='b'.repeat(40),source={type:'mcp_call',server_label:'github',name:'get_file_contents',arguments:JSON.stringify({owner:'fixture',repo:'wiki',path:'README.md',sha}),output:'Read source body'};
 const reply={...json,decisions:[{...json.decisions[0],reason:'https://github.com/fixture/wiki/blob/'+sha+'/README.md'}]};expect(()=>validateGithubReply(reply,['one.jpg'],curators,[source])).not.toThrow();
});

it('preserves an actionable Batch failure reason in the private curation record',async()=>{
 const saved=[],failure=Object.assign(Error('Context exceeds the model window; use a shorter brief.'),{code:'KNOWLEDGE_HELD',receipt:{status:'held',errors:[{code:'context_length_exceeded'}]}});
 const p=new GithubCurationProvider({tunnelId,curators,respond:async()=>{throw failure;},save:async r=>saved.push(r),encodeImage:async()=>Buffer.from('x')});
 await expect(p.chat({images:['one.jpg']})).rejects.toThrow(/shorter brief/);
 expect(saved[0].reason).toMatch(/shorter brief/);expect(saved[0].transport.errors[0].code).toBe('context_length_exceeded');expect(saved[0].attempts).toHaveLength(0);
});

it('preserves a redacted response and safe trigger location when the credential filter holds it',async()=>{
 const saved=[],secret='sk-proj-'+ 'A'.repeat(40),r=response({...json,minutes:[{speaker:curators[0],text:'Example '+secret},{speaker:curators[1],text:'Next?'}]});
 r._photoSelectBatch={status:'completed',batchId:'batch_synthetic'};
 const respond=vi.fn(async()=>r),p=new GithubCurationProvider({tunnelId,curators,respond,save:async r=>saved.push(r),encodeImage:async()=>Buffer.from('x')});
 await expect(p.chat({images:['one.jpg']})).rejects.toThrow(/Credential-like/);
 expect(respond).toHaveBeenCalledTimes(1);expect(saved[0].status).toBe('held');
 expect(saved[0].attempts).toHaveLength(1);
 const attempt=saved[0].attempts[0];expect(attempt.redacted).toBe(true);
 expect(attempt.credentialFindings[0]).toMatchObject({path:['output',0,'content',0,'text'],kind:'openai-token',length:48});
 expect(attempt.response.output[0].content[0].text).toBe('[credential-like content redacted]');
 expect(attempt.response_sha256).toMatch(/^[a-f0-9]{64}$/);
 expect(saved[0].transport.batchId).toBe('batch_synthetic');
 expect(JSON.stringify(saved)).not.toContain(secret);expect(r.output[0].content[0].text).toContain(secret);
});
it('lets curation recover from a missing-file tool result without citing the failed lookup',async()=>{
 const {githubSources}=await import('../src/core/githubCuration.js');
 const missing={type:'mcp_call',name:'get_file_contents',server_label:'github',status:'completed',arguments:JSON.stringify({owner:'fixture',repo:'wiki',path:'missing.md',ref:'a'.repeat(40)}),output:JSON.stringify({isError:true,code:'github_read_unavailable',message:'File missing.'})};
 const value={...response(json),output:[missing,...response(json).output]},saved=[];
 const p=new GithubCurationProvider({tunnelId,curators,respond:async()=>value,save:async r=>saved.push(r),encodeImage:async()=>Buffer.from('x')});
 await expect(p.chat({images:['one.jpg']})).resolves.toMatchObject({json});expect(githubSources([missing])).toEqual([]);expect(saved[0].sources).toEqual([]);
});

it('redacts entire private-key strings and credential-bearing keys without changing the source object',async()=>{
 const {redactCredentialContent,credentialLike}=await import('../src/core/githubBridge.js');
 const key='ghp_'+'B'.repeat(36),body='PRIVATE-KEY-BODY-MUST-NOT-SURVIVE';
 const original={output:[{[key]:'value',pem:'BEGIN PRIVATE KEY\n'+body+'\nEND PRIVATE KEY',safe:'retained'}]};
 const before=JSON.stringify(original),result=redactCredentialContent(original);
 expect(credentialLike(result.value)).toBe(false);
 expect(JSON.stringify(result)).not.toContain(key);expect(JSON.stringify(result)).not.toContain(body);
 expect(result.value.output[0].safe).toBe('retained');expect(result.findings).toHaveLength(2);
 expect(JSON.stringify(original)).toBe(before);
});
it('records that a credential-like substring is embedded in a word without retaining the match',async()=>{
 const {redactCredentialContent}=await import('../src/core/githubBridge.js');
 const result=redactCredentialContent({path:'task-knowledge-context-projection.json'});
 expect(result.findings).toHaveLength(1);expect(result.findings[0].embeddedInWord).toBe(true);
 expect(result.value.path).toBe('[credential-like content redacted]');
 expect(JSON.stringify(result)).not.toContain('task-knowledge-context-projection');
});

it('keeps an expanded batch roster through repair without changing the base roster',async()=>{
 const guest='Pat (artist + neighbor)',expanded=[...curators,guest],calls=[],saved=[];
 const valid={...json,minutes:[{speaker:guest,text:'What does the image suggest?'}]};
 const p=new GithubCurationProvider({tunnelId,curators,encodeImage:async()=>Buffer.from('image'),save:async r=>saved.push(r),respond:async r=>{calls.push(r);return response(calls.length===1?{...json,minutes:[{speaker:123,text:'Next?'}]}:valid);}});
 expect((await p.chat({images:['one.jpg'],curators:expanded})).json).toEqual(valid);
 expect(calls).toHaveLength(2);for(const r of calls){expect(githubRequestData(r).curators).toEqual(expanded);expect(githubRequestData(r).curators).toEqual(expanded);expect(r.instructions).toContain(guest);}
 expect(saved[0].retry_recovered).toBe(true);expect(p.curators).toEqual(curators);
});
it('isolates additional voices across twenty concurrent batches',async()=>{
 const saved=[];let started=0,release;const barrier=new Promise(resolve=>release=resolve);
 const p=new GithubCurationProvider({tunnelId,curators,encodeImage:async()=>Buffer.from('image'),save:async r=>saved.push(r),respond:async r=>{
  const body=githubRequestData(r);if(++started===20)release();await barrier;
  const speaker='Guest '+body.filenames[0].split('.')[0];
  return response({minutes:[{speaker,text:'What next?'}],decisions:[{filename:body.filenames[0],decision:'keep',reason:'Form.'}]});
 }});
 const results=await Promise.all(Array.from({length:20},(_,i)=>p.chat({images:[i+'.jpg'],curators:[...curators,'Guest '+i]})));
 expect(results).toHaveLength(20);expect(saved).toHaveLength(20);expect(p.curators).toEqual(curators);
 for(const r of saved){const body=githubRequestData(r.request);expect(body.curators).toEqual([...curators,'Guest '+body.filenames[0].split('.')[0]]);expect(r.json.minutes[0].speaker).toBe(body.curators.at(-1));}
});
it.each([[],['Replacement'],[...curators].reverse(),[...curators,curators[0]]].map(proposed=>({proposed})))('rejects a batch roster that replaces or duplicates the base: %j',async({proposed})=>{
 const respond=vi.fn(async()=>response(json));
 const p=new GithubCurationProvider({tunnelId,curators,respond,encodeImage:async()=>Buffer.from('image')});
 await expect(p.chat({images:['one.jpg'],curators:proposed})).rejects.toThrow();expect(respond).not.toHaveBeenCalled();
});
