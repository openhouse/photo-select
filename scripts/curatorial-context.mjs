import {readFile} from 'node:fs/promises';
import {exportCuratorialContext} from './lib/curatorialContext.mjs';
const [packet,profilePath,output]=process.argv.slice(2);
try{
  if(!packet||!profilePath||!output)throw new Error('Usage: node scripts/curatorial-context.mjs packet-directory private-profile.json new-context.md');
  const r=await exportCuratorialContext(packet,JSON.parse(await readFile(profilePath,'utf8')),output);
  console.log(JSON.stringify({status:r.status,sha256:r.sha256,bytes:r.bytes,decodedTextTokens:r.decodedTextTokens,inputGuard:r.inputGuard,coverage:r.coverage,retrievalPassed:r.retrievalPassed,modelRequests:r.modelRequests},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
