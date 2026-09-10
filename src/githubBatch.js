import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {toFile} from 'openai';
import {knowledgeError} from './core/knowledgeLive.js';
// Full Responses bodies and outputs survive this transport. No Chat fallback.
export class GithubBatchTransport {
  constructor({client,signal,flushMs=100,pollMs=10000,saveReceipt=async()=>{}}) {Object.assign(this,{client,signal,flushMs,pollMs,saveReceipt});this.queue=[];}
  respond(body) {
    if(this.signal?.aborted)return Promise.reject(knowledgeError('Curation cancelled.'));
    return new Promise((resolve,reject)=>{
      this.queue.push({body,id:randomUUID(),resolve,reject});
      if(!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;const jobs=this.queue.splice(0);void this.flush(jobs);},this.flushMs);
    });
  }
  async flush(jobs) {
    let input,batch,output,errorFile,results,failure;
    const deleted=[],runId=randomUUID();
    const state=status=>({runId,status,batchId:batch?.id??null,inputFile:input?.id??null,outputFile:output??null,errorFile:errorFile??null,deletedFiles:[...deleted]});
    try {
      this.signal?.throwIfAborted();
      const payload=jobs.map(j=>JSON.stringify({custom_id:j.id,method:'POST',url:'/v1/responses',body:j.body})).join('\n')+'\n';
      input=await this.client.files.create({purpose:'batch',file:await toFile(Buffer.from(payload),'photo-select.jsonl')});
      await this.saveReceipt(state('uploaded'));
      batch=await this.client.batches.create({input_file_id:input.id,endpoint:'/v1/responses',completion_window:'24h'});
      await this.saveReceipt(state('submitted'));
      while(true) {
        this.signal?.throwIfAborted();
        batch=await this.client.batches.retrieve(batch.id,{signal:this.signal});
        output=batch.output_file_id;errorFile=batch.error_file_id;
        await this.saveReceipt(state(batch.status));
        if(batch.status==='completed')break;
        if(['failed','expired','cancelled','cancelling'].includes(batch.status))throw knowledgeError('Batch did not complete.');
        await delay(this.pollMs,undefined,{signal:this.signal});
      }
      if(!output)throw knowledgeError('Batch output is missing.');
      const text=await (await this.client.files.content(output,{signal:this.signal})).text();
      const rows=text.trim().split('\n').map(JSON.parse);results=new Map();
      for(const row of rows){if(results.has(row.custom_id))throw knowledgeError('Duplicate Batch result.');results.set(row.custom_id,row);}
      if(results.size!==jobs.length||jobs.some(j=>!results.has(j.id)))throw knowledgeError('Batch result set differs from submitted requests.');
    }catch{failure=knowledgeError('GitHub Batch curation held; verify tunnel availability and API access.');}
    finally {
      if(failure&&batch&&!['completed','failed','expired','cancelled'].includes(batch.status)) {
        try{await this.client.batches.cancel(batch.id);}catch{failure=knowledgeError('Batch cancellation failed; check the private Batch receipt.');}
      }
      for(const id of [input?.id,output,errorFile].filter(Boolean)) {
        try{await this.client.files.del(id);deleted.push(id);}catch{failure=knowledgeError('Temporary Batch file cleanup failed; check the private Batch receipt.');}
      }
    }
    const receipt=state(failure?'held':'completed');
    try{await this.saveReceipt(receipt);}catch{failure=knowledgeError('Private Batch receipt persistence failed.');}
    for(const job of jobs) {
      const row=results?.get(job.id);
      if(failure||row?.error||row?.response?.status_code!==200){const error=failure||knowledgeError('The Batch curation request failed.');error.receipt=receipt;job.reject(error);}
      else job.resolve({...row.response.body,_photoSelectBatch:receipt});
    }
  }
}
