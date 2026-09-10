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
 expect(r.input[0].content.some(p=>p.type==='input_image')).toBe(true);expect(r.text.format.schema.properties.minutes.items.properties.speaker.enum).toEqual(curators);expect(saved[0].attempts[0].response).toEqual(response(json));
});
it('repairs once with the same images, brief, tools and roster, saving both attempts',async()=>{
 const calls=[],saved=[];const p=new GithubCurationProvider({tunnelId,curators,respond:async r=>{calls.push(r);return calls.length===1?response({...json,minutes:[{speaker:'Invented',text:'Hi?'}]}):response(json);},encodeImage:async()=>Buffer.from('image'),save:async r=>saved.push(r)});
 await p.chat({model:'gpt-5.6-terra',images:['one.jpg']});expect(calls).toHaveLength(2);for(const key of ['input','tools','text'])expect(calls[1][key]).toEqual(calls[0][key]);expect(saved[0].retry_recovered).toBe(true);expect(saved[0].attempts).toHaveLength(2);
});
it('holds missing or duplicate image decisions and invented voices',()=>{
 for(const bad of [{...json,decisions:[]},{...json,decisions:[...json.decisions,...json.decisions]},{...json,minutes:[{speaker:'other',text:'Next?'}]}])expect(()=>validateGithubReply(bad,['one.jpg'],curators,[])).toThrow();
});
it('accepts a citation backed by an actual file read and holds an invented URL',()=>{
 const source={type:'mcp_call',server_label:'github',name:'get_file_contents',arguments:JSON.stringify({owner:'colleague',repo:'wiki',path:'notes.md',ref:'a'.repeat(40)}),output:'source text'};
 const url='https://github.com/colleague/wiki/blob/'+ 'a'.repeat(40)+'/notes.md';
 expect(()=>validateGithubReply({...json,decisions:[{...json.decisions[0],reason:url}]},['one.jpg'],curators,[source])).not.toThrow();
 expect(()=>validateGithubReply({...json,decisions:[{...json.decisions[0],reason:url+'/invented'}]},['one.jpg'],curators,[source])).toThrow();
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
