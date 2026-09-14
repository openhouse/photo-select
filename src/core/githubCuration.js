import {finalizeCurators} from './finalizeCurators.js';
import {GITHUB_READ_TOOLS,credentialLike} from './githubBridge.js';
import {CURATORS,knowledgeError} from './knowledgeLive.js';
export function sessionCurators(names=[]) {
  const result=names.length?[...names]:[...CURATORS];
  if(new Set(result).size!==result.length||result.some(x=>typeof x!=='string'||!x.trim()||x.length>200))throw knowledgeError('Curator names must be nonempty and unique.');
  return Object.freeze(result);
}
// Preserve the base voices and freeze a separate roster for each concurrent batch.
export function curatorsForBatch(base,names) {
  const expected=finalizeCurators(base,[]).finalCurators;
  names=names??expected;
  if(!Array.isArray(names)||names.length<expected.length||expected.some((name,index)=>names[index]!==name))throw knowledgeError('A batch must preserve the base curator roster.');
  return sessionCurators(names);
}
export function githubTool(tunnelId) {
  if(!/^tunnel_[a-f0-9]{32}$/.test(tunnelId))throw knowledgeError('Configure the Photo Select GitHub tunnel first; see docs/live-knowledge.md.');
  return {type:'mcp',server_label:'github',tunnel_id:tunnelId,require_approval:'never',allowed_tools:[...GITHUB_READ_TOOLS]};
}
export function responseText(response) {
  return response.output_text??(response.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
}
const githubUrls=text=>[...text.matchAll(/https:\/\/(?:github\.com|raw\.githubusercontent\.com)\/[^\s"')\]<>\\]+/g)].map(x=>x[0].replace(/[.,;]+$/,''));
export function githubSources(output=[]) {
  return output.filter(x=>x.type==='mcp_call'&&x.server_label==='github'&&!x.error&&x.output&&!x.output?.isError).flatMap(call=>{
    let args;try{args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments||{};}catch{return [];}
    let result;try{result=JSON.parse(call.output);}catch{result=call.output;}
    if(result?.isError)return [];
    const urls=githubUrls(typeof call.output==='string'?call.output:JSON.stringify(call.output));
    const ref=args.sha||args.ref;
    if(call.name==='get_file_contents'&&args.owner&&args.repo&&args.path&&ref)urls.push(`https://github.com/${args.owner}/${args.repo}/blob/${ref}/${args.path}`);
    return [{tool:call.name,arguments:args,urls:[...new Set(urls)],ref:ref??null,commitPinned:/^[a-f0-9]{40}$/.test(ref||'')}];
  });
}
// Structured diagnostics stay in the private audit/repair payload; terminal
// errors contain only fixed codes, never model text or source filenames.
export function githubReplyIssues(reply,filenames) {
  const exact=(object,keys)=>object&&typeof object==='object'&&!Array.isArray(object)&&Object.keys(object).length===keys.length&&keys.every(k=>Object.hasOwn(object,k));
  const issues=[];
  if(!exact(reply,['minutes','decisions']))issues.push({code:'TOP_LEVEL_KEYS'});
  if(!Array.isArray(reply?.minutes)||!reply.minutes.length)issues.push({code:'MINUTES_ARRAY'});
  else {
    reply.minutes.forEach((m,index)=>{
      if(!exact(m,['speaker','text'])||typeof m.speaker!=='string'||!m.speaker.trim()||typeof m.text!=='string'||!m.text.trim())issues.push({code:'MINUTE_ENTRY',index});
    });
    if(typeof reply.minutes.at(-1)?.text==='string'&&!/\?\s*$/.test(reply.minutes.at(-1).text))issues.push({code:'FINAL_QUESTION'});
  }
  if(!Array.isArray(reply?.decisions))issues.push({code:'DECISIONS_ARRAY'});
  else {
    reply.decisions.forEach((d,index)=>{
      if(!exact(d,['filename','decision','reason'])||typeof d.filename!=='string'||!['keep','aside'].includes(d.decision)||typeof d.reason!=='string')issues.push({code:'DECISION_ENTRY',index});
    });
    const names=reply.decisions.map(d=>d?.filename).filter(n=>typeof n==='string');
    const missing=filenames.filter(n=>!names.includes(n)),unexpected=[...new Set(names.filter(n=>!filenames.includes(n)))];
    const duplicates=[...new Set(names.filter((n,i)=>names.indexOf(n)!==i))];
    if(reply.decisions.length!==filenames.length||missing.length||unexpected.length||duplicates.length)
      issues.push({code:'DECISION_FILENAMES',missing,unexpected,duplicates,expectedCount:filenames.length,actualCount:reply.decisions.length});
  }
  return issues;
}
export function validateGithubReply(reply,filenames) {
  if(credentialLike(reply))throw knowledgeError('Credential-like curation output held.');
  const issues=githubReplyIssues(reply,filenames);
  if(issues.length)throw Object.assign(knowledgeError(`Curation reply invalid (${[...new Set(issues.map(i=>i.code))].join(', ')}); see the private curation record.`),{issues});
  return true;
}

// Prompt length is a presentation target. Never discard complete, valid decisions
// or manufacture/truncate minutes solely to meet that target.
export function githubReplyWarnings(reply,{minutesMin,minutesMax}) {
  const actual=reply.minutes.length;
  return actual<minutesMin||actual>minutesMax?[{
    code:'MINUTES_COUNT_OUTSIDE_TARGET',actual,min:minutesMin,max:minutesMax,
    message:`${actual} minute entries; target ${minutesMin}–${minutesMax}. All minutes preserved; decisions accepted.`
  }]:[];
}
