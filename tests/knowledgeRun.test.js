import { describe,it,expect,vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
vi.mock('../src/knowledgeGithub.js',async()=>({...await vi.importActual('../src/knowledgeGithub.js'),createGithubRequest:vi.fn(()=>{throw new Error('Real GitHub transport forbidden in this test');})}));
import { createGithubRequest } from '../src/knowledgeGithub.js';
import { preparePrivateRun, loadLiveProfile, startLiveKnowledge } from '../src/knowledgeRun.js';
import { LiveKnowledgeProvider } from '../src/providers/knowledge.js';
import { CURATORS, sha256 } from '../src/core/knowledgeLive.js';

describe('private run setup',()=>{
  it('copies inputs into a private run without moving or linking originals',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-run-')); const source=path.join(root,'source');
    await fs.mkdir(source); await fs.writeFile(path.join(source,'a.jpg'),'original');
    try {
      const run=await preparePrivateRun({source,base:path.join(root,'runs')});
      await fs.writeFile(path.join(run.images,'a.jpg'),'changed');
      expect(await fs.readFile(path.join(source,'a.jpg'),'utf8')).toBe('original');
      expect((await fs.stat(run.root)).mode & 0o077).toBe(0);
      await run.save({status:'ready',context:{id:'r1',records:[]}});
      expect(JSON.parse(await fs.readFile(path.join(run.root,'research.json'),'utf8')).context.id).toBe('r1');
    } finally {await fs.rm(root,{recursive:true,force:true});}
  });
  it('refuses output inside a Git checkout',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-run-'));
    try {await fs.mkdir(path.join(root,'.git'));await expect(preparePrivateRun({source:root,base:path.join(root,'runs')})).rejects.toThrow(/Git/i);}
    finally {await fs.rm(root,{recursive:true,force:true});}
  });
  it('needs no profile file for automatic discovery',async()=>expect(await loadLiveProfile(true)).toEqual({}));
});
describe('live curator provider',()=>{
  const context={id:'knowledge-live-v1:fixture',brief:'event',summary:'A qualified account',records:[{id:'source-1',text:'SECRET_FIXTURE',digest:'fixture'}]};
  const good={minutes:[{speaker:CURATORS[0],text:'A source qualifies the frame [source-1]. What comes next?'}],decisions:[{filename:'a.jpg',decision:'keep',reason:'Contrast [source-1]'}]};
  function provider(respond=async()=>({output_text:JSON.stringify(good)})) {
    return new LiveKnowledgeProvider({context,respond,assertCurrent:vi.fn(),encodeImage:async()=>Buffer.from('jpg'),save:vi.fn()});
  }
  it('puts private knowledge in data input, retains strict JSON, and rechecks access',async()=>{
    const requests=[];const p=provider(async x=>{requests.push(x);return {output_text:JSON.stringify(good)};});
    const result=await p.collect(await p.submit({model:'gpt-4o',images:['a.jpg'],prompt:'Trusted curation',minutesMin:1,minutesMax:8}));
    expect(result.json).toEqual(good);expect(requests[0].instructions).not.toContain('SECRET_FIXTURE');
    expect(JSON.stringify(requests[0].input)).toContain('SECRET_FIXTURE');
    expect(requests[0].text.format.type).toBe('json_schema'); expect(requests[0].store).toBe(false);
    expect(p.assertCurrent).toHaveBeenCalled();
  });
  it('repairs invalid JSON once with the identical evidence',async()=>{
    const requests=[]; const p=provider(async x=>{requests.push(x);return {output_text:requests.length===1?'invalid':JSON.stringify(good)};});
    await p.collect(await p.submit({model:'gpt-4o',images:['a.jpg'],prompt:'trusted',minutesMin:1,minutesMax:8}));
    expect(requests).toHaveLength(2); expect(requests[0].input).toEqual(requests[1].input);
    expect(p.save.mock.calls.at(-1)[0].retry_recovered).toBe(true);
    expect(p.save.mock.calls.at(-1)[0].model_sha256).toBe(sha256(requests[1]));
  });
  it('fails before image or model work when access is revoked',async()=>{
    const p=provider();p.assertCurrent=vi.fn(async()=>{throw new Error('revoked');});
    await expect(p.collect(await p.submit({model:'gpt-4o',images:['a.jpg']}))).rejects.toThrow();
  });
  it('rejects invented citations and does not save a successful curation',async()=>{
    const p=provider(async()=>({output_text:JSON.stringify({...good,decisions:[{filename:'a.jpg',decision:'keep',reason:'[source-invented]'}]})}));
    await expect(p.collect(await p.submit({model:'gpt-4o',images:['a.jpg'],minutesMin:1,minutesMax:8}))).rejects.toThrow();
    expect(p.save).not.toHaveBeenCalled();
  });
});

