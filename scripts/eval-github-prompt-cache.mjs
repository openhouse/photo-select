// Paid, opt-in acceptance test: three synthetic photographs through the production
// GitHub provider, private tunnel and actual Batch transport. Never a corpus run.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {startGithubRun} from '../src/githubRun.js';
if(!process.argv.includes('--live'))throw Error('This makes paid API calls. Run with --live to test three synthetic images.');
const root=fileURLToPath(new URL('..',import.meta.url));
const files=['src/providers/github.js','src/githubBatch.js','src/githubCacheScheduler.js','src/core/githubPromptCache.js','src/core/promptCaching.js','src/core/githubBrief.js','src/core/githubCuration.js','src/core/githubBridge.js','src/githubRun.js','src/githubTunnel.js','src/knowledgeRun.js','scripts/github-mcp-bridge.mjs','scripts/eval-github-prompt-cache.mjs','package-lock.json'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async file=>[file,createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')])));
const before=await hashes(),scratch=await fs.mkdtemp(path.join(os.tmpdir(),'github-cache-eval-'));
const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),30*60*1000);
process.once('SIGINT',()=>abort.abort());
const brief=`Synthetic cache acceptance fixture ${randomUUID()}. These numbered records are invented reference data.\n`+Array.from({length:600},(_,i)=>`Record ${i}: amber bridge cedar delta field.\n`).join('');
let run;
try{
 for(let i=0;i<3;i++)await sharp({create:{width:64,height:64,channels:3,background:['#996644','#445599','#559966'][i]}}).jpeg().toFile(path.join(scratch,`synthetic-${i}.jpg`));
 run=await startGithubRun({source:scratch,base:'/Volumes/16TB_SSD/.photo-select/runs',brief,curators:['Base'],provider:'openai-batch',signal:abort.signal,progress:console.log});
 // Compare subsequent requests with the seed without loading prior conversation.
 const send=run.provider.respond;let comparison;
 run.provider.respond=async body=>{
  if(comparison)body.prompt_cache_options={...body.prompt_cache_options,comparison_response_id:comparison};
  const response=await send(body);comparison??=response.id;return response;
 };
 const results=[];
 for(let i=0;i<3;i++)results.push(...await Promise.allSettled([run.provider.chat({model:'gpt-5.6-terra',reasoningEffort:'high',images:[path.join(scratch,`synthetic-${i}.jpg`)],curators:i?['Base','Guest '+i]:['Base'],minutesMin:1,minutesMax:1,
  prompt:'Call get_me once to check the GitHub tool connection during this curation. Repository reads are unnecessary for this synthetic cache test. Produce exactly one minutes item ending in a question, then a decision about the synthetic image. Say that no repository sources were read.'})]));
 const records=await Promise.all((await fs.readdir(run.root)).filter(file=>/^curation-\d+\.json$/.test(file)).sort().map(async file=>JSON.parse(await fs.readFile(path.join(run.root,file),'utf8'))));
 const usages=records.flatMap(record=>(record.attempts||[]).map(attempt=>({curationStatus:record.status,responseId:attempt.response.id,requestSha256:attempt.request_sha256,batchId:attempt.response._photoSelectBatch?.batchId,...attempt.response._photoSelectCache,
  diagnostics:attempt.response.prompt_cache_diagnostics?Object.fromEntries(['type','reason','comparison_reusable_tokens','cache_missed_tokens'].filter(k=>attempt.response.prompt_cache_diagnostics[k]!==undefined).map(k=>[k,attempt.response.prompt_cache_diagnostics[k]])):null,
  githubToolCalled:attempt.response.output?.some(item=>item.type==='mcp_call'&&item.name==='get_me'&&!item.error)===true})));
 const passed=results.every(r=>r.status==='fulfilled')&&usages.length===3&&usages.some(u=>u.role==='seed'&&u.writeTokens>=u.requiredCachedTokens)&&usages.some(u=>u.role==='probe'&&u.verified)&&usages.some(u=>u.role==='reader'&&u.verified)&&usages.every(u=>u.githubToolCalled)&&JSON.stringify(before)===JSON.stringify(await hashes());
 const report={schemaVersion:1,status:passed?'passed':'held',recordedAt:new Date().toISOString(),scope:'three synthetic images; actual Batch, GPT-5.6 Terra/high, private GitHub tunnel; no repository source reads',implementationSha256:before,requested:3,completed:results.filter(r=>r.status==='fulfilled').length,usages,
  limitations:'Small live cache test, not the full project brief or corpus. Future Batch execution can outlast cache retention; each wave remains guarded.'};
 await fs.writeFile(path.join(run.root,'cache-eval.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:report.status,completed:report.completed,usages,privateReport:path.join(run.root,'cache-eval.json')},null,2));
 if(!passed)process.exitCode=1;
}finally{clearTimeout(timeout);await run?.stop();await fs.rm(scratch,{recursive:true,force:true});}
