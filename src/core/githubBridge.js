export const GITHUB_MCP_URL='https://api.githubcopilot.com/mcp/readonly';
export const GITHUB_READ_TOOLS=Object.freeze(['get_me','search_repositories','search_code','get_file_contents','list_branches','list_commits','get_commit','list_tags','get_tag','search_issues','issue_read','search_pull_requests','pull_request_read']);
export function credentialLike(value){return /(?:github_pat_[\w]+|gh[pousr]_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY)/.test(typeof value==='string'?value:JSON.stringify(value));}
export function forbiddenCredentialPath(value){
  if(typeof value!=='string')return true;
  let decoded=value.replaceAll('\\','/');
  try{for(let i=0;i<4;i++){const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next;}}catch{return true;}
  return /%(?:2e|2f|5c)|(?:^|\/)(?:\.\.(?:\/|$)|\.env(?:[./]|$)|secrets?(?:[./]|$)|credentials?(?:[./]|$)|id_(?:rsa|ed25519)(?:[./]|$))|\.(?:pem|key|p12)$/i.test(decoded);
}
export function readableGithubResult(result){
  if(!Array.isArray(result?.content))throw new Error('Invalid GitHub tool result.');
  if(result.isError)throw new Error('GitHub tool reported failure.');
  const content=result.content.map(block=>{
    if(block.type==='text'&&typeof block.text==='string')return block;
    if(block.type==='resource'&&typeof block.resource?.text==='string')return {type:'text',text:JSON.stringify({source:block.resource.uri,text:block.resource.text})};
    throw new Error('Unsupported GitHub source block.');
  });
  if(credentialLike(content))throw new Error('Credential-like source held.');
  return {...result,content:[{type:'text',text:content.map(block=>block.text).join('\n\n')}]};
}
export function allowedGithubTools(tools){
  if(!Array.isArray(tools))throw new Error('Invalid GitHub tool catalog.');
  return tools.filter(tool=>GITHUB_READ_TOOLS.includes(tool.name)&&tool.annotations?.readOnlyHint===true);
}
export function githubCallAllowed(message){
  if(!message||message.jsonrpc!=='2.0'||!['tools/list','tools/call'].includes(message.method))return false;
  if(message.method==='tools/list')return true;
  const params=message.params,args=params?.arguments??{};
  return GITHUB_READ_TOOLS.includes(params?.name)&&args&&typeof args==='object'&&!Array.isArray(args)&&
    !(params.name==='get_file_contents'&&args.path!==undefined&&forbiddenCredentialPath(args.path));
}
