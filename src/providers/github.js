import path from 'node:path';
import {omitEncryptedReasoning} from '../core/githubResponse.js';
import {buildPrompt,DEFAULT_PROMPT_PATH} from '../templates.js';
import {sanitizePeople} from '../lib/people.js';
import {cacheGithubRequest,repairGithubRequest} from '../core/githubPromptCache.js';
import {validateGithubBrief} from '../core/githubBrief.js';
import {buildReplySchema} from '../replySchema.js';
import {knowledgeError,sha256} from '../core/knowledgeLive.js';
import {credentialLike,redactCredentialContent} from '../core/githubBridge.js';
import {githubTool,sessionCurators,curatorsForBatch,responseText,githubSources,validateGithubReply,githubReplyWarnings} from '../core/githubCuration.js';
export class GithubCurationProvider {
  name='openai';knowledge=true;preservePrompt=true;supportsPeopleMetadata=true;supportsAsync=false;
  promptPath=DEFAULT_PROMPT_PATH;
  constructor({tunnelId,curators=[],brief='',briefSize,cacheServiceTier,respond,encodeImage,save=async()=>{},progress=()=>{},assertDirectory=async()=>{},assertCurrent=async()=>{}}) {
    this.tool=githubTool(tunnelId);this.curators=sessionCurators(curators);
    if(credentialLike(brief))throw knowledgeError('Credential-like content in the brief is held.');
    this.briefTokens=(briefSize||validateGithubBrief(brief)).textTokens;
    Object.assign(this,{brief,cacheServiceTier,respond,encodeImage,save,progress,assertDirectory,assertCurrent});
  }
  async submit(options){return {promise:this.chat(options)};}
  async collect(handle){return handle.promise;}
  async chat({model,images=[],curators,photoPeople=[],prompt,promptCachePrefix,minutesMin=1,minutesMax=32,verbosity,reasoningEffort}={}) {
    const attempts=[];let request,transport;
    try {
      const batchCurators=curatorsForBatch(this.curators,curators);
      if(prompt===undefined)({prompt,promptCachePrefix}=await buildPrompt(this.promptPath,{curators:batchCurators,images,contextText:this.brief,minutesMin,minutesMax}));
      await this.assertCurrent();
      const filenames=images.map(x=>path.basename(x));
      const schema=buildReplySchema({images:filenames,minutesMin:Math.max(1,minutesMin),minutesMax:Math.max(1,minutesMax)});
      const content=[{type:'input_text',text:'Here are the images:\nRespond in json format.'}];
      const peopleByName=new Map(photoPeople.map(({file,people})=>[file,sanitizePeople(people)]));
      for(const file of images)content.push({type:'input_text',text:JSON.stringify({filename:path.basename(file),...(peopleByName.get(path.basename(file))?.length?{people:peopleByName.get(path.basename(file))}:{})})},{type:'input_image',image_url:'data:image/jpeg;base64,'+(await this.encodeImage(file)).toString('base64'),detail:'high'});
      request={model,store:false,instructions:prompt,input:[{role:'user',content}],tools:[this.tool],max_tool_calls:32,max_output_tokens:16000,text:{format:{type:'json_schema',name:'photo_select',strict:true,schema}}};
      if(/^gpt-[56]/i.test(model)&&verbosity)request.text.verbosity=verbosity;
      if(/^(?:gpt-[56]|o[1-9])/i.test(model)&&reasoningEffort&&reasoningEffort!=='auto')request.reasoning={effort:reasoningEffort};
      request=cacheGithubRequest(request,{promptCachePrefix,briefTokens:this.briefTokens,serviceTier:this.cacheServiceTier});
      let repair;
      for(let attempt=0;attempt<2;attempt++) {
        await this.assertCurrent();
        const submitted=attempt?repairGithubRequest(request,repair):request;
        const received=await this.respond(submitted);
        const {response,omittedEncryptedReasoning}=omitEncryptedReasoning(received);
        const provenance={request_sha256:sha256(submitted),response_sha256:sha256(received),omittedEncryptedReasoning};
        if(credentialLike(response)){
          const redacted=redactCredentialContent(response);
          transport=redacted.value._photoSelectFlex??redacted.value._photoSelectBatch;
          attempts.push({...provenance,response:redacted.value,redacted:true,credentialFindings:redacted.findings});
          throw knowledgeError('Credential-like response held; see redacted diagnostics in the private curation record.');
        }
        transport=response._photoSelectFlex??response._photoSelectBatch;
        attempts.push({...provenance,response,...(repair?{repair}:{})});
        if(submitted.service_tier==='flex'&&response.service_tier!=='flex')throw knowledgeError('GitHub curation returned an unexpected service tier; further work held.');
        if(response.status!=='completed'||response.output?.some(x=>x.type==='mcp_approval_request'||x.type==='mcp_call'&&x.error))throw knowledgeError('Curation or GitHub tool execution did not complete.');
        let json;
        try {
          json=JSON.parse(responseText(response));validateGithubReply(json,filenames);
        }catch(error){
          if(!error.issues&&!(error instanceof SyntaxError))throw error;
          const issues=error.issues??[{code:'JSON_PARSE'}];
          attempts.at(-1).validationIssues=issues;
          const codes=[...new Set(issues.map(i=>i.code))].join(', ');
          if(attempt)throw knowledgeError(`Curation reply invalid (${codes}) after one repair; see the private curation record.`);
          repair={issues,filenames,previousReply:responseText(response)};
          this.progress(`github: reply validation ${codes}; repair 1/1 with specific feedback`);
          continue;
        }
        const warnings=githubReplyWarnings(json,{minutesMin:schema.properties.minutes.minItems,minutesMax:schema.properties.minutes.maxItems});
        await this.save({status:'completed',warnings,model,model_sha256:sha256(submitted),request:submitted,attempts,json,sources:githubSources(response.output),retry_recovered:attempt===1,usage:response.usage||null});
        if(attempt)this.progress('github: reply retry recovered; exact filenames and reply contract verified');
        for(const warning of warnings)this.progress(`github: ${warning.message}`);
        return {raw:JSON.stringify(json),json};
      }
    }catch(error){
      await this.save({status:'held',model,request,attempts,transport:error?.receipt??transport??null,reason:error?.code==='KNOWLEDGE_HELD'?error.message:'Curation, GitHub access or reply validation failed.'});
      throw knowledgeError(error?.code==='KNOWLEDGE_HELD'?error.message:'GitHub curation held; see the private run receipt.');
    }
  }
}
