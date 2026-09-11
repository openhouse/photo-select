// Paid, opt-in acceptance: four synthetic images, actual batch-mode Flex transport.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import OpenAI from 'openai';
import {reuseRepositoryEnvironment} from '../src/knowledgeRun.js';
import {buildPrompt,DEFAULT_PROMPT_PATH} from '../src/templates.js';
import {startGithubRun} from '../src/githubRun.js';
import {validateGithubBrief} from '../src/core/githubBrief.js';
import {evaluateGithubCacheCanary} from '../evals/evaluate-github-cache.mjs';
if(!process.argv.includes('--live'))throw Error('Paid API test: use --live for four synthetic images; optionally --context FILE.');
const root=fileURLToPath(new URL('..',import.meta.url)),contextIndex=process.argv.indexOf('--context'),verbosityIndex=process.argv.indexOf('--verbosity');
const verbosity=verbosityIndex<0?undefined:process.argv[verbosityIndex+1];
if(verbosityIndex>=0&&!['low','medium','high'].includes(verbosity))throw Error('--verbosity must be low, medium or high');
if(contextIndex>=0&&(!process.argv[contextIndex+1]||process.argv[contextIndex+1].startsWith('--')))throw Error('--context requires a file');
const repositoryIndex=process.argv.indexOf('--repository'),repository=repositoryIndex<0?undefined:process.argv[repositoryIndex+1];
if(repositoryIndex>=0&&!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||''))throw Error('--repository requires owner/repo');
const probe='Connectivity evaluation: call get_me once during each image curation.'+(repository?` Then use get_file_contents to read README.md in ${repository}. Do not quote or summarize the private text; this only verifies authenticated delivery.`:'')+' Return ordinary image decisions and end the final minute with a question.\n';
const brief=contextIndex>=0?await fs.readFile(process.argv[contextIndex+1],'utf8'):
 probe+`Synthetic cache acceptance ${randomUUID()}. Invented reference data.\n`+Array.from({length:1200},(_,i)=>`Record ${i}: amber bridge cedar delta field.\n`).join('');
const digest=value=>createHash('sha256').update(value).digest('hex');
const files=[...(await fs.readdir(path.join(root,'src'),{recursive:true})).filter(p=>/\.m?js$/.test(p)).map(p=>'src/'+p),
 'prompts/default_prompt.hbs','scripts/github-mcp-bridge.mjs','scripts/eval-github-prompt-cache.mjs','evals/evaluate-github-cache.mjs','package-lock.json'];
