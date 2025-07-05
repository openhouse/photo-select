#!/usr/bin/env node
import { execSync } from 'node:child_process';

try {
  const diff = execSync('git diff --cached --numstat -- "*field-notes.md"', { encoding: 'utf8' }).trim();
  if (!diff) process.exit(0);
  const [added, removed] = diff.split(/\s+/);
  if (Number(removed) > 0) {
    const patch = execSync('git diff --cached -- "*field-notes.md"', { encoding: 'utf8' });
    if (!patch.includes('{{obsolete}}')) {
      console.error('❌ field-notes.md deletions require {{obsolete}} tag');
      process.exit(1);
    }
  }
  console.log(`📚  +${added} lines of shared memory added`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
