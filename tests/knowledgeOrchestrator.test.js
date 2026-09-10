import {it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
vi.hoisted(()=>{process.env.OPENAI_API_KEY='test';});
vi.mock('../src/chatClient.js',async()=>({...await vi.importActual('../src/chatClient.js'),getPeople:vi.fn(async()=>{throw new Error('unexpected people lookup');}),prefetchPeople:vi.fn(async()=>{throw new Error('unexpected prefetch');})}));
import {triageDirectory} from '../src/orchestrator.js';
import {LiveKnowledgeProvider} from '../src/providers/knowledge.js';
import {CURATORS} from '../src/core/knowledgeLive.js';
import {getPeople,prefetchPeople} from '../src/chatClient.js';
function driver(valid=true){
 const context={id:'receipt',records:[{id:'source-1',text:'A recorded countervoice'}]};
 return new LiveKnowledgeProvider({context,assertCurrent:async()=>{},encodeImage:async()=>Buffer.from('fixture'),save:vi.fn(),respond:async()=>({output_text:JSON.stringify({minutes:CURATORS.flatMap(speaker=>[{speaker,text:'A qualified reading [source-1]. What comes next?'},{speaker,text:'What remains uncertain [source-1]?'}]),decisions:[{filename:valid?'a.jpg':'invented.jpg',decision:'keep',reason:'A contrast [source-1]'}]})})});
}
it('runs the real selection path with fixed voices and the live evidence',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-orchestrator-'));
 try {await fs.writeFile(path.join(root,'a.jpg'),'fixture');const provider=driver();
  await triageDirectory({dir:root,provider,recurse:false,model:'gpt-4o'});
  expect(await fs.readFile(path.join(root,'_keep','a.jpg'),'utf8')).toBe('fixture');
  expect(provider.save).toHaveBeenCalledTimes(1);expect(getPeople).not.toHaveBeenCalled();expect(prefetchPeople).not.toHaveBeenCalled();
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
it('stops the real selection path with inputs unmoved after live validation fails',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-orchestrator-'));
 try {await fs.writeFile(path.join(root,'a.jpg'),'fixture');
  await expect(triageDirectory({dir:root,provider:driver(false),recurse:false,model:'gpt-4o'})).rejects.toThrow();
  expect(await fs.readFile(path.join(root,'a.jpg'),'utf8')).toBe('fixture');
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