const hashes=async()=>Object.fromEntries(await Promise.all(files.sort().map(async file=>[file,digest(await fs.readFile(path.join(root,file)))])));
const before=await hashes(),scratch=await fs.mkdtemp(path.join(os.tmpdir(),'github-cache-eval-'));
const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),30*60*1000);process.once('SIGINT',()=>abort.abort());
let run;
try{
 for(let i=0;i<4;i++)await sharp({create:{width:64,height:64,channels:3,background:['#996644','#445599','#559966','#996633'][i]}}).jpeg().toFile(path.join(scratch,`synthetic-${i}.jpg`));
 await reuseRepositoryEnvironment();
 const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,baseURL:'https://api.openai.com/v1',maxRetries:0,timeout:120000});
 let activeRequests=0,maxConcurrentRequests=0;const create=client.responses.create.bind(client.responses);
 client.responses.create=async(...args)=>{activeRequests++;maxConcurrentRequests=Math.max(maxConcurrentRequests,activeRequests);try{return await create(...args);}finally{activeRequests--;}};
 run=await startGithubRun({source:scratch,base:'/Volumes/16TB_SSD/.photo-select/runs',brief,curators:['Base'],provider:'openai-batch',signal:abort.signal,progress:console.log},{client});
 // Diagnostic comparisons do not load previous conversation. Mutation happens
 // before transmission, so the provider records the exact body and its hash.
 const send=run.provider.respond;let comparison;
 run.provider.respond=async body=>{if(comparison)body.prompt_cache_options={...body.prompt_cache_options,comparison_response_id:comparison};const response=await send(body);comparison??=response.id;return response;};
 const results=[];
 for(const stage of [[0],[1],[2,3]])results.push(...await Promise.allSettled(stage.map(async i=>{
  const images=[path.join(scratch,`synthetic-${i}.jpg`)],curators=i?['Base','Guest '+i]:['Base'];
  const rendered=await buildPrompt(DEFAULT_PROMPT_PATH,{images,curators,contextText:brief});
  return run.provider.chat({model:'gpt-5.6-terra',reasoningEffort:'high',verbosity,images,curators,...rendered});
 })));
 const renderedInstructions=request=>request.instructions??request.input.filter(m=>m.role==='developer').flatMap(m=>m.content.map(c=>c.text)).join('');
 const records=await Promise.all((await fs.readdir(run.root)).filter(file=>/^curation-\d+\.json$/.test(file)).sort().map(async file=>JSON.parse(await fs.readFile(path.join(run.root,file),'utf8'))));
 const privateRead=response=>{
  if(!repository)return {};
  let privateSourceTextBytes=0;
  for(const item of response.output||[]){
   if(item.type!=='mcp_call'||item.name!=='get_file_contents'||item.error)continue;
   let args;try{args=JSON.parse(item.arguments);}catch{continue;}
   if(`${args.owner}/${args.repo}`!==repository||args.path!=='README.md')continue;
   for(const block of String(item.output||'').split('\n\n'))try{
    const resource=JSON.parse(block);
    if(typeof resource.source==='string'&&typeof resource.text==='string')privateSourceTextBytes+=Buffer.byteLength(resource.text);
   }catch{/* Tool status prose is not source text. */}
  }
  return {privateFileRead:privateSourceTextBytes>0,privateSourceTextBytes};
 };
 const usages=records.flatMap(record=>(record.attempts||[]).map(attempt=>({curationStatus:record.status,responseIdSha256:digest(attempt.response.id||''),requestSha256:attempt.request_sha256,...attempt.response._photoSelectCache,
  serviceTier:attempt.response.service_tier,requestedTier:record.request.service_tier,
  omittedEncryptedReasoningItems:attempt.omittedEncryptedReasoning?.length??0,opaqueReasoningStored:attempt.response.output?.some(item=>item.type==='reasoning'&&typeof item.encrypted_content==='string')===true,
  fullBriefPreserved:renderedInstructions(record.request).includes(brief),
  ...privateRead(attempt.response),
  diagnostics:attempt.response.prompt_cache_diagnostics?Object.fromEntries(['type','reason','comparison_reusable_tokens','cache_missed_tokens'].filter(k=>attempt.response.prompt_cache_diagnostics[k]!==undefined).map(k=>[k,attempt.response.prompt_cache_diagnostics[k]])):null,
  githubToolAvailable:record.request.tools?.some(tool=>tool.type==='mcp'&&tool.server_label==='github'&&typeof tool.tunnel_id==='string'&&tool.allowed_tools?.includes('get_file_contents')&&!tool.authorization)===true,
  githubToolCalled:attempt.response.output?.some(item=>item.type==='mcp_call'&&item.name==='get_me'&&!item.error)===true})));
 const report={schemaVersion:2,toolUseRequired:contextIndex<0||Boolean(repository),status:'passed',recordedAt:new Date().toISOString(),transport:'flex',scope:'Four synthetic images; batch-mode Flex, GPT-5.6 Terra/high, private GitHub tools available; tool use is discretionary for a supplied context. Two reader jobs requested together; dispatch may be serial. No corpus edit.',maxConcurrentRequests,implementationSha256:before,requested:4,completed:results.filter(r=>r.status==='fulfilled').length,
  context:{kind:contextIndex>=0?'provided-file':'synthetic',textTokens:validateGithubBrief(brief).textTokens,sha256:digest(brief)},usages,
  limitations:'Bounded live evidence, not a guarantee against future cache eviction, rate limits or resource unavailability. Cache and service-tier guards remain enabled.'};
 const failures=evaluateGithubCacheCanary(report,await hashes());if(repository&&usages.some(u=>!u.privateFileRead))failures.push('private-file-read-missing');if(usages.some(u=>u.opaqueReasoningStored))failures.push('opaque-reasoning-stored');if(failures.length)report.status='held';report.failures=failures;
 await fs.writeFile(path.join(run.root,'cache-eval.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:report.status,completed:report.completed,maxConcurrentRequests:report.maxConcurrentRequests,context:report.context,usages,failures,privateReport:path.join(run.root,'cache-eval.json')},null,2));if(failures.length)process.exitCode=1;
}finally{clearTimeout(timeout);await run?.stop();await fs.rm(scratch,{recursive:true,force:true});}
