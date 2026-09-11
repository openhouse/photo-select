// Validate saved live evidence separately from deterministic transport fixtures.
export function evaluateGithubCacheCanary(receipt,actualHashes={}) {
 const failures=[],flex=receipt?.schemaVersion===2,count=flex?4:3;
 if(flex&&(receipt.transport!=='flex'||!(receipt.context?.textTokens>=1024)))failures.push('flex-transport');
 if(receipt?.status!=='passed'||receipt.requested!==count||receipt.completed!==count)failures.push('live-completion');
 const usages=receipt?.usages||[];
 if(usages.length!==count||new Set(usages.map(u=>u.key)).size!==1||!usages.every(u=>(receipt.toolUseRequired===false?u.githubToolAvailable===true:u.githubToolCalled===true)&&u.curationStatus==='completed'&&u.requiredCachedTokens>0&&u.inputTokens>=u.cachedTokens+u.writeTokens))failures.push('usage-evidence');
 const hit=row=>row?.verified===true&&row.cachedTokens>=row.requiredCachedTokens;
 if(flex){
  const seed=usages[0],roles=usages.map(u=>u.role).join(',');
  if(seed?.role!=='seed'||!(hit(seed)||seed.writeTokens>=seed.requiredCachedTokens))failures.push('seed-evidence');
  // A warm first request can release readers without a separate probe. Writes
  // alone never satisfy any follow-up, including the last queued reader.
  const expected=hit(seed)?'seed,reader,reader,reader':'seed,probe,reader,reader';
  if(roles!==expected||!usages.slice(1).every(row=>hit(row)&&row.writeTokens===0))failures.push('reader-evidence');
  if(!usages.every(u=>u.serviceTier==='flex'&&u.requestedTier==='flex'&&u.fullBriefPreserved===true))failures.push('flex-read-evidence');
 }else{
  for(const role of ['seed','probe','reader']){
   const rows=usages.filter(u=>u.role===role);
   if(rows.length!==1||(role==='seed'?!(rows[0].writeTokens>=rows[0].requiredCachedTokens):!hit(rows[0])))failures.push(role+'-evidence');
  }
 }
 const hashes=receipt?.implementationSha256;
 if(!hashes||!Object.keys(hashes).length||Object.entries(hashes).some(([file,hash])=>!/^[a-f0-9]{64}$/.test(hash)||actualHashes[file]!==hash))failures.push('implementation-changed');
 return failures;
}
