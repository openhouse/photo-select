import { RESEARCH_INSTRUCTIONS, sha256, knowledgeError } from './core/knowledgeLive.js';
const tool=(name,description,properties)=>({type:'function',name,description,strict:true,parameters:{type:'object',additionalProperties:false,properties,required:Object.keys(properties)}});
export const KNOWLEDGE_TOOLS=[
  tool('knowledge_search','Search or browse permitted source text at a pinned branch; use the returned cursor to continue.',{repositoryId:{type:'string'},query:{type:'string'},cursor:{type:['string','null']}}),
  tool('knowledge_read','Read an issued source ID and discover linked repositories.',{sourceId:{type:'string'}}),
];
export async function researchKnowledge({github,catalog,brief,model,respond,save=async()=>{},signal,scope={},maxTurns=16,maxToolCalls=32,maxTokens=60000,maxContextBytes=220000,maxMilliseconds=300000}) {
  const started=Date.now(), input=[{role:'user',content:JSON.stringify({brief,catalog})}], trace=[];
  let tokens=0,calls=0; const callIds=new Set();
  const check=()=>{if(signal?.aborted||Date.now()-started>maxMilliseconds) throw knowledgeError('Research cancelled or timed out.');};
  try {
    for(let turn=0;turn<maxTurns;turn++) {
      check(); if(Buffer.byteLength(JSON.stringify(input))>maxContextBytes) throw knowledgeError('Research context budget exhausted.');
      const response=await respond({model,instructions:RESEARCH_INSTRUCTIONS,input:structuredClone(input),tools:KNOWLEDGE_TOOLS,parallel_tool_calls:false,store:false,max_output_tokens:Math.min(3000,maxTokens-tokens)});
      check();
      if(response.status==='incomplete' || !Number.isSafeInteger(response.usage?.total_tokens) || response.usage.total_tokens<0) throw knowledgeError('Incomplete response or missing token accounting.');
      tokens+=response.usage.total_tokens;
      if(tokens>=maxTokens) throw knowledgeError('Research token budget exhausted.');
      input.push(...(response.output||[]));
      const requests=(response.output||[]).filter(x=>x.type==='function_call');
      if(!requests.length) {
        if(!response.output_text?.trim()||!github.readRecords.length) throw knowledgeError('Research finished without fetched evidence.');
        await github.assertCurrent();
        const frozen={version:1,scope,subject:github.subject,model,brief,summary:response.output_text,records:github.readRecords,catalog:[...github.catalog],coverage:[...github.coverage],tokens,toolCalls:calls,trust:'untrusted-source-data',publication:'held'};
        const context={...frozen,id:`knowledge-live-v1:${sha256(frozen)}`};
        await save({status:'ready',context,trace,input}); return context;
      }
      for(const call of requests) {
        if(++calls>maxToolCalls) throw knowledgeError('Research tool-call budget exhausted.');
        if(!['knowledge_search','knowledge_read'].includes(call.name)) throw knowledgeError('Research requested an unavailable tool.');
        if(!call.call_id || callIds.has(call.call_id)) throw knowledgeError('Duplicate or missing tool call ID.');
        callIds.add(call.call_id);
        const args=JSON.parse(call.arguments);
        const allowed=call.name==='knowledge_search'?['repositoryId','query','cursor']:['sourceId'];
        if(!args||Object.keys(args).some(k=>!allowed.includes(k))) throw knowledgeError('Research tool arguments are invalid.');
        const output=call.name==='knowledge_search'?await github.search(args):await github.read(args);
        trace.push({callId:call.call_id,tool:call.name,args,result:output});
        input.push({type:'function_call_output',call_id:call.call_id,output:JSON.stringify(output)});
        await save({status:'researching',trace,input,tokens,toolCalls:calls});
      }
    }
    throw knowledgeError('Research turn budget exhausted.');
  } catch(error) {
    await save({status:'held',reason:error.code==='KNOWLEDGE_HELD'?error.message:'Research request failed.',trace,input,tokens,toolCalls:calls});
    throw knowledgeError(error.code==='KNOWLEDGE_HELD'?error.message:'Research failed; inspect the private receipt and restart.');
  }
}
