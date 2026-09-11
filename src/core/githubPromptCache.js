import {sha256} from './knowledgeLive.js';
import {stabilizeResponseSchemaForPromptCache} from './promptCaching.js';
import {GITHUB_CURATION_INSTRUCTIONS} from './githubCuration.js';
// A separate versioned namespace: no reuse of the older dynamic GitHub prefix.
export function cacheGithubRequest(request,{brief,briefTokens}) {
  const version=String(request.model).match(/^gpt-(\d+)\.(\d+)(?:$|[-.])/i);
  if(!version||Number(version[1])<5||Number(version[1])===5&&Number(version[2])<6||briefTokens<1024)return request;
  const schema=stabilizeResponseSchemaForPromptCache(request.text.format.schema);
  delete schema.properties.minutes.items.properties.speaker.enum;
  const bounds=request.text.format.schema.properties.minutes;
  const dynamicInstructions=request.instructions+`\nProduce between ${bounds.minItems} and ${bounds.maxItems} minutes items.`;
  const metadata=JSON.parse(request.input[0].content[0].text);delete metadata.brief;
  const stable={...request,instructions:GITHUB_CURATION_INSTRUCTIONS,text:{...request.text,format:{...request.text.format,schema}},
    input:[{role:'user',content:[{type:'input_text',text:JSON.stringify({brief}),prompt_cache_breakpoint:{mode:'explicit'}}]}],
    prompt_cache_options:{mode:'explicit',ttl:'30m'}};
  // All rendered settings before the boundary participate, including tool/schema
  // ordering, model, effort and verbosity. The brief remains untrusted user data.
  const prompt_cache_key='photo-select:github-v1:'+sha256(stable).slice(0,32);
  return {...stable,prompt_cache_key,input:[...stable.input,
    {role:'developer',content:[{type:'input_text',text:dynamicInstructions}]},
    {role:'user',content:[{type:'input_text',text:JSON.stringify(metadata)},...request.input[0].content.slice(1)]}]};
}
export function repairGithubRequest(request) {
  const repair='\nRepair the previous invalid JSON/voice/filename/citation result. Return a complete reply under the same schema.';
  if(!request.prompt_cache_key)return {...request,instructions:request.instructions+repair};
  return {...request,input:request.input.map((message,index)=>index===1?{...message,content:[{...message.content[0],text:message.content[0].text+repair}]}:message)};
}
export function githubCacheUsage(usage,requiredCachedTokens) {
  const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
  const inputTokens=count(usage?.input_tokens),cachedTokens=count(usage?.input_tokens_details?.cached_tokens),writeTokens=count(usage?.input_tokens_details?.cache_write_tokens);
  return {inputTokens,cachedTokens,writeTokens,requiredCachedTokens,
    verified:inputTokens!==null&&cachedTokens!==null&&cachedTokens<=inputTokens&&cachedTokens>=requiredCachedTokens};
}
