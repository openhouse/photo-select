import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReplySchema} from '../replySchema.js';
import {knowledgeError,sha256} from '../core/knowledgeLive.js';
import {credentialLike} from '../core/githubBridge.js';
import {githubTool,sessionCurators,responseText,githubSources,validateGithubReply,GITHUB_CURATION_INSTRUCTIONS} from '../core/githubCuration.js';
export class GithubCurationProvider {
  name='openai';knowledge=true;supportsAsync=false;
  promptPath=fileURLToPath(new URL('../../prompts/github_prompt.hbs',import.meta.url));
  constructor({tunnelId,curators=[],brief='',respond,encodeImage,save=async()=>{},assertDirectory=async()=>{},assertCurrent=async()=>{}}) {
    this.tool=githubTool(tunnelId);this.curators=sessionCurators(curators);
    if(credentialLike(brief))throw knowledgeError('Credential-like content in the brief is held.');
    Object.assign(this,{brief,respond,encodeImage,save,assertDirectory,assertCurrent});
  }
  async submit(options){return {promise:this.chat(options)};}
  async collect(handle){return handle.promise;}
  async chat({model,images=[],prompt='',minutesMin=1,minutesMax=32,verbosity,reasoningEffort}={}) {
    const attempts=[];let request;
    try {
      await this.assertCurrent();
      const filenames=images.map(x=>path.basename(x));
      const schema=buildReplySchema({images:filenames,minutesMin:Math.max(1,minutesMin),minutesMax:Math.max(1,minutesMax)});
      schema.properties.minutes.items.properties.speaker.enum=[...this.curators];
      const content=[{type:'input_text',text:JSON.stringify({brief:this.brief,curators:this.curators,filenames,allowedKeys:['minutes','decisions']})}];
      for(const file of images)content.push({type:'input_text',text:JSON.stringify({filename:path.basename(file)})},{type:'input_image',image_url:'data:image/jpeg;base64,'+(await this.encodeImage(file)).toString('base64'),detail:'high'});
      request={model,store:false,instructions:`${prompt}\n${GITHUB_CURATION_INSTRUCTIONS}\nSession curators: ${JSON.stringify(this.curators)}\nFilenames: ${JSON.stringify(filenames)}\nAllowed JSON keys: minutes, decisions.`,input:[{role:'user',content}],tools:[this.tool],max_tool_calls:32,max_output_tokens:16000,text:{format:{type:'json_schema',name:'photo_select',strict:true,schema}}};
      if(/^gpt-[56]/i.test(model)&&verbosity)request.text.verbosity=verbosity;
      if(/^(?:gpt-[56]|o[1-9])/i.test(model)&&reasoningEffort&&reasoningEffort!=='auto')request.reasoning={effort:reasoningEffort};
      for(let attempt=0;attempt<2;attempt++) {
        await this.assertCurrent();
        const submitted={...request,instructions:request.instructions+(attempt?'\nRepair the previous invalid JSON/voice/filename/citation result. Return a complete reply under the same schema.':'')};
        const response=await this.respond(submitted);
        if(credentialLike(response))throw knowledgeError('Credential-like response held.');
        attempts.push({request_sha256:sha256(submitted),response});
        if(response.status!=='completed'||response.output?.some(x=>x.type==='mcp_approval_request'||x.type==='mcp_call'&&x.error))throw knowledgeError('Curation or GitHub tool execution did not complete.');
        let json;
        try {
          json=JSON.parse(responseText(response));validateGithubReply(json,filenames,this.curators,response.output||[]);
          if(json.minutes.length<schema.properties.minutes.minItems||json.minutes.length>schema.properties.minutes.maxItems)throw knowledgeError('Invalid minutes count.');
        }catch(error){if(attempt)throw error;continue;}
        await this.save({status:'completed',model,model_sha256:sha256(submitted),request:submitted,attempts,json,sources:githubSources(response.output),retry_recovered:attempt===1,usage:response.usage||null});
        return {raw:JSON.stringify(json),json};
      }
    }catch(error){
      await this.save({status:'held',model,request,attempts,transport:error?.receipt??null,reason:error?.code==='KNOWLEDGE_HELD'?error.message:'Curation, GitHub access or reply validation failed.'});
      throw knowledgeError(error?.code==='KNOWLEDGE_HELD'?error.message:'GitHub curation held; see the private run receipt.');
    }
  }
}
