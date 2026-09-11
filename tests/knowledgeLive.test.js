import { describe, it, expect, vi } from 'vitest';
import { selectBranches, isKnowledgeRepository, allowedTextPath, validateCuration, CURATORS } from '../src/core/knowledgeLive.js';
import { KnowledgeGithub } from '../src/knowledgeGithub.js';
import { researchKnowledge } from '../src/knowledgeResearch.js';

const a = 'a'.repeat(40), b = 'b'.repeat(40);
const repo = { name: 'notes-knowledge', full_name: 'owner/notes-knowledge', owner: { login: 'owner' }, default_branch: 'main', topics: [] };
const refs = [{ name: 'main', target: { oid: a, committedDate: '2026-01-01T00:00:00Z' } }, { name: 'work/latest', target: { oid: b, committedDate: '2026-09-10T00:00:00Z' } }];
function apiFixture() {
  const request = vi.fn(async (endpoint, vars) => {
    if (endpoint === 'user') return { login: 'owner' };
    if (endpoint.startsWith('user/repos')) return [repo];
    if (endpoint === 'branches') return refs;
    if (endpoint.includes('/git/trees/'+b)) return { truncated: false, tree: [
      { path: 'README.md', mode: '100644', type: 'blob', sha: a, size: 44 },
      { path: '.env', mode: '100644', type: 'blob', sha: b, size: 10 },
      { path: 'shortcut.md', mode: '120000', type: 'blob', sha: b, size: 10 },
    ] };
    if (endpoint.endsWith('/git/blobs/'+a)) return { encoding: 'base64', content: Buffer.from('An unnamed speaker disagrees. [next](notes.md)').toString('base64') };
    if (endpoint.startsWith('repos/')) return { ...repo, permissions: { pull: true } };
    throw new Error('unexpected fixture request');
  });
  return request;
}
describe('live discovery and branch policy', () => {
  it('selects newest commit date and retains the default branch', () => {
    const result = selectBranches(refs, 'main');
    expect(result.map(x => x.name)).toEqual(['work/latest', 'main']);
    expect(result[0].target.oid).toBe(b);
  });
  it('uses a stable name tie-break and honors an explicit branch', () => {
    expect(selectBranches([...refs].reverse(), 'main', 'main')[0].name).toBe('main');
    expect(() => selectBranches(refs, 'main', 'missing')).toThrow();
  });
  it('recognizes newly named knowledge repos without hardcoded private names', () => {
    expect(isKnowledgeRepository(repo)).toBe(true);
    expect(isKnowledgeRepository({ ...repo, name: 'ordinary', topics: ['knowledge-wiki'] })).toBe(true);
    expect(isKnowledgeRepository({ ...repo, name: 'photography', description: 'photography tools' })).toBe(false);
    expect(isKnowledgeRepository({ ...repo, archived: true })).toBe(false);
  });
  for (const file of ['.env','private-key.pem','foo/../secret.md','foo\\secret.md','credentials.json','image.jpg','node_modules/a.md']) {
    it(`excludes secret, unsafe, or unsupported path ${file}`, () => expect(allowedTextPath(file)).toBe(false));
  }
  it('allows ordinary graph and source text', () => expect(allowedTextPath('wiki/voices.json')).toBe(true));
});
describe('authenticated GitHub reader', () => {
  it('discovers, searches the pinned tree, and reads exact attributable bytes', async () => {
    const github = new KnowledgeGithub({ request: apiFixture() });
    const catalog = await github.discover();
    expect(catalog[0].branch).toBe('work/latest');
    const hits = await github.search({ repositoryId: catalog[0].id, query: 'speaker', cursor: null });
    expect(hits.items).toHaveLength(1);
    const record = await github.read({ sourceId: hits.items[0].id });
    expect(record.commit).toBe(b); expect(record.path).toBe('README.md');
    expect(record.text).toContain('unnamed speaker'); expect(record.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(github.readRecords).toHaveLength(1);
  });
  it('holds unknown IDs without making a request', async () => {
    const request = apiFixture(); const github = new KnowledgeGithub({ request });
    await github.discover(); const before = request.mock.calls.length;
    await expect(github.read({ sourceId: 'invented' })).rejects.toThrow();
    expect(request.mock.calls.length).toBe(before);
  });
  it('does not convert truncation into complete coverage', async () => {
    const request = apiFixture(); const original = request.getMockImplementation();
    request.mockImplementation(async (p,v) => p.includes('/git/trees/') ? { truncated:true, tree:[] } : original(p,v));
    const github = new KnowledgeGithub({ request }); const catalog = await github.discover();
    await expect(github.search({repositoryId:catalog[0].id,query:'',cursor:null})).rejects.toThrow(/truncat/i);
  });
  it('stops when the signed-in account changes', async () => {
    const request = apiFixture(); const github = new KnowledgeGithub({ request }); await github.discover();
    const original = request.getMockImplementation(); request.mockImplementation((p,v) => p==='user' ? {login:'other'} : original(p,v));
    await expect(github.assertCurrent()).rejects.toThrow(/account/i);
  });
});
describe('real research loop with fake network boundaries', () => {
  it('answers search and read calls and freezes the fetched evidence', async () => {
    const github = new KnowledgeGithub({request:apiFixture()}); const catalog=await github.discover();
    const requests=[]; const saved=[];
    const respond = async request => {
      requests.push(structuredClone(request));
      if(requests.length===1) return {output:[{type:'function_call',call_id:'c1',name:'knowledge_search',arguments:JSON.stringify({repositoryId:catalog[0].id,query:'speaker',cursor:null})}],usage:{total_tokens:10}};
      if(requests.length===2) {
        const result=JSON.parse(request.input.at(-1).output);
        return {output:[{type:'function_call',call_id:'c2',name:'knowledge_read',arguments:JSON.stringify({sourceId:result.items[0].id})}],usage:{total_tokens:10}};
      }
      return {output:[],output_text:'An unnamed voice complicates the institutional framing.',usage:{total_tokens:10}};
    };
    const result=await researchKnowledge({github,catalog,brief:'Read the event voices',model:'gpt-4o',respond,save:async x=>saved.push(x)});
    expect(requests).toHaveLength(3); expect(requests[1].input.some(x=>x.call_id==='c1'&&x.type==='function_call_output')).toBe(true);
    expect(result.records).toHaveLength(1); expect(result.id).toMatch(/^knowledge-live-v1:/);
    expect(saved.at(-1).status).toBe('ready'); expect(requests[0].store).toBe(false);
  });
  it('holds a model that finishes without reading anything', async () => {
    const github=new KnowledgeGithub({request:apiFixture()}); const catalog=await github.discover(); const save=vi.fn();
    await expect(researchKnowledge({github,catalog,brief:'event',model:'gpt-4o',respond:async()=>({output:[],output_text:'Everything agrees.',usage:{total_tokens:1}}),save})).rejects.toThrow();
    expect(save.mock.calls.at(-1)[0].status).toBe('held');
  });
  it('rejects unexposed tools and saves a body-free failure reason', async () => {
    const github=new KnowledgeGithub({request:apiFixture()}); const catalog=await github.discover(); const save=vi.fn();
    await expect(researchKnowledge({github,catalog,brief:'event',model:'gpt-4o',respond:async()=>({output:[{type:'function_call',call_id:'x',name:'shell',arguments:'{}'}]}),save})).rejects.toThrow();
    expect(save.mock.calls.at(-1)[0].status).toBe('held');
  });
});
describe('curation invariants', () => {
  const reply=()=>({minutes:[{speaker:CURATORS[0],text:'What does the next image complicate?'}],decisions:[{filename:'a.jpg',decision:'keep',reason:'[source-1]'}]});
  it('accepts a complete fixed-voice reply',()=>expect(validateCuration(reply(),['a.jpg'])).toBe(true));
  for(const [name,mutate] of [['invented filename',x=>x.decisions[0].filename='other.jpg'],['source as speaker',x=>x.minutes[0].speaker='unnamed source'],['extra reply key',x=>x.credentials='secret'],['missing decision',x=>x.decisions=[]]]) {
    it(`rejects ${name}`,()=>{const x=reply();mutate(x);expect(()=>validateCuration(x,['a.jpg'])).toThrow();});
  }
});

describe('live adapter pressure tests',()=>{
  it('rejects replay of a query cursor',async()=>{
    const github=new KnowledgeGithub({request:apiFixture(),pageSize:1});const c=await github.discover();
    const original=github.request;
    github.request=async(p,v)=>p.includes('/git/trees/')?{truncated:false,tree:[{path:'one.md',mode:'100644',type:'blob',sha:a,size:1},{path:'two.md',mode:'100644',type:'blob',sha:a,size:1}]}:original(p,v);
    const first=await github.search({repositoryId:c[0].id,query:'',cursor:null});
    await github.search({repositoryId:c[0].id,query:'',cursor:first.nextCursor});
    await expect(github.search({repositoryId:c[0].id,query:'',cursor:first.nextCursor})).rejects.toThrow();
  });
  it('rejects malformed trees instead of claiming an empty search',async()=>{
    const request=apiFixture(), original=request.getMockImplementation();request.mockImplementation((p,v)=>p.includes('/git/trees/')?{}:original(p,v));
    const github=new KnowledgeGithub({request});const c=await github.discover();
    await expect(github.search({repositoryId:c[0].id,query:'',cursor:null})).rejects.toThrow();
  });
  it('enforces a repository opt-out before delivering source bodies',async()=>{
    const request=apiFixture(),original=request.getMockImplementation();
    request.mockImplementation((p,v)=>p.includes('/git/trees/')?{truncated:false,tree:[{path:'.photo-select-knowledge.json',mode:'100644',type:'blob',sha:b,size:17},{path:'README.md',mode:'100644',type:'blob',sha:a,size:44}]}:p.endsWith('/git/blobs/'+b)?{encoding:'base64',content:Buffer.from('{"enabled":false}').toString('base64')}:original(p,v));
    const github=new KnowledgeGithub({request});const c=await github.discover();
    await expect(github.search({repositoryId:c[0].id,query:'',cursor:null})).rejects.toThrow();
  });
  it('rechecks account identity before returning a cached source body',async()=>{
    const request=apiFixture(),github=new KnowledgeGithub({request});const c=await github.discover();
    const hits=await github.search({repositoryId:c[0].id,query:'speaker',cursor:null});
    await github.read({sourceId:hits.items[0].id});
    const original=request.getMockImplementation();request.mockImplementation((p,v)=>p==='user'?{login:'other'}:original(p,v));
    await expect(github.read({sourceId:hits.items[0].id})).rejects.toThrow();
  });
});


describe('observed search-only premature completion',()=>{
  async function setup(readAfterReminder,{maxTurns=8}={}) {
    const github=new KnowledgeGithub({request:apiFixture()}),catalog=await github.discover(),saved=[];
    const respond=vi.fn(async request=>{
      const turn=respond.mock.calls.length;
      if(turn===1) return {output:[{type:'function_call',call_id:'search',name:'knowledge_search',arguments:JSON.stringify({repositoryId:catalog[0].id,query:'speaker',cursor:null})}],usage:{total_tokens:10}};
      if(turn===3&&readAfterReminder) {
        expect(request.input.at(-1).content).toContain('knowledge_read');
        const hit=JSON.parse(request.input.find(x=>x.type==='function_call_output').output).items[0];
        return {output:[{type:'function_call',call_id:'read',name:'knowledge_read',arguments:JSON.stringify({sourceId:hit.id})}],usage:{total_tokens:10}};
      }
      return {output:[],output_text:'A source-qualified account.',usage:{total_tokens:10}};
    });
    const run=researchKnowledge({github,catalog,brief:'Read the sources',model:'gpt-4o',respond,save:async x=>saved.push(x),maxTurns});
    return {run,respond,saved};
  }
  it('requires a full read after search-only completion and records one bounded correction',async()=>{
    const {run,respond,saved}=await setup(true);const context=await run;
    expect(respond).toHaveBeenCalledTimes(4);expect(context.records).toHaveLength(1);expect(context.tokens).toBe(40);
    expect(saved.some(x=>x.trace.some(t=>t.event==='read-required'))).toBe(true);
    expect(saved.at(-1).status).toBe('ready');
  });
  it('holds when the model ignores the single read correction',async()=>{
    const {run,respond,saved}=await setup(false);await expect(run).rejects.toThrow(/without fetched evidence/);
    expect(respond).toHaveBeenCalledTimes(3);expect(saved.at(-1).status).toBe('held');
  });
  it('does not extend the turn budget for the correction',async()=>{
    const {run,respond}=await setup(true,{maxTurns:2});await expect(run).rejects.toThrow(/budget/);
    expect(respond).toHaveBeenCalledTimes(2);
  });
});


describe('unissued source ID correction',()=>{
  it('explains an unissued ID once, then permits search and an actual issued read',async()=>{
    const github=new KnowledgeGithub({request:apiFixture()}),catalog=await github.discover(),requests=[];
    const read=vi.spyOn(github,'read');
    const respond=async request=>{
      requests.push(request);const turn=requests.length;
      if(turn===1) return {output:[{type:'function_call',call_id:'wrong',name:'knowledge_read',arguments:JSON.stringify({sourceId:catalog[0].id})}],usage:{total_tokens:10}};
      if(turn===2) {
        expect(JSON.parse(request.input.at(-1).output).error).toBe('unknown_source_id');
        return {output:[{type:'function_call',call_id:'search',name:'knowledge_search',arguments:JSON.stringify({repositoryId:catalog[0].id,query:'',cursor:null})}],usage:{total_tokens:10}};
      }
      if(turn===3) return {output:[{type:'function_call',call_id:'read',name:'knowledge_read',arguments:JSON.stringify({sourceId:JSON.parse(request.input.at(-1).output).items[0].id})}],usage:{total_tokens:10}};
      return {output:[],output_text:'Read and attributed.',usage:{total_tokens:10}};
    };
    const context=await researchKnowledge({github,catalog,brief:'event',model:'gpt-4o',respond});
    expect(context.records).toHaveLength(1);expect(read).toHaveBeenCalledTimes(1);expect(context.toolCalls).toBe(3);
  });
  it('holds a repeated unissued ID without attempting any source read',async()=>{
    const github=new KnowledgeGithub({request:apiFixture()}),catalog=await github.discover(),read=vi.spyOn(github,'read');let calls=0;
    const respond=async()=>({output:[{type:'function_call',call_id:String(++calls),name:'knowledge_read',arguments:JSON.stringify({sourceId:catalog[0].id})}],usage:{total_tokens:10}});
    await expect(researchKnowledge({github,catalog,brief:'event',model:'gpt-4o',respond})).rejects.toThrow(/Unknown source ID/);
    expect(calls).toBe(2);expect(read).not.toHaveBeenCalled();
  });
});
