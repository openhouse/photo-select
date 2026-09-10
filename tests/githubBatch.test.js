import {it,expect,vi} from 'vitest';
import {GithubBatchTransport} from '../src/githubBatch.js';
function fixture(status='completed'){
 const rows=[],deleted=[],cancelled=[];let uploads=0;
 const client={files:{create:async({file})=>{uploads++;rows.push(...(await file.text()).trim().split('\n').map(JSON.parse));return {id:'input'};},content:async()=>({text:async()=>rows.slice().reverse().map(row=>JSON.stringify({custom_id:row.custom_id,response:{status_code:200,body:{status:'completed',output:[{type:'mcp_call',name:row.body.model,output:'evidence'}]}}})).join('\n')}),del:async id=>deleted.push(id)},batches:{create:async()=>({id:'batch'}),retrieve:async()=>({id:'batch',status,output_file_id:status==='completed'?'output':undefined}),cancel:async id=>cancelled.push(id)}};
 return {client,rows,deleted,cancelled,get uploads(){return uploads;}};
}
it('aggregates 20 concurrent requests, preserves full Responses tools and maps out-of-order results',async()=>{
 const f=fixture(),transport=new GithubBatchTransport({client:f.client,flushMs:5,pollMs:1});
 const results=await Promise.all(Array.from({length:20},(_,i)=>transport.respond({model:String(i),tools:[{type:'mcp',tunnel_id:'tunnel_fixture'}]})));
 expect(f.uploads).toBe(1);expect(f.rows).toHaveLength(20);expect(f.rows.every(x=>x.url==='/v1/responses'&&x.body.tools[0].tunnel_id)).toBe(true);expect(results.map(x=>x.output[0].name)).toEqual(Array.from({length:20},(_,i)=>String(i)));expect(f.deleted.sort()).toEqual(['input','output']);
});
it('fails a failed batch without a Chat Completions fallback and deletes temporary input',async()=>{
 const f=fixture('failed'),t=new GithubBatchTransport({client:f.client,flushMs:1,pollMs:1});await expect(t.respond({model:'fixture'})).rejects.toThrow();expect(f.uploads).toBe(1);expect(f.deleted).toContain('input');
});
it('cancels an in-flight Batch on abort before cleaning up input',async()=>{
 const f=fixture('in_progress'),abort=new AbortController(),t=new GithubBatchTransport({client:f.client,signal:abort.signal,flushMs:1,pollMs:10});const pending=t.respond({model:'fixture'});setTimeout(()=>abort.abort(),15);await expect(pending).rejects.toThrow();expect(f.cancelled).toEqual(['batch']);expect(f.deleted).toContain('input');
});
it('deletes an uploaded input if batch creation fails',async()=>{
 const f=fixture();f.client.batches.create=vi.fn(async()=>{throw Error('no');});const t=new GithubBatchTransport({client:f.client,flushMs:1});await expect(t.respond({})).rejects.toThrow();expect(f.deleted).toEqual(['input']);
});
it('records remote file and batch IDs before polling so interruption remains recoverable',async()=>{
 const f=fixture(),states=[];const t=new GithubBatchTransport({client:f.client,flushMs:1,saveReceipt:async s=>states.push(structuredClone(s))});await t.respond({});expect(states.some(s=>s.inputFile==='input'&&!s.batchId)).toBe(true);expect(states.some(s=>s.batchId==='batch'&&s.status==='submitted')).toBe(true);expect(states.at(-1).deletedFiles.sort()).toEqual(['input','output']);
});

it('reports error-only Batch rows and preserves their diagnostics before deleting remote files',async()=>{
 const f=fixture(),states=[];
 f.client.batches.retrieve=async()=>({id:'batch',status:'completed',output_file_id:null,error_file_id:'errors'});
 f.client.files.content=async()=>({text:async()=>JSON.stringify({custom_id:f.rows[0].custom_id,response:{status_code:400,body:{error:{code:'context_length_exceeded',type:'invalid_request_error',param:'input',message:'Input exceeds the context window.'}}},error:null})});
 f.client.files.del=async id=>{expect(states.some(s=>s.errors?.[0]?.code==='context_length_exceeded')).toBe(true);f.deleted.push(id);};
 const t=new GithubBatchTransport({client:f.client,flushMs:1,saveReceipt:async s=>states.push(structuredClone(s))});
 const error=await t.respond({}).catch(e=>e);
 expect(error.message).toMatch(/context/i);expect(error.message).not.toMatch(/tunnel availability/);
 expect(error.receipt.errors[0]).toMatchObject({code:'context_length_exceeded',status:400,param:'input'});
 expect(error.receipt.status).toBe('held');expect(f.deleted.sort()).toEqual(['errors','input']);
});
it('maps success and error files independently so one failed row does not discard successful curation',async()=>{
 const f=fixture();f.client.batches.retrieve=async()=>({id:'batch',status:'completed',output_file_id:'output',error_file_id:'errors'});
 f.client.files.content=async id=>({text:async()=>id==='output'?JSON.stringify({custom_id:f.rows[0].custom_id,response:{status_code:200,body:{status:'completed',output:[]}},error:null}):JSON.stringify({custom_id:f.rows[1].custom_id,response:null,error:{code:'batch_expired',message:'Expired before execution.'}})});
 const t=new GithubBatchTransport({client:f.client,flushMs:1});const results=await Promise.allSettled([t.respond({}),t.respond({})]);
 expect(results[0].status).toBe('fulfilled');expect(results[1].status).toBe('rejected');expect(results[1].reason.message).toMatch(/batch_expired/);expect(f.deleted.sort()).toEqual(['errors','input','output']);
});
it('retains remote error evidence when its private receipt cannot be saved',async()=>{
 const f=fixture();f.client.batches.retrieve=async()=>({id:'batch',status:'completed',error_file_id:'errors'});
 f.client.files.content=async()=>({text:async()=>JSON.stringify({custom_id:f.rows[0].custom_id,response:null,error:{code:'invalid_request',message:'Rejected.'}})});
 const t=new GithubBatchTransport({client:f.client,flushMs:1,saveReceipt:async s=>{if(s.errors?.length)throw Error('disk full');}});
 await expect(t.respond({})).rejects.toThrow(/receipt/i);expect(f.deleted).toEqual([]);
});
it('redacts credentials from API diagnostics and never prints raw API messages',async()=>{
 const f=fixture(),secret='ghp_'+ 'A'.repeat(36),states=[];
 f.client.batches.create=async()=>{throw Object.assign(Error('Rejected '+secret),{status:401,code:'invalid_api_key'});};
 const t=new GithubBatchTransport({client:f.client,flushMs:1,saveReceipt:async s=>states.push(s)});
 const error=await t.respond({}).catch(e=>e);expect(error.message).toContain('invalid_api_key');expect(JSON.stringify(states)).not.toContain(secret);expect(error.message).not.toContain(secret);
});
