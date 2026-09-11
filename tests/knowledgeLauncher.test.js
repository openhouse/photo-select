import {it,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
it('routes only --github-all to the configured checkout and preserves image cwd, arguments, and heap setting',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'knowledge-launcher-'));const primary=path.join(root,'primary'),feature=path.join(root,'feature'),images=path.join(root,'images with spaces'),bin=path.join(root,'bin');
 try {
  for(const dir of [primary,feature,images,bin])await fs.mkdir(dir);
  for(const dir of [primary,feature])await fs.copyFile('photo-select-here.sh',path.join(dir,'photo-select-here.sh'));
  await fs.writeFile(path.join(bin,'git'),'#!/bin/sh\ncase "$*" in *config*) echo "$TEST_FEATURE";; *rev-parse*) echo "$TEST_COMMON";; esac\n',{mode:0o755});
  await fs.writeFile(path.join(bin,'node'),'#!/bin/sh\nprintf "%s\\n" "$PWD" "$NODE_OPTIONS" "$@" > "$TEST_CAPTURE"\n',{mode:0o755});
  await fs.writeFile(path.join(bin,'npx'),'#!/bin/sh\nexit 88\n',{mode:0o755});
  const capture=path.join(root,'capture'),env={...process.env,PATH:bin+':'+process.env.PATH,NVM_DIR:path.join(root,'absent-nvm'),TEST_FEATURE:feature,TEST_COMMON:primary,TEST_CAPTURE:capture,PHOTO_SELECT_MAX_OLD_SPACE_MB:'32768'};
  const args=['--github-all','--provider','openai-batch','--model','gpt-5.6-terra','--reasoning-effort','high','--workers','20','--verbose','--curators','Prof. Margaret Morse, MM Bakhtin','--context','/some project/overview.txt'];
  await exec('bash',[path.join(primary,'photo-select-here.sh'),...args],{cwd:images,env});
  const lines=(await fs.readFile(capture,'utf8')).trim().split('\n');
  expect(lines[0]).toBe(feature);expect(lines[1]).toContain('--max-old-space-size=32768');
  expect(lines.slice(2)).toEqual([path.join(feature,'src/index.js'),...args,'--dir',await fs.realpath(images)]);
  await exec('bash',[path.join(primary,'photo-select-here.sh'),'--help'],{cwd:images,env});
  expect((await fs.readFile(capture,'utf8')).split('\n')[2]).toBe(path.join(primary,'src/index.js'));
 } finally {await fs.rm(root,{recursive:true,force:true});}
});
