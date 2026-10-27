import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
vi.mock('../src/chatClient.js', async () => ({ ...await vi.importActual('../src/chatClient.js'), prefetchPeople: vi.fn().mockResolvedValue({ mode:'bulk', names:0 }), getPeople: vi.fn().mockResolvedValue(['Tagged Guest']) }));
import { triageDirectory } from '../src/orchestrator.js';
import { getPeople, prefetchPeople } from '../src/chatClient.js';
let root, prompt; const previousDebug = process.env.PHOTO_SELECT_DEBUG_DIR;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'xiaomi-workflow-')); process.env.PHOTO_SELECT_DEBUG_DIR = root; prompt = path.join(root,'custom.hbs'); await fs.writeFile(prompt,'Original exhibition.\nCurators: {{curators}}\n{{context}}\n{{#each images}}- {{this}}\n{{/each}}{{#if hasFieldNotes}}Notebook: {{fieldNotes}}{{/if}}'); getPeople.mockResolvedValue(['Tagged Guest']); prefetchPeople.mockResolvedValue({mode:'bulk',names:0}); });
afterEach(async () => { vi.restoreAllMocks(); if(previousDebug===undefined)delete process.env.PHOTO_SELECT_DEBUG_DIR;else process.env.PHOTO_SELECT_DEBUG_DIR=previousDebug; await fs.rm(root,{recursive:true,force:true}); });
async function images(count) { await Promise.all(Array.from({length:count},(_,index)=>fs.writeFile(path.join(root,`photo-${String(index).padStart(2,'0')}.jpg`),'synthetic image '+index))); }
function provider(reply) { const snapshots = new Map(); return {name:'xiaomi',hostedCuration:{provider:'xiaomi',profile:'test-xiaomi-profile',maxImages:10,credentialEnv:'MIMO_API_KEY',label:'Xiaomi'},preventAutomaticResubmit:true,journal:{identity:{codeRevision:'test'},workflowSnapshot:async(key,initial)=>{if(!snapshots.has(key))snapshots.set(key,structuredClone(initial));return structuredClone(snapshots.get(key));}},submit:vi.fn(async options=>({options})),collect:vi.fn(async({options})=>{const json=reply?await reply(options):valid(options);return {raw:JSON.stringify(json),json};})}; }
function valid(options) {return {minutes:[{speaker:options.curators[0],text:'Visible framing establishes a sequence; what should follow?'}],decisions:options.images.map((file,index)=>({filename:path.basename(file),decision:index%2?'aside':'keep',reason:'Visible photographic evidence.'}))};}
function triage(driver, options={}) {return triageDirectory({dir:root,promptPath:prompt,provider:driver,model:'mimo-v2.6-pro',recurse:false,reasoningEffort:'auto',...options});}

