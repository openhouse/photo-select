import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import OpenAI from 'openai';
import sharp from 'sharp';
import {preparePrivateRun,reuseRepositoryEnvironment} from './knowledgeRun.js';
import {configuredGithubTunnel,startGithubTunnel} from './githubTunnel.js';
import {GithubCurationProvider} from './providers/github.js';
import {GithubBatchTransport} from './githubBatch.js';
import {validateGithubBrief} from './core/githubBrief.js';
import {knowledgeError} from './core/knowledgeLive.js';
const exec=promisify(execFile);
async function atomic(file,value){const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});await fs.rename(temp,file);}
export async function createGithubAudit(root) {
  await exec('git',['init','--quiet',root]);
  await atomic(path.join(root,'.gitignore'),'/images/\n/.cache/\n/runtime.log\n');
  let queue=Promise.resolve();const saved=[];
  return record=>{
    queue=queue.then(async()=>{
      const file=`curation-${String(saved.length+1).padStart(4,'0')}.json`;
      const stamped={...record,recordedAt:new Date().toISOString()};await atomic(path.join(root,file),stamped);saved.push({file,...stamped});
      const notes='# Private photographic field notes\n\n'+saved.map(r=>`## ${r.file}\n\nStatus: ${r.status}\n\n`+(r.json?r.json.minutes.map(m=>`**${m.speaker}:** ${m.text}`).join('\n\n')+'\n\n'+r.json.decisions.map(d=>`- ${d.filename}: ${d.decision} — ${d.reason}`).join('\n'):r.reason)).join('\n\n');
      await atomic(path.join(root,'field-notes.md'),notes+'\n');
      await exec('git',['-C',root,'add','--',file,'field-notes.md','.gitignore']);
      for(const name of ['corpus.json','session.json'])try{await fs.access(path.join(root,name));await exec('git',['-C',root,'add','--',name]);}catch(error){if(error.code!=='ENOENT')throw error;}
      await exec('git',['-C',root,'-c','user.name=Photo Select','-c','user.email=photo-select@localhost','-c','commit.gpgsign=false','commit','--quiet','-m',`Record private curation ${saved.length}`]);
    });
    return queue;
  };
}
export async function startGithubRun({source,brief='',curators=[],provider='openai',tunnelId,signal,progress=()=>{},base},dependencies={}) {
  const briefSize=validateGithubBrief(brief);
  progress(`github: context ${briefSize.textTokens.toLocaleString('en-US')} text tokens (local count)`);
  await reuseRepositoryEnvironment();
  if(!['openai','openai-batch'].includes(provider))throw knowledgeError('--github-all supports openai and openai-batch.');
  if(process.env.OPENAI_BASE_URL&&process.env.OPENAI_BASE_URL.replace(/\/$/,'')!=='https://api.openai.com/v1')throw knowledgeError('--github-all requires the official OpenAI API endpoint.');
  tunnelId=tunnelId||await configuredGithubTunnel();
  const tunnel=await (dependencies.startTunnel||startGithubTunnel)({tunnelId,signal});
  try {
    const run=await preparePrivateRun({source,base,copyImages:false});
    progress(`github: image directory ${run.images}`);progress(`github: private audit ${run.root}`);
    const save=await createGithubAudit(run.root);
    const client=dependencies.client||new OpenAI({apiKey:process.env.OPENAI_API_KEY,baseURL:'https://api.openai.com/v1',maxRetries:0,timeout:120000});
    const batch=provider==='openai-batch'?new GithubBatchTransport({client,signal,progress,saveReceipt:record=>atomic(path.join(run.root,(record.transport||'batch')+'-'+record.runId+'.json'),record)}):null;
    if(batch&&briefSize.textTokens>=1024)progress('github: cacheable batch-mode requests use Flex at Batch rates; no standard-tier fallback');
    const driver=new GithubCurationProvider({tunnelId,curators,brief,briefSize,cacheServiceTier:batch?'flex':undefined,save,
      respond:batch?body=>batch.respond(body):body=>client.responses.create(body,{signal}),
      assertCurrent:tunnel.assertCurrent,
      assertDirectory:async dir=>{const actual=await fs.realpath(dir);if(actual!==run.images&&!actual.startsWith(run.images+path.sep))throw knowledgeError('Curation escaped the selected image directory.');},
      encodeImage:file=>sharp(file).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:75}).toBuffer()});
    await atomic(path.join(run.root,'session.json'),{mode:'github-during-curation',imageDirectory:run.images,outputMode:'in-place',provider,cacheTransport:batch?'flex-at-batch-rates':'responses',tunnelId,briefSize,curators:driver.curators,curatorMode:'base-plus-repeated-photo-tags',scope:'credential-readable-repositories',localResearchCalls:0,sourceBodiesPrecollected:false,githubCredentialDestination:'github-only'});
    return {...run,provider:driver,stop:tunnel.stop};
  }catch(error){await tunnel.stop();throw error;}
}
