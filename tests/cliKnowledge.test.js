import { it,expect,vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
it('advertises one-flag automatic live knowledge and a discovery-only check',async()=>{
  const {stdout}=await exec(process.execPath,['src/index.js','--help']);
  expect(stdout).toContain('--knowledge-live [profile]');expect(stdout).toContain('--knowledge-discover');expect(stdout).toContain('--knowledge-brief <text>');
});
it('rejects incompatible batch mode before GitHub or OpenAI work',async()=>{
  await expect(exec(process.execPath,['src/index.js','--knowledge-live','--provider','openai-batch'],{env:{...process.env,OPENAI_API_KEY:'test'}})).rejects.toMatchObject({stderr:expect.stringContaining('requires --provider openai')});
});
