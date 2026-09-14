import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { config as dotenv } from 'dotenv';
import OpenAI from 'openai';
import sharp from 'sharp';
import { KnowledgeGithub, createGithubRequest } from './knowledgeGithub.js';
import { researchKnowledge } from './knowledgeResearch.js';
import { LiveKnowledgeProvider } from './providers/knowledge.js';
import { knowledgeError, sha256 } from './core/knowledgeLive.js';
const exec=promisify(execFile);
const codeRoot=fileURLToPath(new URL('..',import.meta.url));
export async function loadLiveProfile(value) {
  if(value===true || value===undefined) return {};
  const text=await fs.readFile(path.resolve(value),'utf8');
  const profile=JSON.parse(text);
  if(!profile || Array.isArray(profile) || typeof profile!=='object') throw knowledgeError('The live profile must be a JSON object.');
  const allowed=['include','exclude','branches','brief','runRoot','maxTurns','maxToolCalls','maxTokens','maxRequests','maxMilliseconds'];
  if(Object.keys(profile).some(k=>!allowed.includes(k))) throw knowledgeError('The live profile contains an unsupported field.');
  for(const key of ['include','exclude']) if(profile[key] && (!Array.isArray(profile[key])||profile[key].some(x=>typeof x!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(x)))) throw knowledgeError('Invalid repository scope.');
  if(profile.branches && (typeof profile.branches!=='object'||Array.isArray(profile.branches)||Object.values(profile.branches).some(x=>typeof x!=='string'||!x))) throw knowledgeError('Invalid branch overrides.');
  for(const key of allowed.filter(k=>k.startsWith('max'))) if(profile[key]!==undefined && (!Number.isSafeInteger(profile[key])||profile[key]<=0)) throw knowledgeError('Research limits must be positive integers.');
  for(const key of ['brief','runRoot']) if(profile[key]!==undefined&&typeof profile[key]!=='string') throw knowledgeError('Brief and output root must be strings.');
  Object.defineProperties(profile,{_path:{value:path.resolve(value)},_digest:{value:sha256(text)}});
  return profile;
}
export async function reuseRepositoryEnvironment() {
  if(process.env.OPENAI_API_KEY) return;
  try {
    const {stdout}=await exec('git',['-C',codeRoot,'rev-parse','--path-format=absolute','--git-common-dir']);
    dotenv({path:path.join(path.dirname(stdout.trim()),'.env')});
  } catch { /* The CLI reports missing credentials without exposing values. */ }
}
async function outsideGit(directory) {
  let p=path.resolve(directory);
  while(true) {
    try {const stat=await fs.lstat(p);if(stat.isSymbolicLink() && !['/var','/tmp'].includes(p)) throw knowledgeError('Private output path cannot contain a symlink.');} catch(e) {if(e.code!=='ENOENT') throw e;}
    try {await fs.lstat(path.join(p,'.git'));throw knowledgeError('Private output must be outside a Git checkout.');} catch(e) {if(e.code!=='ENOENT') throw e;}
    const parent=path.dirname(p);if(parent===p) break;p=parent;
  }
}
async function atomic(file,value) {
  const temporary=file+'.'+randomUUID()+'.tmp';
  await fs.writeFile(temporary,typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await fs.rename(temporary,file);
}
async function hashFile(file) { const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex'); }
export async function preparePrivateRun({source,base,researchOnly=false,copyImages=true}) {
  const volume=path.resolve(source).match(/^\/Volumes\/[^/]+/);
  base=base||path.join(volume?volume[0]:os.homedir(),'.photo-select','runs');
  await outsideGit(base);
  await fs.mkdir(base,{recursive:true,mode:0o700});
  const root=await fs.mkdtemp(path.join(base,'run-'));await fs.chmod(root,0o700);
  source=await fs.realpath(source);
  const images=copyImages?path.join(root,'images'):source;
  if(copyImages)await fs.mkdir(images,{mode:0o700});
  const corpus=[];
  if(!researchOnly){
    // Normal curation resumes down the _keep chain; hash those existing inputs
    // as well without importing _aside or archived _level snapshots.
    let directory=source;
    while(directory){
      const entries=await fs.readdir(directory,{withFileTypes:true});
      for(const item of entries){
        if(!item.isFile() || !/\.(?:jpe?g|png|tiff?|heic|heif|webp)$/i.test(item.name))continue;
        const from=path.join(directory,item.name),filename=path.relative(source,from);
        const to=copyImages?path.join(images,item.name):from;
        if(copyImages){await fs.copyFile(from,to,constants.COPYFILE_FICLONE);await fs.chmod(to,0o600);}
        corpus.push({filename,filename_sha256:sha256(filename),sha256:await hashFile(to)});
      }
      directory=!copyImages&&entries.some(x=>x.name==='_keep'&&x.isDirectory())?path.join(directory,'_keep'):null;
    }
  }
  if(!researchOnly&&copyImages&&!corpus.length)throw knowledgeError('No supported image files were found in the source directory.');
  await atomic(path.join(root,'corpus.json'),{source,...(copyImages?{copiedAt:new Date().toISOString()}:{recordedAt:new Date().toISOString(),inputMode:'in-place'}),images:corpus});
  return {root,images,save:record=>atomic(path.join(root,'research.json'),record)};
}
export async function startLiveKnowledge({profile={},source,brief,model,discoverOnly=false,researchOnly=false,signal,progress=()=>{}}, dependencies={}) {
  if(process.env.OPENAI_BASE_URL && process.env.OPENAI_BASE_URL.replace(/\/$/,'')!=='https://api.openai.com/v1') throw knowledgeError('Live mode currently supports the official OpenAI endpoint only.');
  const run=await preparePrivateRun({source,base:profile.runRoot,researchOnly:researchOnly||discoverOnly});
  progress(`knowledge: private run ${run.root}`);
  const verifyScope=async()=>{if(profile._path&&sha256(await fs.readFile(profile._path,'utf8'))!==profile._digest)throw knowledgeError('The live profile changed; start a fresh run.');};
  const github=new KnowledgeGithub({...profile,verifyScope,request:dependencies.request||createGithubRequest({signal})});
  await run.save({status:'discovering'});
  let catalog;
  try {catalog=await github.discover();} catch(error) {await run.save({status:'held',reason:'Repository discovery failed.'});throw error;}
  await atomic(path.join(run.root,'catalog.json'),{subject:github.subject,discoveredAt:new Date().toISOString(),ownedRepositories:github.inventory.length,catalog,coverage:github.coverage});
  progress(`knowledge: discovered ${new Set(catalog.map(x=>x.repository)).size} repositories and ${catalog.length} branch snapshots`);
  if(discoverOnly) { await run.save({status:'discovered',catalog,coverage:github.coverage}); return {...run,discovered:true}; }
  let respond=dependencies.respond;
  if(!respond) {
    const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,baseURL:'https://api.openai.com/v1',maxRetries:0,timeout:60000});
    if(typeof client.responses?.create!=='function') throw knowledgeError('The installed OpenAI SDK does not support Responses. Run npm ci.');
    respond=request=>client.responses.create(request,{signal});
  }
  github.deadline=Date.now()+(profile.maxMilliseconds||300000);
  const context=await researchKnowledge({...profile,scope:{subject:github.subject,recipient:'local-user',purpose:'photo-reading',provider:'openai',output:run.root,profileDigest:profile._digest||'automatic-owned-ecosystem'},github,catalog,brief:brief||profile.brief||`Research the knowledge wiki graph context for a photographic edit of ${path.basename(source)}. Find relevant records and countervoices; leave event identity uncertain if unsupported.`,model,respond,save:run.save,signal});
  github.researchComplete=true;
  if(researchOnly) return {...run,context};
  await exec('git',['init','--quiet',run.root]);
  await atomic(path.join(run.root,'.gitignore'),'/images/\n/.cache/\n/runtime.log\n');
  const saved=[];
  const save=async record=>{
    const file=`curation-${String(saved.length+1).padStart(4,'0')}.json`;
    await atomic(path.join(run.root,file),{...record,recordedAt:new Date().toISOString()});saved.push({file,...record});
    const notes='# Private photographic field notes\n\n'+saved.map(r=>`## ${r.file}\n\nEvidence: ${r.receipt}\n\n`+r.json.minutes.map(m=>`**${m.speaker}:** ${m.text}`).join('\n\n')+'\n\n'+r.json.decisions.map(d=>`- ${d.filename}: ${d.decision} — ${d.reason}`).join('\n')).join('\n\n');
    await atomic(path.join(run.root,'field-notes.md'),notes+'\n');
    await exec('git',['-C',run.root,'add','--',file,'field-notes.md','research.json','catalog.json','corpus.json','.gitignore']);
    await exec('git',['-C',run.root,'-c','user.name=Photo Select','-c','user.email=photo-select@localhost','-c','commit.gpgsign=false','commit','--quiet','-m',`Record curation ${saved.length} with source receipt`]);
  };
  const provider=new LiveKnowledgeProvider({context,respond,save,assertCurrent:()=>github.assertCurrent(),
    encodeImage:file=>sharp(file).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:75}).toBuffer(),
    assertDirectory:async dir=>{const actual=await fs.realpath(dir);if(actual!==run.images&&!actual.startsWith(run.images+path.sep)) throw knowledgeError('Curation output escaped the private run.');}
  });
  return {...run,context,provider};
}