describe('Xiaomi ordinary photographic workflow',()=>{
  it('sends ten images per request independently of the single worker',async()=>{
    await images(21);const driver=provider();await triage(driver,{workers:1});
    expect(driver.submit.mock.calls.map(([options])=>options.images.length)).toEqual([10,10,1]);
    expect((await fs.readdir(root)).filter(name=>name.endsWith('.jpg'))).toEqual([]);
    expect((await fs.readdir(path.join(root,'_level-001'))).filter(name=>name.endsWith('.jpg'))).toHaveLength(21);
  });
  it('supports a smaller explicitly selected request size without changing the recursive target',async()=>{
    await images(12);const driver=provider();await triage(driver,{batchSize:5,targetLevelSize:10});
    expect(driver.submit.mock.calls.map(([options])=>options.images.length)).toEqual([5,5,2]);
  });
  it('preserves seventeen exact curators, full context and both notebook phases before sorting',async()=>{
    await images(10);const contextPath=path.join(root,'brief.txt');await fs.writeFile(contextPath,'Full exhibition context.\nSecond paragraph is essential.');
    const curators=Array.from({length:17},(_,index)=>`Curator ${index+1} (exact)`);
    const driver=provider(async options=>{
      if(options.expectFieldNotesMd){expect((await fs.readdir(root)).filter(name=>name.endsWith('.jpg'))).toHaveLength(10);return {field_notes_md:'# Notebook\n\nThe visible sequence remains open.'};}
      return {...valid(options),field_notes_diff:'--- old\n+++ new\n@@ -0,0 +1 @@\n+# Notebook'};
    });
    await triage(driver,{curators,contextPath,fieldNotes:true,batchSize:10,targetLevelSize:10});
    expect(driver.submit).toHaveBeenCalledTimes(2);const [first,second]=driver.submit.mock.calls.map(([options])=>options);
    expect(first.curators).toEqual([...curators,'Tagged Guest']);expect(second.curators).toEqual(first.curators);expect(second.images).toEqual(first.images);expect(second.photoPeople).toEqual(first.photoPeople);
    expect(first.expectFieldNotesDiff).toBe(true);expect(second.expectFieldNotesMd).toBe(true);
    expect(first.prompt).toContain('Full exhibition context.\nSecond paragraph is essential.');expect(second.prompt).toContain('Full exhibition context.\nSecond paragraph is essential.');
    expect(await fs.readFile(path.join(root,'_level-001','field-notes.md'),'utf8')).toContain('# Notebook');
    await expect(fs.stat(path.join(root,'.git'))).rejects.toThrow();
    expect((await fs.readdir(root)).filter(name=>name.endsWith('.jpg'))).toEqual([]);
  });
  it('starts with the contract default roster before repeated photo tags are appended',async()=>{
    await images(2);const driver=provider();await triage(driver);
    expect(driver.submit.mock.calls[0][0].curators).toEqual(['Ingeborg Gerdes','Alexandra Munroe','Deborah Treisman','Warren Sack','Tagged Guest']);
  });
  it('holds direct Xiaomi orchestration with multiple workers before archiving or submission',async()=>{
    await images(2);const driver=provider();await expect(triage(driver,{workers:2})).rejects.toThrow(/one worker/);expect(driver.submit).not.toHaveBeenCalled();await expect(fs.stat(path.join(root,'_level-001'))).rejects.toThrow();
  });
  it('holds an explicit batch size above the Xiaomi ten-image capability before archiving or submission',async()=>{
    await images(11);const driver=provider();await expect(triage(driver,{batchSize:11})).rejects.toThrow(/10/);expect(driver.submit).not.toHaveBeenCalled();await expect(fs.stat(path.join(root,'_level-001'))).rejects.toThrow();
  });
  it('uses MIMO_API_KEY when screening frozen metadata before private persistence',async()=>{
    await images(2);const old=process.env.MIMO_API_KEY;process.env.MIMO_API_KEY='synthetic-mimo-exact-secret';getPeople.mockResolvedValue(['synthetic-mimo-exact-secret']);const driver=provider();
    try{await expect(triage(driver)).rejects.toMatchObject({code:'XIAOMI_HELD'});expect(driver.submit).not.toHaveBeenCalled();}finally{if(old===undefined)delete process.env.MIMO_API_KEY;else process.env.MIMO_API_KEY=old;}
  });
  it('screens the trimmed Xiaomi credential before persisting frozen metadata',async()=>{
    await images(2);const old=process.env.MIMO_API_KEY;process.env.MIMO_API_KEY='  synthetic-mimo-exact-secret  ';getPeople.mockResolvedValue(['synthetic-mimo-exact-secret']);const driver=provider();
    try{await expect(triage(driver)).rejects.toMatchObject({code:'XIAOMI_HELD'});expect(driver.submit).not.toHaveBeenCalled();}finally{if(old===undefined)delete process.env.MIMO_API_KEY;else process.env.MIMO_API_KEY=old;}
  });
  it('retains the DeepInfra four-image batching cap',async()=>{
    await images(10);const driver=provider();driver.name='deepinfra';delete driver.hostedCuration;await triage(driver,{model:'XiaomiMiMo/MiMo-V2.6-Pro'});
    expect(driver.submit.mock.calls.map(([options])=>options.images.length)).toEqual([4,4,2]);
  });
});
