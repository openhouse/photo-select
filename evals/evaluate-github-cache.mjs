// Validate saved live evidence separately from deterministic transport fixtures.
export function evaluateGithubCacheCanary(receipt,actualHashes={}) {
 const failures=[];
 if(receipt?.status!=='passed'||receipt.requested!==3||receipt.completed!==3)failures.push('live-completion');
 const usages=receipt?.usages||[];
 if(usages.length!==3||new Set(usages.map(u=>u.key)).size!==1||!usages.every(u=>u.githubToolCalled===true&&u.curationStatus==='completed'&&u.requiredCachedTokens>0&&u.inputTokens>=u.cachedTokens+u.writeTokens))failures.push('usage-evidence');
 for(const role of ['seed','probe','reader']){
  const rows=usages.filter(u=>u.role===role);
  if(rows.length!==1||(role==='seed'?!(rows[0].writeTokens>=rows[0].requiredCachedTokens):!(rows[0].verified===true&&rows[0].cachedTokens>=rows[0].requiredCachedTokens)))failures.push(role+'-evidence');
 }
 const hashes=receipt?.implementationSha256;
 if(!hashes||!Object.keys(hashes).length||Object.entries(hashes).some(([file,hash])=>!/^[a-f0-9]{64}$/.test(hash)||actualHashes[file]!==hash))failures.push('implementation-changed');
 return failures;
}
