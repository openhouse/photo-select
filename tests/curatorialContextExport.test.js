import {it,expect,afterEach} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {buildPacket} from '../scripts/lib/curatorialPacket.mjs';
import {exportCuratorialContext} from '../scripts/lib/curatorialContext.mjs';
import {buildPrompt} from '../src/templates.js';
const scratch=[];afterEach(async()=>{for(const p of scratch.splice(0))await rm(p,{recursive:true,force:true});});
async function fixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'context-export-'));scratch.push(root);const source=path.join(root,'input');await mkdir(source);
 const body='# Account\nThe unnamed participant describes studio access.\nhttps://github.com/example/archive\n';await writeFile(path.join(source,'account.md'),body);
 const id=createHash('sha256').update(body).digest('hex');const packet=path.join(root,'packet');
 const built=await buildPacket({title:'Synthetic packet',date:'2026-09-13',roots:{A:source},records:[{packet:'A',path:'account.md',sha256:id,bytes:Buffer.byteLength(body),mode:'exact'}],pages:[{path:'START-HERE.md',title:'Start',body:'[Full account](@{A:account.md})'}]},packet);
 return {packet,output:path.join(root,'context.md'),id,profile:{title:'Synthetic context',date:'2026-09-13',packetFingerprint:built.fingerprint,pagePaths:['START-HERE.md'],sourceIds:[id],maxTokens:5000,retrievalCases:[{id:'studio-access',sourceId:id,contains:['unnamed participant describes studio access']}],request:'Make one context file.'}};
}
it('exports a complete context that the real prompt loader reads without losing source text',async()=>{
 const f=await fixture();const result=await exportCuratorialContext(f.packet,f.profile,f.output);const md=await readFile(f.output,'utf8');
 const {prompt}=await buildPrompt(undefined,{contextPath:f.output,curators:['Example Reader'],images:['one.jpg']});
 expect(prompt).toContain(md);expect(prompt).toContain('The unnamed participant describes studio access.');
 expect(result.retrievalPassed).toBe(1);expect(result.modelRequests).toBe(0);expect(result.inputGuard.textTokens).toBeLessThan(5000);
 const receipt=JSON.parse(await readFile(f.output+'.receipt.json','utf8'));expect(receipt.sha256).toBe(createHash('sha256').update(md).digest('hex'));expect(receipt.originalRequest).toBe('Make one context file.');
});
it('refuses an oversized context instead of silently truncating source bodies',async()=>{
 const f=await fixture();f.profile.maxTokens=10;await expect(exportCuratorialContext(f.packet,f.profile,f.output)).rejects.toThrow(/budget/);
 await expect(readFile(f.output)).rejects.toThrow();
});
it('refuses to reuse a profile from a different packet candidate',async()=>{
 const f=await fixture();f.profile.packetFingerprint='e'.repeat(64);await expect(exportCuratorialContext(f.packet,f.profile,f.output)).rejects.toThrow(/fingerprint/);
});
it('refuses to overwrite a context the user may have edited',async()=>{
 const f=await fixture();await writeFile(f.output,'user edits');await expect(exportCuratorialContext(f.packet,f.profile,f.output)).rejects.toThrow(/exists/);expect(await readFile(f.output,'utf8')).toBe('user edits');
});
it('rejects a corrupted source packet before producing a context',async()=>{
 const f=await fixture();const cat=JSON.parse(await readFile(path.join(f.packet,'manifests/catalog.json'),'utf8'));await writeFile(path.join(f.packet,cat[0].path),'changed');
 await expect(exportCuratorialContext(f.packet,f.profile,f.output)).rejects.toThrow(/integrity/);
});
it('rejects an export when an independently specified source passage is absent',async()=>{
 const f=await fixture();f.profile.retrievalCases[0].contains=['Invented testimony'];await expect(exportCuratorialContext(f.packet,f.profile,f.output)).rejects.toThrow(/retrieval/);
});
