#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    const err = result.stderr?.trim() || result.error?.message;
    throw new Error(`Failed to run ${command} ${args.join(' ')}: ${err || 'unknown error'}`);
  }
  return result.stdout;
}

let files;
try {
  const stdout = run('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRT']);
  files = stdout.split('\n').map((f) => f.trim()).filter(Boolean);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

if (files.length === 0) {
  process.exit(0);
}

const conflictPattern = /(<<<<<<< |=======|>>>>>>> )/;
const offenders = [];

for (const file of files) {
  const show = spawnSync('git', ['show', `:${file}`], { encoding: 'utf8' });
  if (show.status !== 0) {
    // If the file is binary or otherwise unavailable, skip the conflict check.
    continue;
  }
  if (conflictPattern.test(show.stdout)) {
    offenders.push(file);
  }
}

if (offenders.length > 0) {
  console.error('Pre-commit aborted: conflict markers detected in staged files.');
  for (const file of offenders) {
    console.error(`  - ${file}`);
  }
  console.error('\nResolve the conflicts and restage the files.');
  process.exit(1);
}
