import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises'; import path from 'node:path'; import os from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url'; import { execFile } from 'node:child_process'; import { promisify } from 'node:util'; import sharp from 'sharp';
const exec = promisify(execFile), roots = [], launcher = fileURLToPath(new URL('../photo-select-here.sh',import.meta.url));
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
it.each(['none','image','context','template','image-after-actII','image-no-diff'])('runs the real Xiaomi launcher with frozen inputs (mutation: %s)',async mutation=>{
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'xiaomi-launcher-')));roots.push(root);
  const source=path.join(root,'photos'),audit=path.join(root,'audit'),calls=path.join(root,'calls.jsonl'),preload=path.join(root,'fetch-preload.mjs'),contextPath=path.join(root,'brief.txt'),templatePath=path.join(root,'custom.hbs'),changedImage=path.join(root,'changed.jpg');await fs.mkdir(source);
  await fs.writeFile(templatePath,'Custom exhibition template.\n{{context}}\nCurators: {{curators}}\n{{#each images}}- {{this}}\n{{/each}}{{#if hasFieldNotes}}Notebook: {{fieldNotes}}{{/if}}');
  await sharp({create:{width:24,height:24,channels:3,background:'#cc2040'}}).jpeg().toFile(changedImage);
  const context='Full exhibition context, first paragraph.\nThe second paragraph must remain intact.\n'+ 'Photographic context. '.repeat(100);await fs.writeFile(contextPath,context);
  const curators=['Prof. Ingeborg Gerdes','Prof. Warren Sack','Yehuda Katz','Vivian Gornick','Zora Neale Hurston','Deborah Treisman','Curator 07 (artist)','Curator 08','Curator 09','Curator 10','Curator 11','Curator 12','Curator 13','Curator 14','Curator 15','Curator 16','Curator 17'];
  const jpeg=await sharp({create:{width:24,height:24,channels:3,background:'#807060'}}).jpeg().toBuffer();
  await Promise.all(Array.from({length:11},(_,index)=>fs.writeFile(path.join(source,`photo-${String(index).padStart(2,'0')}.jpg`),jpeg)));
  await fs.writeFile(preload,`import fs from 'node:fs/promises';import path from 'node:path';let mutated=false;
    globalThis.fetch=async(url,init)=>{
      if(url!=='https://api.xiaomimimo.com/v1/chat/completions'||init.headers.Authorization!=='Bearer synthetic-mimo-key')throw Error('Wrong credential destination');
      const request=JSON.parse(init.body),parts=request.messages[1].content,guard=parts.at(-1).text,prefix='Photo-Select current phase contract: ';
      const contract=JSON.parse(guard.slice(prefix.length,guard.indexOf('. Return only JSON'))),phase=contract.allowed_json_keys.includes('field_notes_md')?'actII':'triage';
      const json=phase==='actII'?{field_notes_md:'# Synthetic photographic notebook\\n\\nVisible sequencing remains open.'}:{minutes:Array.from({length:contract.schema.properties.minutes.minItems},(_,index)=>({speaker:contract.curators[index%contract.curators.length],text:'Visible framing gives the sequence a rhythm; what should follow?'})),decisions:contract.filenames.map(filename=>({filename,decision:Number(filename.match(/(\\d+)\\.jpg$/)[1])%2?'aside':'keep',reason:'Visible photographic evidence.'})),field_notes_diff:process.env.TEST_MUTATION==='image-no-diff'?'':'--- old\\n+++ new\\n@@ -0,0 +1 @@\\n+# Synthetic photographic notebook'};
      await fs.appendFile(process.env.TEST_CALLS,JSON.stringify({url,request,phase,filenames:contract.filenames,curators:contract.curators})+'\\n');
      const mutation=process.env.TEST_MUTATION;
      if(!mutated&&mutation!=='none'&&((mutation==='image-after-actII'&&phase==='actII')||(mutation!=='image-after-actII'&&phase==='triage'))){
        mutated=true;
        if(mutation.startsWith('image'))await fs.copyFile(process.env.TEST_CHANGED_IMAGE,path.join(process.env.TEST_SOURCE,contract.filenames[0]));
        if(mutation==='context')await fs.writeFile(process.env.TEST_CONTEXT,'A changed exhibition brief after triage.');
        if(mutation==='template')await fs.appendFile(process.env.TEST_TEMPLATE,'\\nChanged custom template after triage.');
      }
      return new Response(JSON.stringify({id:'synthetic-completion',object:'chat.completion',created:1,model:'mimo-v2.6-pro',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(json)},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120,prompt_tokens_details:{cached_tokens:0,cache_write_tokens:0,image_tokens:40},completion_tokens_details:{reasoning_tokens:5}}}),{status:200,headers:{'content-type':'application/json'}});
    };`);
  const env={...process.env,PATH:path.dirname(process.execPath)+':'+process.env.PATH,NVM_DIR:path.join(root,'absent-nvm'),DOTENV_CONFIG_PATH:path.join(root,'absent.env'),NODE_OPTIONS:'--import='+preload,NODE_NO_WARNINGS:'1',MIMO_API_KEY:'synthetic-mimo-key',MIMO_BASE_URL:'',OPENAI_API_KEY:'',DEEPINFRA_API_KEY:'',PHOTO_SELECT_HOSTED_BASE:audit,PHOTO_SELECT_DISABLE_PEOPLE:'1',PHOTO_SELECT_PROVIDER:'',PHOTO_SELECT_MODEL:'',PHOTO_SELECT_VERBOSITY:'',PHOTO_SELECT_REASONING_EFFORT:'',PHOTO_SELECT_ADAPTIVE_WORKERS:'0',PHOTO_SELECT_RETRY_NEEDS_REVIEW:'0',PHOTO_SELECT_DEBUG_DIR:root,TEST_CALLS:calls,TEST_MUTATION:mutation,TEST_SOURCE:source,TEST_CONTEXT:contextPath,TEST_TEMPLATE:templatePath,TEST_CHANGED_IMAGE:changedImage};
  const args=[launcher,'--provider','xiaomi','--model','mimo-v2.6-pro','--batch-size','10','--workers','1','--reasoning-effort','auto','--curators',curators.join(','),'--context',contextPath,'--field-notes','--target-level-size','10','--no-recurse','--disable-photo-filter'];if(mutation==='template')args.push('--prompt',templatePath);
  const result=await exec('bash',args,{cwd:source,env,timeout:25000,maxBuffer:2*1024*1024}).then(result=>({...result,code:0}),error=>error);
  if(mutation!=='none'){
    expect(result.code,result.stdout+result.stderr).toBe(1);
    const sent=(await fs.readFile(calls,'utf8')).trim().split('\n').map(JSON.parse);
    expect(sent.map(call=>call.phase)).toEqual(mutation==='image-after-actII'?['triage','actII']:['triage']);
    expect((await fs.readdir(source)).filter(name=>name.endsWith('.jpg'))).toHaveLength(11);
    await expect(fs.stat(path.join(source,'_keep'))).rejects.toThrow();await expect(fs.stat(path.join(source,'_aside'))).rejects.toThrow();
    return;
  }
  expect(result.code,result.stderr).toBe(0);
  expect(result.stdout).toContain('Finished triaging');
  const sent=(await fs.readFile(calls,'utf8')).trim().split('\n').map(JSON.parse);
  expect(sent.filter(call=>call.phase==='triage').map(call=>call.filenames.length)).toEqual([10,1]);
  expect(sent.filter(call=>call.phase==='actII').map(call=>call.filenames.length)).toEqual([10,1]);
  expect(sent).toHaveLength(4);
  for(const call of sent){expect(call.curators).toEqual(curators);expect(call.request.messages[0].content).toContain(context);expect(call.request.response_format).toEqual({type:'json_object'});expect(call.request.messages[1].content.filter(part=>part.type==='image_url')).toHaveLength(call.filenames.length);expect(call.request.messages[1].content.filter(part=>part.type==='image_url').every(part=>!Object.hasOwn(part.image_url,'detail'))).toBe(true);}
  expect((await fs.readdir(source)).filter(name=>name.endsWith('.jpg'))).toEqual([]);
  expect((await fs.readdir(path.join(source,'_keep'))).filter(name=>name.endsWith('.jpg'))).toHaveLength(6);
  expect((await fs.readdir(path.join(source,'_aside'))).filter(name=>name.endsWith('.jpg'))).toHaveLength(5);
  const archived=(await fs.readdir(path.join(source,'_level-001'))).filter(name=>name.endsWith('.jpg'));expect(archived).toHaveLength(11);expect((await fs.readFile(path.join(source,'_level-001',archived[0]))).equals(jpeg)).toBe(true);
  expect(await fs.readFile(path.join(source,'_level-001','field-notes.md'),'utf8')).toContain('# Synthetic photographic notebook');
  const names=await fs.readdir(audit);expect(names).toHaveLength(1);expect(names[0]).toMatch(/^xiaomi-source-/);const privateRoot=path.join(audit,names[0]);
  const receipts=await Promise.all((await fs.readdir(path.join(privateRoot,'requests'))).map(async name=>JSON.parse(await fs.readFile(path.join(privateRoot,'requests',name),'utf8'))));expect(receipts).toHaveLength(4);expect(receipts.every(receipt=>receipt.status==='completed'&&receipt.identity.provider==='xiaomi')).toBe(true);
  const sourceHash=createHash('sha256').update(jpeg).digest('hex');
  for(const receipt of receipts)expect(receipt.expectedSourceHashes).toEqual(receipt.originalImages.map(image=>({filename:image.filename,sha256:sourceHash})));
  const snapshots=await Promise.all((await fs.readdir(path.join(privateRoot,'workflows'))).map(async name=>JSON.parse(await fs.readFile(path.join(privateRoot,'workflows',name),'utf8'))));
  const frozenBatches=snapshots.filter(snapshot=>snapshot.inputBinding);expect(frozenBatches).toHaveLength(2);
  for(const snapshot of frozenBatches){expect(snapshot.inputBinding.contextText).toBe(context);expect(snapshot.inputBinding.contextSha256).toBe(createHash('sha256').update(context).digest('hex'));}
  expect((await exec('git',['-C',privateRoot,'status','--porcelain'])).stdout).toBe('');
},30000);
