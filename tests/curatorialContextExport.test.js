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
async function supplement(f){
 const body='From: Writer\r\nNo rush — keep the optional second request separate.\r\nOn Monday, Reader wrote: Thank you.\r\n';
 const prefix='Archive heading\n';const bytes=Buffer.from(prefix+body+'Archive footer\n');
 const file=path.join(path.dirname(f.output),'previous.txt');await writeFile(file,bytes);
 const sha=value=>createHash('sha256').update(value).digest('hex');
 const entry={file,title:'Complete correspondence',sha256:sha(bytes),byteRange:[Buffer.byteLength(prefix),Buffer.byteLength(prefix+body)],bodySha256:sha(body),provenance:'Verbatim supplied conversation, not a fresh mailbox retrieval.'};
 f.profile.supplements=[entry];return {entry,body};
}
it('binds a restored excerpt to its original file and carries the exact bytes into the real prompt',async()=>{
 const f=await fixture();const {entry,body}=await supplement(f);
 f.profile.retrievalCases.push({id:'complete-conversation',sourceId:entry.bodySha256,contains:['No rush — keep the optional second request separate.','On Monday, Reader wrote: Thank you.']});
 const receipt=await exportCuratorialContext(f.packet,f.profile,f.output);const md=await readFile(f.output,'utf8');
 const {prompt}=await buildPrompt(undefined,{contextPath:f.output,curators:['Example Reader'],images:['one.jpg']});
 expect(md).toContain(body);expect(prompt).toContain(body);expect(receipt.retrievalPassed).toBe(2);
 expect(receipt.supplements[0]).toMatchObject({sourceSha256:entry.sha256,bodySha256:entry.bodySha256,bytes:Buffer.byteLength(body),byteRange:entry.byteRange});
 expect(receipt.coverage.supplementalSources).toBe(1);
});
it('rejects a supplement when the source context changed after selection',async()=>{
 const f=await fixture();const {entry}=await supplement(f);await writeFile(entry.file,'different source');
 await expect(exportCuratorialContext(f.packet,f.profile,f.output)).rejects.toThrow(/Supplement source integrity/);
 await expect(readFile(f.output)).rejects.toThrow();
});
it('rejects a shortened excerpt even when it still contains a key sentence',async()=>{
 const f=await fixture();const {entry}=await supplement(f);entry.byteRange[1]-=2;
 await expect(exportCuratorialContext(f.packet,f.profile,f.output)).rejects.toThrow(/Supplement body integrity/);
});
it('rejects byte ranges that run outside the original source',async()=>{
 const f=await fixture();const {entry}=await supplement(f);entry.byteRange=[-1,20];
 await expect(exportCuratorialContext(f.packet,f.profile,f.output)).rejects.toThrow(/Supplement byte range/);
});
it('rejects a matching-hash excerpt that splits a UTF-8 character',async()=>{
 const f=await fixture();const {entry}=await supplement(f);const bytes=await readFile(entry.file);const start=bytes.indexOf(Buffer.from('—'));
 entry.byteRange=[start,start+1];entry.bodySha256=createHash('sha256').update(bytes.subarray(start,start+1)).digest('hex');
 await expect(exportCuratorialContext(f.packet,f.profile,f.output)).rejects.toThrow(/encoded data/);
});
