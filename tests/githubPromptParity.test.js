import {afterEach,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {buildPrompt,DEFAULT_PROMPT_PATH} from '../src/templates.js';
import {GithubCurationProvider} from '../src/providers/github.js';
import {repairGithubRequest} from '../src/core/githubPromptCache.js';
const tunnelId='tunnel_'+'a'.repeat(32),curators=['Base'];
const roots=[];afterEach(async()=>Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true}))));
const instructions=request=>request.instructions??request.input.filter(m=>m.role==='developer').flatMap(m=>m.content.map(c=>c.text)).join('');
const reply={status:'completed',output_text:JSON.stringify({minutes:[{speaker:'Base',text:'Visible form.'},{speaker:'Base',text:'What next?'}],decisions:[{filename:'a.jpg',decision:'aside',reason:'Uncertain.'}]})};
function fixture(brief=''){const calls=[];const provider=new GithubCurationProvider({tunnelId,curators,brief,respond:async request=>{calls.push(request);return reply;},encodeImage:async()=>Buffer.from('image')});return {calls,provider};}
async function render(context,options={}){const root=await fs.mkdtemp(path.join(os.tmpdir(),'github-prompt-parity-'));roots.push(root);const contextPath=path.join(root,'context.txt');await fs.writeFile(contextPath,context);return buildPrompt(options.file,{curators,images:['a.jpg'],contextPath,...options});}
it('passes the original rendered prompt unchanged while attaching authenticated read-only tools',async()=>{
 const brief='Project brief: https://github.com/colleague/private-repo',original=await render(brief),f=fixture(brief);
 await f.provider.chat({model:'gpt-5.5',images:['a.jpg'],prompt:original.prompt});
 const request=f.calls[0];expect(request.instructions).toBe(original.prompt);
 expect(request.tools[0]).toMatchObject({type:'mcp',server_label:'github',tunnel_id:tunnelId,require_approval:'never'});
 expect(request.tools[0]).not.toHaveProperty('authorization');
 expect(request.input[0].content[0]).toEqual({type:'input_text',text:'Here are the images:\nRespond in json format.'});
 expect(request.input[0].content[1]).toEqual({type:'input_text',text:'{"filename":"a.jpg"}'});
 expect(request.input[0].content[2].type).toBe('input_image');
});
it('uses the ordinary default template for direct callers and embeds their brief in it',async()=>{
 const f=fixture('A private photographic exhibition.');
 expect(f.provider.promptPath).toBe(DEFAULT_PROMPT_PATH);
 await f.provider.chat({model:'gpt-5.5',images:['a.jpg'],minutesMin:2,minutesMax:3});
 const original=await render('A private photographic exhibition.');expect(instructions(f.calls[0])).toBe(original.prompt);
});
it('preserves every rendered byte across a cache boundary without repeating the brief or adding GitHub directions',async()=>{
 const brief='Long unchanged project evidence.\n'.repeat(1500),original=await render(brief),f=fixture(brief);
 await f.provider.chat({model:'gpt-5.6-terra',images:['a.jpg'],...original});
 const request=f.calls[0];expect(instructions(request)).toBe(original.prompt);
 expect(request.input[0].role).toBe('developer');expect(request.input[0].content[0].text).toBe(original.promptCachePrefix);
 expect(request.input[0].content[0].prompt_cache_breakpoint).toEqual({mode:'explicit'});
 expect(request.prompt_cache_key).toMatch(/^photo-select:github-v3:/);
 expect(JSON.stringify(request).split('Long unchanged project evidence.')).toHaveLength(1501);
});
it('preserves an explicit custom prompt without adding the brief or forcing a cache boundary',async()=>{
 const f=fixture('Stored context not used by this custom prompt. '.repeat(300));
 const prompt='Choose photographs for a two-image diptych. Return the usual JSON.';
 await f.provider.chat({model:'gpt-5.6-terra',images:['a.jpg'],prompt});
 expect(f.calls[0].instructions).toBe(prompt);expect(f.calls[0].prompt_cache_key).toBeUndefined();
 expect(JSON.stringify(f.calls[0])).not.toContain('Stored context not used');
});
it('keeps original field-note and revision substitutions in a custom rendered request',async()=>{
 const original=await render('Brief',{hasFieldNotes:true,fieldNotes:'Current notes',isSecondPass:true,fieldNotesPrev:'Previous notes',fieldNotesPrev2:'Earlier notes',commitMessages:['Saved revision']}),f=fixture('Brief');
 await f.provider.chat({model:'gpt-5.5',images:['a.jpg'],prompt:original.prompt});
 expect(instructions(f.calls[0])).toBe(original.prompt);
 for(const text of ['Current notes','Previous notes','Earlier notes','Saved revision'])expect(instructions(f.calls[0])).toContain(text);
});
it('keeps the original cached instructions intact when a repair is required',async()=>{
 const brief='Long project brief.\n'.repeat(1500),original=await render(brief),f=fixture(brief);
 await f.provider.chat({model:'gpt-5.6-terra',images:['a.jpg'],...original});
 const request=f.calls[0],repaired=repairGithubRequest(request);
 expect(repaired.prompt_cache_key).toBe(request.prompt_cache_key);
 expect(repaired.input[0].content[0]).toEqual(request.input[0].content[0]);
 expect(instructions(repaired)).toBe(original.prompt+'\nRepair the previous invalid JSON/voice/filename result. Return a complete reply under the same schema.');
 expect(repaired.input.at(-1)).toEqual(request.input.at(-1));expect(repaired.tools).toEqual(request.tools);
});
it('does not hold an ordinary brief link merely because the model did not fetch it',async()=>{
 const calls=[];const provider=new GithubCurationProvider({tunnelId,curators,brief:'Project https://github.com/colleague/project',encodeImage:async()=>Buffer.from('image'),respond:async r=>{calls.push(r);return {...reply,output_text:JSON.stringify({minutes:[{speaker:'Base',text:'The supplied brief links to https://github.com/colleague/project. What next?'}],decisions:[{filename:'a.jpg',decision:'aside',reason:'Uncertain.'}]})};}});
 await expect(provider.chat({model:'gpt-5.5',images:['a.jpg']})).resolves.toHaveProperty('json');expect(calls).toHaveLength(1);
});
it('accepts the facilitator named by the original prompt under the ordinary free-text speaker schema',async()=>{
 const calls=[];const provider=new GithubCurationProvider({tunnelId,curators,encodeImage:async()=>Buffer.from('image'),respond:async r=>{calls.push(r);return {...reply,output_text:JSON.stringify({minutes:[{speaker:'Jamie',text:'What next?'}],decisions:[{filename:'a.jpg',decision:'aside',reason:'Uncertain.'}]})};}});
 await expect(provider.chat({model:'gpt-5.5',images:['a.jpg']})).resolves.toHaveProperty('json');
 expect(calls).toHaveLength(1);expect(calls[0].text.format.schema.properties.minutes.items.properties.speaker).toEqual({type:'string'});
});
it('does not replace an explicitly empty custom prompt with a default prompt',async()=>{
 const f=fixture('A brief intentionally omitted by the custom template.');
 await f.provider.chat({model:'gpt-5.5',images:['a.jpg'],prompt:''});
 expect(f.calls[0].instructions).toBe('');expect(JSON.stringify(f.calls[0])).not.toContain('intentionally omitted');
});
