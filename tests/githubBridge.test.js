import {describe,it,expect,vi} from 'vitest';
import {createGithubBridge,createGithubTransport} from '../src/githubBridge.js';
const tool=(name,readOnly=true)=>({name,description:name,inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:readOnly}});
const call=(name,args={},id=2)=>({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
const list={jsonrpc:'2.0',id:1,method:'tools/list'};
const secret='SYNTHETIC_GITHUB_CREDENTIAL';
function fixture(){
 const calls=[];const request=async message=>{calls.push(message);if(message.method==='tools/list')return {jsonrpc:'2.0',id:message.id,result:{tools:[tool('get_me'),tool('list_branches'),tool('get_file_contents'),tool('search_repositories'),tool('run_secret_scanning'),tool('push_files',false)]}};return {jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:JSON.stringify({login:'fixture',source:'Synthetic private source',repository:message.params.arguments.repo})}]}};};
 return {calls,bridge:createGithubBridge({request})};
}
describe('private GitHub MCP bridge',()=>{
 it('exposes only approved read tools even if upstream adds other tools',async()=>{
  const {bridge}=fixture();const result=await bridge(list);expect(result.result.tools.map(x=>x.name)).toEqual(['get_me','list_branches','get_file_contents','search_repositories']);
 });
 it('reads a private collaborator repository on demand without a prebuilt catalog',async()=>{
  const {bridge,calls}=fixture();expect(calls).toEqual([]);
  const result=await bridge(call('get_file_contents',{owner:'another-owner',repo:'ordinary-private-name',path:'README.md',ref:'a'.repeat(40)}));
  expect(result.result.content[0].text).toContain('Synthetic private source');
  expect(calls.at(-1).params.arguments).toEqual({owner:'another-owner',repo:'ordinary-private-name',path:'README.md',ref:'a'.repeat(40)});
 });
 it.each(['push_files','create_branch','run_secret_scanning','unknown'])('rejects %s without executing it',async name=>{
  const {bridge,calls}=fixture();expect((await bridge(call(name))).error.code).toBe(-32601);expect(calls.some(x=>x.method==='tools/call')).toBe(false);
 });
 it.each(['.env','dir/.env.local','secrets.json','id_rsa','../.env'])('holds direct credential-file reads: %s',async path=>{
  const {bridge,calls}=fixture();const result=await bridge(call('get_file_contents',{owner:'fixture',repo:'wiki',path}));expect(result.error).toBeTruthy();expect(calls.some(x=>x.method==='tools/call')).toBe(false);
 });
 it('does not execute arbitrary methods, URLs or non-object arguments',async()=>{
  const {bridge,calls}=fixture();
  for(const request of [{jsonrpc:'2.0',id:1,method:'exec',params:{command:'anything'}},call('get_file_contents','anything'),{method:'tools/list',id:2}])expect((await bridge(request)).error).toBeTruthy();
  expect(calls).toEqual([]);
 });
 it('refuses an allowed name when the server no longer marks it read-only',async()=>{
  const bridge=createGithubBridge({request:async message=>({jsonrpc:'2.0',id:message.id,result:{tools:[tool('get_file_contents',false)]}})});
  expect((await bridge(call('get_file_contents'))).error).toBeTruthy();
 });
 it('does not claim successful tool execution when GitHub reports an error',async()=>{
  const bridge=createGithubBridge({request:async m=>m.method==='tools/list'?{id:m.id,result:{tools:[tool('get_me')]}}:{id:m.id,error:{code:401,message:'denied'}}});
  const result=await bridge(call('get_me'));expect(result.error).toBeTruthy();expect(result.result).toBeUndefined();
 });
 it('holds credential-like source output instead of returning it through MCP',async()=>{
  const bridge=createGithubBridge({request:async m=>m.method==='tools/list'?{id:m.id,result:{tools:[tool('get_file_contents')]}}:{id:m.id,result:{content:[{type:'text',text:'ghp_'+ 'A'.repeat(36)}]}}});
  const result=await bridge(call('get_file_contents',{path:'README.md'}));expect(result.error).toBeTruthy();expect(JSON.stringify(result)).not.toContain('A'.repeat(36));
 });
 it('keeps twenty simultaneous results bound to their own call IDs',async()=>{
  const {bridge}=fixture();const results=await Promise.all(Array.from({length:20},(_,i)=>bridge(call('get_me',{},i+100))));expect(results.map(x=>x.id)).toEqual(Array.from({length:20},(_,i)=>i+100));expect(results.every(x=>x.result?.content)).toBe(true);
 });
 it('does not forward initialization, pings or notifications as GitHub source reads',async()=>{
  const {bridge,calls}=fixture();expect((await bridge({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26'}})).result.capabilities).toEqual({tools:{}});
  expect(await bridge({jsonrpc:'2.0',method:'notifications/initialized'})).toBeUndefined();expect((await bridge({jsonrpc:'2.0',id:3,method:'ping'})).result).toEqual({});expect(calls).toEqual([]);
 });
});
describe('GitHub credential transport',()=>{
 it('uses the credential only at the fixed GitHub origin and parses SSE',async()=>{
  const sent=[];const request=createGithubTransport({getToken:async()=>secret,fetch:async(url,options)=>{sent.push({url,options});return new Response('event: message\ndata: '+JSON.stringify({jsonrpc:'2.0',id:1,result:{tools:[tool('get_me')]}})+'\n\n',{headers:{'Content-Type':'text/event-stream'}});}});
  const result=await request(list);expect(result.result.tools[0].name).toBe('get_me');expect(sent[0].url).toBe('https://api.githubcopilot.com/mcp/readonly');expect(sent[0].options.redirect).toBe('error');expect(sent[0].options.headers.Authorization).toBe('Bearer '+secret);expect(JSON.stringify(result)).not.toContain(secret);
 });
 it('redacts a token echoed by a failed upstream request',async()=>{
  const request=createGithubTransport({getToken:async()=>secret,fetch:async()=>{throw new Error(secret);}});await expect(request(list)).rejects.not.toThrow(secret);
 });
 it('holds the actual credential if GitHub echoes it in a successful result',async()=>{
  const request=createGithubTransport({getToken:async()=>secret,fetch:async()=>new Response(JSON.stringify({id:1,result:{content:[{type:'text',text:secret}]}}))});await expect(request(list)).rejects.not.toThrow(secret);
 });
 it('rejects a mismatched upstream ID',async()=>{
  const request=createGithubTransport({getToken:async()=>secret,fetch:async()=>new Response(JSON.stringify({id:999,result:{tools:[]}}))});await expect(request(list)).rejects.toThrow();
 });
});
it('returns embedded GitHub file text explicitly so API models receive the source, not just a download notice',async()=>{
 const bridge=createGithubBridge({request:async m=>m.method==='tools/list'?{id:m.id,result:{tools:[tool('get_file_contents')]}}:{id:m.id,result:{content:[{type:'text',text:'successfully downloaded text file'},{type:'resource',resource:{uri:'repo://fixture/wiki/notes.md',mimeType:'text/plain',text:'Synthetic source concept: dialogic custody.'}}]}}});
 const result=await bridge(call('get_file_contents',{owner:'fixture',repo:'wiki',path:'notes.md',ref:'a'.repeat(40)}));expect(result.result.content).toHaveLength(1);expect(result.result.content[0].text).toContain('Synthetic source concept: dialogic custody.');expect(result.result.content.every(x=>x.type==='text')).toBe(true);expect(result.result.content.map(x=>x.text).join('\n')).toContain('Synthetic source concept: dialogic custody.');
});
it.each(['%2eenv','dir/%2eenv.local','%252eenv','dir\\.env'])('holds encoded credential paths: %s',async path=>{
 const {bridge,calls}=fixture();expect((await bridge(call('get_file_contents',{path}))).error).toBeTruthy();expect(calls.some(x=>x.method==='tools/call')).toBe(false);
});
it('enforces a bound on streamed GitHub response bytes',async()=>{
 const request=createGithubTransport({getToken:async()=>secret,maxResponseBytes:3,fetch:async()=>new Response('too large')});await expect(request(list)).rejects.toThrow();
});
