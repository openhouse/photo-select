#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import FieldNotesWriter from '../src/fieldNotesWriter.js';

async function run() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: migrate-notes.js <file> [...]');
    process.exit(1);
  }
  for (const file of files) {
    const abs = path.resolve(file);
    const writer = new FieldNotesWriter(abs);
    const text = await fs.readFile(abs, 'utf8');
    await writer.writeFull(text);
    console.log(`Migrated ${file}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
