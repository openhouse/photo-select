// Offline trace contract only. This does not authenticate, fetch, send, or curate.
// Hand-authored descriptors cannot establish application readiness or model quality.
const READ_TOOLS=new Set(['get_me','search_repositories','search_code','get_file_contents','list_branches','list_commits','get_commit','list_tags','get_tag','search_issues','issue_read','search_pull_requests','pull_request_read']);
const urls=text=>[...text.matchAll(/https:\/\/(?:github\.com|raw\.githubusercontent\.com)\/[^\s"')\]<>\\]+/g)].map(x=>x[0]);
const GATES=['implementation','exactCommand','privateGithubDuringCuration','batchWithImagesAndTools','credentialSinks','workers20','ci'];
export function evaluateGithubReadiness(gates={}){return GATES.filter(key=>gates[key]!=='passed');}
export function evaluateCurationExploration(trace) {
  const failures=new Set(),fail=code=>failures.add(code);
  if(!trace?.expected||!trace.request||!trace.response)return ['trace'];
  const {request,response,expected}=trace;
  if(trace.localResearchCalls!==0)fail('separate-research');
  if(trace.provider!==expected.provider)fail('provider');
  if(request.model!==expected.model)fail('model');
  if(trace.scope!=='credential-readable-repositories')fail('scope');
  if(trace.privateOutput!==true)fail('private-output');
  const tools=(request.tools||[]).filter(x=>x.type==='mcp'&&x.server_label==='github');
  if(!tools.length)fail('same-request-tools');
  for(const tool of tools){
    const transport=trace.transport==='private-tunnel'
      ? /^tunnel_[a-f0-9]{32}$/.test(tool.tunnel_id||'')&&!tool.server_url&&!tool.authorization&&trace.githubCredentialDestination==='github-only'&&trace.bridgeReadOnly===true
      : tool.server_url==='https://api.githubcopilot.com/mcp/readonly';
    if(!transport||!Array.isArray(tool.allowed_tools)||!tool.allowed_tools.length||tool.allowed_tools.some(t=>!READ_TOOLS.has(t)))fail('read-only');
  }
  const parts=(Array.isArray(request.input)?request.input:[]).flatMap(x=>Array.isArray(x.content)?x.content:[]);
  if(!parts.some(x=>x.type==='input_image'))fail('same-request-images');
  const input=JSON.stringify(request.input);
  if((trace.sourceBodies||[]).some(body=>input.includes(body)))fail('precollected-source');
  const stripped=trace.transport==='private-tunnel'?request:{...request,tools:(request.tools||[]).map(({authorization,...tool})=>tool)};
  const sinks=JSON.stringify([stripped,response,trace.artifacts]);
  if((trace.secrets||[]).some(secret=>secret&&sinks.includes(secret)))fail('credential-leak');
  if(trace.cleanup!=='deleted')fail('credential-retention');
  if(response.status!=='completed'||(response.output||[]).some(x=>x.type==='mcp_approval_request'))fail('response');
  const calls=(response.output||[]).filter(x=>x.type==='mcp_call'&&x.server_label==='github'&&!x.error&&READ_TOOLS.has(x.name));
  const evidence=calls.filter(x=>x.name==='get_file_contents').map(x=>x.output||'').join('\n');
  if(!trace.sourceBodies?.length||trace.sourceBodies.some(body=>typeof body!=='string'||!body||!evidence.includes(body)))fail('source-read');
  const returnedUrls=new Set(urls(evidence));
  if((trace.citationUrls||[]).some(url=>!returnedUrls.has(url)))fail('citation');
  try {
    const raw=(response.output||[]).filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
    const json=JSON.parse(raw);
    if(urls(raw).some(url=>!returnedUrls.has(url)))fail('citation');
    if(!Array.isArray(json.minutes)||!json.minutes.length||json.minutes.some(x=>!expected.curators.includes(x.speaker)))fail('curators');
    if(!Array.isArray(json.decisions)||json.decisions.length!==expected.filenames.length||new Set(json.decisions.map(d=>d.filename)).size!==expected.filenames.length||json.decisions.some(d=>!expected.filenames.includes(d.filename)||!['keep','aside'].includes(d.decision)))fail('decisions');
  }catch{fail('response');}
  return [...failures];
}
