import {GithubCacheScheduler} from './githubCacheScheduler.js';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {toFile} from 'openai';
import {knowledgeError,sha256} from './core/knowledgeLive.js';
import {batchDiagnostic,batchFailureMessage,failedBatchRow,batchRowDiagnostic} from './core/githubBatchErrors.js';
// Small/legacy requests use Batch files. Cacheable requests explicitly select
// Flex at Batch rates, matching the application's established cache-aware path.
export class GithubBatchTransport {
  constructor({client,signal,flushMs=100,pollMs=10000,saveReceipt=async()=>{},progress=()=>{},now,retryDelayMs=1500}) {Object.assign(this,{client,signal,flushMs,pollMs,saveReceipt,progress,retryDelayMs});this.queue=[];this.cache=new GithubCacheScheduler({send:body=>body.service_tier==='flex'?this.sendFlex(body):this.enqueue(body),signal,progress,now});}
  respond(body) {return this.cache.respond(body);}
  async sendFlex(body) {
    const runId=randomUUID(),errors=[];
    const state=(status,extra={})=>({runId,transport:'flex',status,endpoint:'/v1/responses',serviceTier:'flex',request_sha256:sha256(body),errors:[...errors],...extra});
    for(let attempt=0;attempt<3;attempt++) {
      this.signal?.throwIfAborted();
      await this.saveReceipt(state('submitted',{attempt:attempt+1}));
      let response;
      try {
        response=await this.client.responses.create(body,{signal:this.signal,timeout:900000,maxRetries:0});
      }catch(error){
        const diagnostic=batchDiagnostic(error);errors.push(diagnostic);
        const retry=error.status===429&&['resource_unavailable','rate_limit_exceeded'].includes(error.code)&&attempt<2;
        const receipt=state(retry?'retrying':'held',{attempt:attempt+1});await this.saveReceipt(receipt);
        if(!retry){const held=knowledgeError(batchFailureMessage(diagnostic,'Flex'));held.receipt=receipt;throw held;}
        const header=error.headers?.get?.('retry-after')??error.headers?.['retry-after'];
        const ms=Math.max(this.retryDelayMs*2**attempt,Number(header)*1000||0);
        this.progress(`github Flex: ${diagnostic.code}; retrying rejected request in ${Math.ceil(ms/1000)}s (${attempt+2}/3)`);
        await delay(ms,undefined,{signal:this.signal});continue;
      }
      const receipt=state(response.status==='completed'&&response.service_tier==='flex'?'completed':'held',{responseId:response.id,actualServiceTier:response.service_tier,usage:response.usage??null,attempt:attempt+1});
      await this.saveReceipt(receipt);
      return {...response,_photoSelectFlex:receipt};
    }
  }
  enqueue(body) {
    if(this.signal?.aborted)return Promise.reject(knowledgeError('Curation cancelled.'));
    return new Promise((resolve,reject)=>{
      this.queue.push({body,id:randomUUID(),resolve,reject});
      if(!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;const jobs=this.queue.splice(0);void this.flush(jobs);},this.flushMs);
    });
  }
  async flush(jobs) {
    let input,batch,output,errorFile,results,failure,diagnosticsSaved=false;
    const errors=[];
    const deleted=[],runId=randomUUID();
    const state=status=>({runId,status,batchId:batch?.id??null,inputFile:input?.id??null,outputFile:output??null,errorFile:errorFile??null,deletedFiles:[...deleted],errors:[...errors]});
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
        if(['failed','expired','cancelled','cancelling'].includes(batch.status)){
          for(const error of batch.errors?.data||[])errors.push(batchDiagnostic(error));
          throw knowledgeError(errors.length?batchFailureMessage(errors[0]):`Batch did not complete (${batch.status}).`);
        }
        await delay(this.pollMs,undefined,{signal:this.signal});
      }
      if(!output&&!errorFile)throw knowledgeError('Batch result files are missing.');
      results=new Map();
      for(const id of [output,errorFile].filter(Boolean)) {
        const text=await (await this.client.files.content(id,{signal:this.signal})).text();
        for(const line of text.split('\n').filter(x=>x.trim())) {
          const row=JSON.parse(line);
          if(results.has(row.custom_id))throw knowledgeError('Duplicate Batch result.');
          results.set(row.custom_id,row);
          if(failedBatchRow(row))errors.push(batchRowDiagnostic(row));
        }
      }
      if(results.size!==jobs.length||jobs.some(j=>!results.has(j.id)))throw knowledgeError('Batch result set differs from submitted requests.');
      await this.saveReceipt(state('retrieved'));
      diagnosticsSaved=true;
    }catch(error){
      if(error?.code==='KNOWLEDGE_HELD')failure=error;
      else {const diagnostic=batchDiagnostic(error);errors.push(diagnostic);failure=knowledgeError(batchFailureMessage(diagnostic));}
      if((output||errorFile)&&!diagnosticsSaved)failure=knowledgeError('Batch result retrieval or private receipt persistence failed; remote files retained for recovery.');
    }
    finally {
      if(failure&&batch&&!['completed','failed','expired','cancelled'].includes(batch.status)) {
        try{await this.client.batches.cancel(batch.id);}catch{failure=knowledgeError('Batch cancellation failed; check the private Batch receipt.');}
      }
      for(const id of ((output||errorFile)&&!diagnosticsSaved?[]:[input?.id,output,errorFile]).filter(Boolean)) {
        try{await this.client.files.del(id);deleted.push(id);}catch{failure=knowledgeError('Temporary Batch file cleanup failed; check the private Batch receipt.');}
      }
    }
    const failed=results?[...results.values()].filter(failedBatchRow).length:0;
    const receipt=state(failure||failed===jobs.length?'held':failed?'partial':'completed');
    try{await this.saveReceipt(receipt);}catch{failure=knowledgeError('Private Batch receipt persistence failed.');}
    for(const job of jobs) {
      const row=results?.get(job.id);
      if(failure||failedBatchRow(row)){const error=failure||knowledgeError(batchFailureMessage(batchRowDiagnostic(row)));error.receipt=receipt;job.reject(error);}
      else job.resolve({...row.response.body,_photoSelectBatch:receipt});
    }
  }
}
