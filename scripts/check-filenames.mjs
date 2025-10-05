#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const result = spawnSync('git', ['ls-files'], { encoding: 'utf8' });
if (result.status !== 0) {
  console.error('Failed to list repository files.');
  process.exit(result.status ?? 1);
}

const files = result.stdout.split('\n').filter(Boolean);
const violations = [];

const spaceBeforeJs = /(^|\/)[^\/\n]* \.js$/i;
const origSuffix = /\.orig$/i;

for (const file of files) {
  if (spaceBeforeJs.test(file) || origSuffix.test(file)) {
    violations.push(file);
  }
}

if (violations.length > 0) {
  console.error('Filename hygiene check failed. The following files must be renamed:');
  for (const file of violations) {
    console.error(`  - ${file}`);
  }
  console.error('\nDisallowed patterns: filenames ending in .orig or containing a space immediately before .js.');
  process.exit(1);
}
