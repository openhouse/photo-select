import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { isKnowledgeRepository, selectBranches, allowedTextPath, sha256, knowledgeError } from './core/knowledgeLive.js';
const exec = promisify(execFile);
export function createGithubRequest({ signal, timeout = 30000 } = {}) {
  const run = async args => {
    try { const {stdout} = await exec('gh', ['api','--hostname','github.com',...args], {signal,timeout,maxBuffer:16*1024*1024,env:{...process.env,GH_DEBUG:''}}); return JSON.parse(stdout); }
    catch { throw knowledgeError('GitHub access failed. Check gh auth status; the private run log contains the completed steps.'); }
  };
  return async (endpoint, variables = {}) => {
    if (endpoint !== 'branches') return run(['--method','GET',endpoint]);
    const query = 'query($owner:String!,$name:String!,$cursor:String){repository(owner:$owner,name:$name){refs(refPrefix:"refs/heads/",first:100,after:$cursor){nodes{name target{... on Commit{oid committedDate}}}pageInfo{hasNextPage endCursor}}}}';
    let cursor=null; const refs=[], seen=new Set();
    do {
      const args=['graphql','--method','POST','-f',`query=${query}`,'-f',`owner=${variables.owner}`,'-f',`name=${variables.name}`];
      if(cursor) args.push('-f',`cursor=${cursor}`);
      const response=await run(args); const page=response.data?.repository?.refs;
      if(response.errors || !page) throw knowledgeError('Branch discovery is unavailable.');
      refs.push(...page.nodes); cursor=page.pageInfo.hasNextPage?page.pageInfo.endCursor:null;
      if(cursor && seen.has(cursor)) throw knowledgeError('Branch pagination repeated a cursor.');
      seen.add(cursor);
      if(refs.length>10000) throw knowledgeError('Branch inventory exceeds the configured discovery boundary.');
    } while(cursor);
    return refs;
  };
}
export class KnowledgeGithub {
  constructor({ request=createGithubRequest(), include=[], exclude=[], branches={}, maxRequests=2000, maxFileBytes=64000, pageSize=12, maxMilliseconds=300000, verifyScope=async()=>{} }={}) {
    Object.assign(this,{request,include,exclude,branches,maxRequests,maxFileBytes,pageSize,verifyScope});
    this.deadline=Date.now()+maxMilliseconds; this.requests=0; this.networkBytes=0;
    this.catalog=[]; this.sources=new Map(); this.cursors=new Map(); this.trees=new Map(); this.bodies=new Map(); this.records=new Map(); this.coverage=[];
  }
  async get(endpoint,vars) {
    if(++this.requests>this.maxRequests || Date.now()>this.deadline) throw knowledgeError('GitHub research budget exhausted.');
    const result=await this.request(endpoint,vars); this.networkBytes+=Buffer.byteLength(JSON.stringify(result));
    if(this.networkBytes>32*1024*1024) throw knowledgeError('GitHub response budget exhausted.');
    return result;
  }
  async discover() {
    this.subject=(await this.get('user')).login;
    if(!this.subject) throw knowledgeError('GitHub account could not be verified.');
    this.inventory=[];
    for(let page=1;page<=100;page++) {
      const items=await this.get(`user/repos?per_page=100&affiliation=owner&page=${page}`);
      if(!Array.isArray(items)) throw knowledgeError('Invalid repository inventory.');
      this.inventory.push(...items);
      if(items.length<100) break;
      if(page===100) throw knowledgeError('Repository inventory is incomplete.');
    }
    for(const repo of this.inventory.filter(r=>this.permitted(r) && (isKnowledgeRepository(r)||this.include.includes(r.full_name)))) await this.addRepository(repo);
    if(!this.catalog.length) throw knowledgeError('No knowledge repositories discovered; add a knowledge-wiki topic or use a profile include list.');
    return this.catalog;
  }
  permitted(repo) { return repo.owner?.login?.toLowerCase()===this.subject?.toLowerCase() && !repo.archived && !this.exclude.includes(repo.full_name); }
  async addRepository(repo) {
    if(this.catalog.some(c=>c.repository===repo.full_name)) return;
    const refs=await this.get('branches',{owner:repo.owner.login,name:repo.name});
    if(!refs.length) { this.coverage.push({repository:repo.full_name,state:'empty-repository'}); return; }
    const selected=selectBranches(refs,repo.default_branch,this.branches[repo.full_name]);
    for(const [index,ref] of selected.entries()) this.catalog.push({id:`repo-${sha256([repo.full_name,ref.name,ref.target.oid]).slice(0,20)}`,repository:repo.full_name,branch:ref.name,commit:ref.target.oid,committedAt:ref.target.committedDate,selection:index===0?'latest-or-explicit':'alternative',description:(repo.description||'').slice(0,400),private:repo.private!==false,otherBranchCount:refs.length-selected.length});
  }
  async authorize(entry) {
    await this.verifyScope();
    const request=this.researchComplete?this.request:(p,v)=>this.get(p,v);
    if((await request('user')).login!==this.subject) throw knowledgeError('GitHub account changed.');
    const metadata=await request(`repos/${entry.repository}`);
    if(!this.permitted(metadata) || metadata.permissions?.pull===false) throw knowledgeError('Repository permission changed.');
    const refs=await request('branches',{owner:metadata.owner.login,name:metadata.name});
    if(!refs.some(x=>x.name===entry.branch && x.target.oid===entry.commit)) throw knowledgeError('A used branch changed; start a fresh research revision.');
  }
  async assertCurrent() {
    await this.verifyScope();
    const request=this.researchComplete?this.request:(p,v)=>this.get(p,v);
    if((await request('user')).login!==this.subject) throw knowledgeError('GitHub account changed.');
    const entries=this.catalog.filter(e=>this.readRecords.some(r=>r.repository===e.repository&&r.commit===e.commit));
    for(const entry of entries) await this.authorize(entry);
  }
  async tree(entry) {
    if(this.trees.has(entry.id)) return this.trees.get(entry.id);
    const result=await this.get(`repos/${entry.repository}/git/trees/${entry.commit}?recursive=1`);
    if(!Array.isArray(result.tree) || typeof result.truncated!=='boolean') throw knowledgeError('Malformed GitHub tree.');
    if(result.truncated) throw knowledgeError('GitHub tree is truncated; narrow the repository before research.');
    let policy={};
    const policyFile=result.tree.find(r=>r.path==='.photo-select-knowledge.json');
    if(policyFile) {
      if(policyFile.mode!=='100644'||policyFile.type!=='blob') throw knowledgeError('Invalid repository policy file.');
      const policyText=await this.body(entry,policyFile);policy=JSON.parse(policyText);
      if(!policy || typeof policy!=='object' || Array.isArray(policy) || Object.keys(policy).some(k=>!['enabled','paths','exclude','purposes','providers','revision'].includes(k))) throw knowledgeError('Unsupported repository policy.');
      if(policy.enabled!==undefined&&typeof policy.enabled!=='boolean') throw knowledgeError('Invalid policy enabled value.');
      for(const key of ['purposes','providers']) if(policy[key]!==undefined&&(!Array.isArray(policy[key])||policy[key].some(x=>typeof x!=='string'))) throw knowledgeError('Invalid source audience policy.');
      if(policy.enabled===false || (policy.purposes&&!policy.purposes.includes('photo-reading')) || (policy.providers&&!policy.providers.includes('openai'))) throw knowledgeError('Repository policy does not allow this research.');
      for(const key of ['paths','exclude']) if(policy[key] && (!Array.isArray(policy[key])||policy[key].some(p=>typeof p!=='string'||!p||p.startsWith('/')||p.includes('..')||/[\\%]/.test(p)))) throw knowledgeError('Invalid source path policy.');
      entry.policyRevision=sha256(policyText);
    }
    const matches=(file,prefix)=>file===prefix||file.startsWith(prefix.endsWith('/')?prefix:prefix+'/');
    const rows=(result.tree||[]).filter(r=>['100644','100755'].includes(r.mode)&&r.type==='blob'&&allowedTextPath(r.path)&&r.size<=this.maxFileBytes&&(!policy.paths||policy.paths.some(p=>matches(r.path,p)))&&!(policy.exclude||[]).some(p=>matches(r.path,p)));
    rows.sort((a,b)=>(/^(README|AGENTS)\.md$/i.test(b.path)?1:0)-(/^(README|AGENTS)\.md$/i.test(a.path)?1:0)||a.path.localeCompare(b.path));
    this.trees.set(entry.id,rows); return rows;
  }
  async body(entry,row) {
    const key=entry.repository+':'+row.sha;
    if(this.bodies.has(key)) return this.bodies.get(key);
    const blob=await this.get(`repos/${entry.repository}/git/blobs/${row.sha}`);
    if(blob.encoding!=='base64') throw knowledgeError('Unsupported GitHub body encoding.');
    const bytes=Buffer.from(blob.content,'base64');
    if(bytes.length>this.maxFileBytes || bytes.includes(0)) throw knowledgeError('Source body is binary or exceeds the read limit.');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    if(/(?:github_pat_|gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{30,}|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)/.test(text)) throw knowledgeError('Credential-like content held before model delivery.');
    this.bodies.set(key,text); return text;
  }
  async search({repositoryId,query='',cursor=null}={}) {
    const entry=this.catalog.find(c=>c.id===repositoryId);
    if(!entry || typeof query!=='string' || query.length>500) throw knowledgeError('Unknown repository or invalid query.');
    await this.authorize(entry);
    const token=cursor?this.cursors.get(cursor):{repositoryId,query,index:0};
    if(!token || token.repositoryId!==repositoryId || token.query!==query) throw knowledgeError('Invalid query continuation.');
    if(cursor) this.cursors.delete(cursor);
    const rows=await this.tree(entry), items=[];
    // Prioritize matching paths; continuation still covers every permitted file.
    const words=query.toLowerCase().split(/\s+/).filter(Boolean);
    const ordered=[...rows].sort((a,b)=>Number(words.some(w=>b.path.toLowerCase().includes(w)))-Number(words.some(w=>a.path.toLowerCase().includes(w))));
    const end=Math.min(token.index+this.pageSize,ordered.length);
    for(const row of ordered.slice(token.index,end)) {
      const text=query?await this.body(entry,row):'';
      if(!query || words.some(w=>(row.path+' '+text).toLowerCase().includes(w))) {
        const id=`source-${sha256([entry.id,row.path,row.sha]).slice(0,24)}`;
        this.sources.set(id,{entry,row}); items.push({id,path:row.path,excerpt:text.slice(0,600),snapshot:entry.commit});
      }
    }
    const nextCursor=end<ordered.length?randomUUID():null;
    if(nextCursor) this.cursors.set(nextCursor,{repositoryId,query,index:end});
    const coverage={repositoryId,query,scanned:end,eligibleFiles:ordered.length,state:nextCursor?'partial':'complete-within-query'};
    this.coverage.push(coverage); return {items,nextCursor,coverage};
  }
  async read({sourceId}={}) {
    const source=this.sources.get(sourceId); if(!source) throw knowledgeError('Unknown source ID.');
    const {entry,row}=source; await this.authorize(entry); const text=await this.body(entry,row);
    const record={id:sourceId,repository:entry.repository,branch:entry.branch,commit:entry.commit,path:row.path,blob:row.sha,policyRevision:entry.policyRevision||'owner-authorized-session',text,digest:sha256(text),speaker:'source-attribution-in-body',posture:'unclassified-source',retrievedAt:new Date().toISOString()};
    this.records.set(sourceId,record);
    const before=this.catalog.length;
    for(const match of text.matchAll(/https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g)) {
      const target=this.inventory.find(r=>r.full_name.toLowerCase()===match[1].replace(/\.git$/,'').toLowerCase());
      if(target&&this.permitted(target)) await this.addRepository(target);
    }
    return {...record,linkedRepositories:this.catalog.slice(before)};
  }
  get readRecords() { return [...this.records.values()]; }
}