it('does not spend another model request when saving a valid reply fails', async()=>{
  const json={minutes:[{speaker:CURATORS[0],text:'A qualified frame [source-1]. What next?'}],decisions:[{filename:'a.jpg',decision:'keep',reason:'[source-1]'}]};
  const respond=vi.fn(async()=>({output_text:JSON.stringify(json)}));
  const p=new LiveKnowledgeProvider({context:{id:'r1',records:[{id:'source-1'}]},respond,assertCurrent:async()=>{},encodeImage:async()=>Buffer.from('jpg'),save:async()=>{throw new Error('disk full');}});
  await expect(p.collect(await p.submit({model:'gpt-4o',images:['a.jpg'],minutesMin:1,minutesMax:8}))).rejects.toThrow();
  expect(respond).toHaveBeenCalledTimes(1);
});


it('uses injected synthetic transports end to end and commits the reply with field notes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-injected-'));const source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'a.jpg'),'fixture');
 const sha='a'.repeat(40),repo={name:'fixture-knowledge',full_name:'fixture/fixture-knowledge',owner:{login:'fixture'},default_branch:'main',permissions:{pull:true}};
 const request=vi.fn(async p=>p==='user'?{login:'fixture'}:p.startsWith('user/repos')?[repo]:p==='branches'?[{name:'main',target:{oid:sha,committedDate:'2026-09-10T00:00:00Z'}}]:p.includes('/git/trees/')?{truncated:false,tree:[{path:'README.md',mode:'100644',type:'blob',sha,size:20}]}:p.includes('/git/blobs/')?{encoding:'base64',content:Buffer.from('Synthetic source body').toString('base64')}:repo);
 let turn=0;
 const respond=vi.fn(async q=>{
  if(q.text) {const evidence=JSON.parse(q.input[0].content[0].text).evidence;const id=evidence.records[0].id;return {output_text:JSON.stringify({minutes:[{speaker:CURATORS[0],text:`A test [${id}]. What next?`}],decisions:[{filename:'a.jpg',decision:'keep',reason:`[${id}]`}]})};}
  turn++;
  if(turn===1){const catalog=JSON.parse(q.input[0].content).catalog;return {output:[{type:'function_call',call_id:'one',name:'knowledge_search',arguments:JSON.stringify({repositoryId:catalog[0].id,query:'',cursor:null})}],usage:{total_tokens:10}};}
  if(turn===2){const id=JSON.parse(q.input.at(-1).output).items[0].id;return {output:[{type:'function_call',call_id:'two',name:'knowledge_read',arguments:JSON.stringify({sourceId:id})}],usage:{total_tokens:10}};}
  return {output:[],output_text:'Synthetic research complete.',usage:{total_tokens:10}};
 });
 try {
  const run=await startLiveKnowledge({profile:{runRoot:path.join(root,'runs')},source,model:'gpt-4o'},{request,respond});
  run.provider.encodeImage=async()=>Buffer.from('fixture');
  await run.provider.collect(await run.provider.submit({model:'gpt-4o',images:[path.join(run.images,'a.jpg')],minutesMin:1,minutesMax:8}));
  expect(createGithubRequest).not.toHaveBeenCalled();expect(run.context.subject).toBe('fixture');expect(respond).toHaveBeenCalledTimes(4);
  expect(await fs.readFile(path.join(run.root,'field-notes.md'),'utf8')).toContain('Private photographic field notes');
  const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
  const {stdout}=await promisify(execFile)('git',['-C',run.root,'show','--format=','--name-only','HEAD']);
  expect(stdout).toContain('field-notes.md');expect(stdout).toContain('curation-0001.json');
 } finally {await fs.rm(root,{recursive:true,force:true});}
});


it('records completed discovery without invoking the model or copying photos',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-discovery-'));
 const sha='a'.repeat(40),repo={name:'fixture-knowledge',full_name:'fixture/fixture-knowledge',owner:{login:'fixture'},default_branch:'main'};
 const request=async endpoint=>endpoint==='user'?{login:'fixture'}:endpoint.startsWith('user/repos')?[repo]:[{name:'main',target:{oid:sha,committedDate:'2026-09-10T00:00:00Z'}}];
 const respond=vi.fn();
 try {
  await fs.writeFile(path.join(root,'original.jpg'),'original');
  const run=await startLiveKnowledge({source:root,profile:{runRoot:path.join(root,'runs')},discoverOnly:true},{request,respond});
  const saved=JSON.parse(await fs.readFile(path.join(run.root,'research.json'),'utf8'));
  expect(saved.status).toBe('discovered');expect(saved.catalog).toHaveLength(1);
  expect(respond).not.toHaveBeenCalled();expect(await fs.readdir(run.images)).toEqual([]);
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
