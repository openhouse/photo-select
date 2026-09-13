import {readFile,writeFile,lstat,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyPacket} from './curatorialPacket.mjs';
import {safePath} from '../../src/core/curatorialPacket.js';
import {renderCuratorialContext,checkContextLinks} from '../../src/core/curatorialContext.js';
import {countGithubTextTokens,validateGithubBrief} from '../../src/core/githubBrief.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exists(file){try{await lstat(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
export async function exportCuratorialContext(packetRoot,profile,output){
  packetRoot=await realpath(packetRoot);output=path.resolve(output);
  const parent=await realpath(path.dirname(output));
  if(parent===packetRoot||parent.startsWith(packetRoot+path.sep))throw new Error('Context output must be outside the immutable packet');
  if(await exists(output)||await exists(output+'.receipt.json'))throw new Error('Context output or receipt already exists');
  const maxTokens=profile.maxTokens??850000;
  if(!Number.isSafeInteger(maxTokens)||maxTokens<1)throw new Error('Invalid context token budget');
  const verified=await verifyPacket(packetRoot);
  if(verified.errors.length)throw new Error('Source packet integrity failed');
  if(profile.packetFingerprint!==verified.fingerprint)throw new Error('Packet fingerprint does not match the context profile');
  const catalog=JSON.parse(await readFile(path.join(packetRoot,'manifests/catalog.json'),'utf8'));
  const selected=new Set(profile.sourceIds);
  for(const s of catalog)if(selected.has(s.id)){
    const bytes=await readFile(path.join(packetRoot,safePath(s.path)));
    if(s.mode!=='exact'||hash(bytes)!==s.id)throw new Error('Selected source integrity failed');
    s.body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(s.body.includes('\0'))throw new Error('Selected source is not plain text');
  }
  const pages=[];
  for(const p of profile.pagePaths)pages.push({path:safePath(p),text:await readFile(path.join(packetRoot,p),'utf8')});
  const {markdown,coverage,references}=renderCuratorialContext({...profile,canonicalPath:path.basename(output),pages,catalog});
  const linkErrors=checkContextLinks(markdown);if(linkErrors.length)throw new Error(`Context navigation failed: ${linkErrors.length} unavailable links`);
  const inputGuard=validateGithubBrief(markdown);
  if(inputGuard.textTokens>maxTokens)throw new Error(`Context token budget exceeded: ${inputGuard.textTokens} > ${maxTokens}; no text was truncated`);
  let retrievalPassed=0;
  for(const test of profile.retrievalCases||[]){
    const begin=`<!-- source:${test.sourceId} -->`,end=`<!-- /source:${test.sourceId} -->`;
    const start=markdown.indexOf(begin),stop=markdown.indexOf(end,start);
    if(start<0||stop<start||test.contains.some(phrase=>!markdown.slice(start,stop).includes(phrase)))throw new Error(`Context source retrieval failed: ${test.id}`);
    retrievalPassed++;
  }
  const implementation={};const base=fileURLToPath(new URL('../../',import.meta.url));
  for(const file of ['src/core/curatorialContext.js','scripts/lib/curatorialContext.mjs','scripts/curatorial-context.mjs','src/core/githubBrief.js'])implementation[file]=hash(await readFile(path.join(base,file)));
  const receipt={schemaVersion:1,status:'PASS_OFFLINE_CONTEXT_EXPORT',sha256:hash(markdown),bytes:Buffer.byteLength(markdown),decodedTextTokens:countGithubTextTokens(markdown),inputGuard,maxTokens,
    packetFingerprint:verified.fingerprint,profileSha256:hash(JSON.stringify(profile)),profile,originalRequest:profile.request??null,coverage,references,retrievalPassed,linkErrors:0,modelRequests:0,implementation,
    limitation:'Explicit source projection, not a full packet concatenation. Offline loading and input-budget checks do not guarantee a later provider request with image/tool/output tokens will fit or succeed.'};
  let wrote=false;
  try{
    await writeFile(output,markdown,{flag:'wx',mode:0o600});wrote=true;
    if(hash(await readFile(output))!==receipt.sha256)throw new Error('Written context differs from verified export');
    await writeFile(output+'.receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
  }catch(error){if(wrote)await rm(output,{force:true});throw error;}
  return receipt;
}
