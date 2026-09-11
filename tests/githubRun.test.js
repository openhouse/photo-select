import {it,expect} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {createGithubAudit,startGithubRun} from '../src/githubRun.js';
const exec=promisify(execFile);
it('serializes twenty audit commits with matching response and field notes',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'github-audit-'));
 try{const save=await createGithubAudit(root);await Promise.all(Array.from({length:20},(_,i)=>save({status:'completed',json:{minutes:[{speaker:'Fixture',text:`Reading ${i}?`}],decisions:[]},attempts:[]})));
 const files=(await fs.readdir(root)).filter(x=>/^curation-/.test(x));expect(files).toHaveLength(20);
 const commits=(await exec('git',['-C',root,'log','--format=%H'])).stdout.trim().split('\n');expect(commits).toHaveLength(20);
 for(const commit of commits){const names=(await exec('git',['-C',root,'show','--format=','--name-only',commit])).stdout;expect(names).toContain('field-notes.md');expect(names).toContain('curation-');}
 expect((await exec('git',['-C',root,'remote'])).stdout).toBe('');
 }finally{await fs.rm(root,{recursive:true,force:true});}
},15000); // Twenty real Git commits can exceed Vitest's 5-second default on external storage.
it('starts no research phase and stops the tunnel if private preparation fails',async()=>{
 let stopped=false;await expect(startGithubRun({source:'/nonexistent-photos',tunnelId:'tunnel_'+'a'.repeat(32)},{startTunnel:async()=>({stop:async()=>{stopped=true;},assertCurrent:async()=>{}})})).rejects.toThrow();expect(stopped).toBe(true);
});
it('rejects an oversized brief locally before starting a tunnel or copying images',async()=>{
 let started=false;
 try {
  await startGithubRun({source:'/nonexistent-photos',brief:'x '.repeat(1_060_000),tunnelId:'tunnel_'+'a'.repeat(32)},{startTunnel:async()=>{started=true;return {stop:async()=>{},assertCurrent:async()=>{}};}});
  throw Error('accepted oversized brief');
 }catch(error){expect(error.message).toMatch(/context.*tokens/i);expect(error.message).toMatch(/shorter/i);}
 expect(started).toBe(false);
},20000);
