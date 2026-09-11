import {sha256} from './knowledgeLive.js';
import {buildCacheableResponsesPrompt,stabilizeResponseSchemaForPromptCache} from './promptCaching.js';
// Cache the existing rendered prompt without inserting or rewriting prose.
export function cacheGithubRequest(request,{promptCachePrefix,briefTokens,serviceTier}) {
  if(briefTokens<1024)return request;
  const fields=buildCacheableResponsesPrompt({model:request.model,instructions:request.instructions,input:request.input,promptCachePrefix});
  if(!fields.prompt_cache_key)return request;
  const schema=stabilizeResponseSchemaForPromptCache(request.text.format.schema);
  const {instructions,...rest}=request;
  const cached={...rest,...fields,...(serviceTier?{service_tier:serviceTier}:{}),text:{...request.text,format:{...request.text.format,schema}}};
  const stable={...cached,input:[{...cached.input[0],content:[cached.input[0].content[0]]}]};
  delete stable.prompt_cache_key;
  return {...cached,prompt_cache_key:'photo-select:github-v3:'+sha256(stable).slice(0,32)};
}
export function repairGithubRequest(request) {
  const repair='\nRepair the previous invalid JSON/voice/filename result. Return a complete reply under the same schema.';
  if(!request.prompt_cache_key)return {...request,instructions:request.instructions+repair};
  return {...request,input:request.input.map((message,index)=>index===0?{...message,content:[...message.content,{type:'input_text',text:repair}]}:message)};
}
export function githubCacheUsage(usage,requiredCachedTokens) {
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const inputTokens=count(usage?.input_tokens),cachedTokens=count(usage?.input_tokens_details?.cached_tokens),writeTokens=count(usage?.input_tokens_details?.cache_write_tokens);
  return {inputTokens,cachedTokens,writeTokens,requiredCachedTokens,
    verified:inputTokens!==null&&cachedTokens!==null&&cachedTokens<=inputTokens&&cachedTokens>=requiredCachedTokens};
}
