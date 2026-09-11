import {knowledgeError} from './core/knowledgeLive.js';
import {validateGithubBrief} from './core/githubBrief.js';
import {githubCacheUsage} from './core/githubPromptCache.js';
// Seed/probe are useful curation jobs. The selected transport and tier are
// explicit in each request; queue release depends on reported reuse.
export class GithubCacheScheduler {
  constructor({send,signal,progress=()=>{},now=Date.now}) {
    Object.assign(this,{send,signal,progress,now});this.groups=new Map();
    signal?.addEventListener('abort',()=>{for(const group of this.groups.values())this.hold(group,knowledgeError('Curation cancelled.'));},{once:true});
  }
  respond(body) {
    if(this.signal?.aborted)return Promise.reject(knowledgeError('Curation cancelled.'));
    if(!body.prompt_cache_key?.startsWith('photo-select:github-v2:'))return this.send(body);
    const key=body.prompt_cache_key;let group=this.groups.get(key);
    if(!group){
      const brief=JSON.parse(body.input[0].content[0].text).brief;
      // Conservative coverage guard: a tiny unrelated hit must not release a
      // half-million-token brief. API tokenization can differ from local counts.
      group={key,required:Math.ceil(validateGithubBrief(brief).textTokens*.95),phase:'seed',queue:[],active:false,lastHit:0};this.groups.set(key,group);
    }
    if(group.error)return Promise.reject(group.error);
    return new Promise((resolve,reject)=>{group.queue.push({body,resolve,reject});if(!group.active)void this.pump(group);});
  }
  hold(group,error){group.error??=error;for(const job of group.queue.splice(0))job.reject(group.error);}
  async pump(group) {
    group.active=true;
    try {
      while(group.queue.length&&!group.error){
        if(group.phase==='reader'&&this.now()-group.lastHit>=20*60*1000)group.phase='probe';
        const role=group.phase,jobs=group.queue.splice(0,role==='reader'?8:1);
        this.progress(`github cache: ${role} submitted (${jobs.length} request${jobs.length===1?'':'s'}); waiting for ${jobs[0].body.service_tier==='flex'?'Flex':'Batch'}`);
        const results=await Promise.allSettled(jobs.map(job=>this.send(job.body)));
        let allHits=true;
        for(let index=0;index<jobs.length;index++){
          const result=results[index],job=jobs[index];
          if(result.status==='rejected'){job.reject(result.reason);this.hold(group,result.reason);allHits=false;continue;}
          const response=result.value,usage=githubCacheUsage(response.usage,group.required);
          const cache={role,key:group.key,...usage};
          this.progress(`github cache: ${role} cached=${usage.cachedTokens??'unknown'} write=${usage.writeTokens??'unknown'} input=${usage.inputTokens??'unknown'}; ${usage.verified?'hit confirmed':'reuse not confirmed'}`);
          // A valid completed curation remains useful even when its cache misses.
          job.resolve({...response,_photoSelectCache:cache});
          allHits&&=usage.verified;
          if((job.body.service_tier==='flex'&&response.service_tier!=='flex')||response.status!=='completed'||(role!=='seed'&&!usage.verified)||
            (role==='seed'&&!usage.verified&&!(usage.writeTokens>=group.required))){
            this.hold(group,knowledgeError(`GitHub prompt cache ${role} did not confirm ${group.required} reusable tokens; further curation held. See private usage receipts before retrying.`));
          }
        }
        if(group.error){this.progress('github cache: further requests held; completed curation results retained');break;}
        if(allHits){group.phase='reader';group.lastHit=this.now();}else group.phase='probe';
      }
    }catch(error){this.hold(group,error);}
    finally{group.active=false;}
  }
}
