import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {GITHUB_MCP_URL,GITHUB_READ_TOOLS,credentialLike,allowedGithubTools,githubCallAllowed,readableGithubResult} from './core/githubBridge.js';
const exec=promisify(execFile);
async function githubToken(){
  try{return process.env.GH_TOKEN||process.env.GITHUB_TOKEN||(await exec('gh',['auth','token','--hostname','github.com'])).stdout.trim();}
  catch{throw new Error('GitHub login is unavailable; run gh auth login.');}
}
// The token is used only in the Authorization header to GitHub's own origin.
// It is never returned to the tunnel, included in a tool result, or sent to OpenAI.
export function createGithubTransport({getToken=githubToken,fetch:send=globalThis.fetch,maxResponseBytes=8*1024*1024,signal}={}) {
  return async message=>{
    if(!githubCallAllowed(message))throw new Error('GitHub operation is not allowed.');
    let token;
    try{
      token=await getToken();if(typeof token!=='string'||!token||/\s/.test(token))throw new Error('Invalid GitHub credential.');
      const response=await send(GITHUB_MCP_URL,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify(message),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
      if(!response.ok)throw new Error('GitHub request failed.');
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>maxResponseBytes)throw new Error('GitHub result exceeds limit.');chunks.push(Buffer.from(chunk));}
      const raw=Buffer.concat(chunks).toString('utf8');
      if(raw.includes(token)||credentialLike(raw))throw new Error('Credential-like output held.');
      let result;
      try{result=JSON.parse(raw);}catch{
        for(const event of raw.split(/\r?\n\r?\n/)){
          const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
          if(!data)continue;
          try{const item=JSON.parse(data);if(item.id===message.id){result=item;break;}}catch{/* Ignore non-result SSE notifications. */}
        }
      }
      if(!result||result.id!==message.id||(!result.result&&!result.error))throw new Error('Invalid GitHub MCP response.');
      return result;
    }catch{throw new Error('GitHub MCP request held: verify login, read access, response size and source content.');}
  };
}
export function createGithubBridge({request=createGithubTransport()}={}) {
  let catalog;
  async function tools(id){
    if(!catalog)catalog=request({jsonrpc:'2.0',id,method:'tools/list'}).then(response=>{
      if(response.error)throw new Error('Tool discovery failed.');return allowedGithubTools(response.result?.tools);
    }).catch(error=>{catalog=undefined;throw error;});
    return catalog;
  }
  return async message=>{
    const id=typeof message?.id==='number'||typeof message?.id==='string'?message.id:null;
    const failure=code=>({jsonrpc:'2.0',id,error:{code,message:'Read-only GitHub request held.'}});
    if(message?.jsonrpc!=='2.0'||typeof message.method!=='string')return failure(-32600);
    if(message.method==='notifications/initialized')return undefined;
    if(id===null)return failure(-32600);
    if(message.method==='initialize')return {jsonrpc:'2.0',id,result:{protocolVersion:['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(message.params?.protocolVersion)?message.params.protocolVersion:'2025-03-26',capabilities:{tools:{}},serverInfo:{name:'photo-select-github-readonly',version:'0.1.0'}}};
    if(message.method==='ping')return {jsonrpc:'2.0',id,result:{}};
    if(message.method==='tools/call'&&!GITHUB_READ_TOOLS.includes(message.params?.name))return failure(-32601);
    if(!githubCallAllowed(message))return failure(-32602);
    try{
      const available=await tools(id);
      if(message.method==='tools/list')return {jsonrpc:'2.0',id,result:{tools:available}};
      if(!available.some(tool=>tool.name===message.params.name))return failure(-32601);
      const response=await request({jsonrpc:'2.0',id,method:'tools/call',params:{name:message.params.name,arguments:message.params.arguments??{}}});
      if(response.error||credentialLike(response.result))return failure(-32000);
      return {jsonrpc:'2.0',id,result:readableGithubResult(response.result)};
    }catch{return failure(-32000);}
  };
}
