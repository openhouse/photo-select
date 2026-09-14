import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {githubTool} from './core/githubCuration.js';
import {knowledgeError} from './core/knowledgeLive.js';
const exec=promisify(execFile),codeRoot=fileURLToPath(new URL('..',import.meta.url));
export async function configuredGithubTunnel() {
  if(process.env.PHOTO_SELECT_GITHUB_TUNNEL_ID)return process.env.PHOTO_SELECT_GITHUB_TUNNEL_ID;
  try{return (await exec('git',['-C',codeRoot,'config','--local','--get','photoSelect.githubTunnelId'])).stdout.trim();}
  catch{throw knowledgeError('Create the private GitHub tunnel once; see docs/live-knowledge.md.');}
}
export async function startGithubTunnel({tunnelId,signal}) {
  githubTool(tunnelId);
  if(!process.env.OPENAI_API_KEY)throw knowledgeError('OPENAI_API_KEY is missing.');
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'photo-select-tunnel-'));await fs.chmod(scratch,0o700);
  const healthFile=path.join(scratch,'health.url');
  // Only explicit runtime settings are inherited; never enable raw HTTP logging,
  // a public listener, arbitrary upstreams, or headers from ambient tunnel config.
  const env={PATH:process.env.PATH,HOME:process.env.HOME,OPENAI_API_KEY:process.env.OPENAI_API_KEY};
  for(const key of ['GH_TOKEN','GITHUB_TOKEN','GH_CONFIG_DIR'])if(process.env[key])env[key]=process.env[key];
  const args=['run','--control-plane.tunnel-id',tunnelId,'--control-plane.base-url','https://api.openai.com','--mcp.command',JSON.stringify(process.execPath)+' '+JSON.stringify(path.join(codeRoot,'scripts/github-mcp-bridge.mjs')),'--mcp.max-concurrent-requests','20','--health.listen-addr','127.0.0.1:0','--health.url-file',healthFile,'--log.format','json','--log.level','warn'];
  let exited=false,spawnFailed=false,healthUrl;
  const child=spawn('tunnel-client',args,{env,stdio:['ignore','ignore','ignore']});
  const done=new Promise(resolve=>{child.once('error',()=>{spawnFailed=true;exited=true;resolve();});child.once('exit',()=>{exited=true;resolve();});});
  let stopped=false;
  async function stop(){
    if(stopped)return;stopped=true;signal?.removeEventListener('abort',onAbort);
    if(!exited){child.kill('SIGTERM');await Promise.race([done,delay(5000)]);if(!exited){child.kill('SIGKILL');await done;}}
    await fs.rm(scratch,{recursive:true,force:true});
  }
  const onAbort=()=>{void stop();};signal?.addEventListener('abort',onAbort,{once:true});
  async function assertCurrent(){
    signal?.throwIfAborted();
    if(exited||!healthUrl)throw knowledgeError('The private GitHub tunnel is unavailable.');
    try{const response=await fetch(healthUrl+'/readyz',{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error();}
    catch{throw knowledgeError('The private GitHub tunnel is not ready.');}
  }
  try {
    const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      signal?.throwIfAborted();if(exited)throw knowledgeError(spawnFailed?'Install tunnel-client with brew install openai/tools/tunnel-client.':'Tunnel startup failed; verify the tunnel ID and OpenAI Tunnels Read + Use access.');
      try{healthUrl=(await fs.readFile(healthFile,'utf8')).trim();if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(healthUrl))throw Error();await assertCurrent();return {tunnelId,assertCurrent,stop};}catch{/* Wait for local startup. */}
      await delay(200,undefined,{signal});
    }
    throw knowledgeError('Tunnel startup timed out; verify OpenAI Tunnels Read + Use access.');
  }catch(error){await stop();throw error;}
}
