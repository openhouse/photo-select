#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

async function sha(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

async function main() {
  const db = new Database('prompts.sqlite');
  db.exec(`CREATE TABLE IF NOT EXISTS levels(id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT, created TEXT);`);
  db.exec(`CREATE TABLE IF NOT EXISTS prompts(level_id INTEGER, ts TEXT, text TEXT, sha256 TEXT);`);
  db.exec(`CREATE TABLE IF NOT EXISTS replies(level_id INTEGER, ts TEXT, text TEXT, sha256 TEXT);`);

  const entries = await fs.readdir('.', { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory() || !/^_level-\d+/.test(ent.name)) continue;
    const levelPath = path.resolve(ent.name);
    const stat = await fs.stat(levelPath);
    const info = db.prepare('INSERT INTO levels(path, created) VALUES (?, ?)').run(levelPath, stat.birthtime.toISOString());
    const id = info.lastInsertRowid;
    for (const kind of ['prompts', 'replies']) {
      const dir = path.join(levelPath, kind);
      let files = [];
      try { files = await fs.readdir(dir); } catch { continue; }
      for (const file of files) {
        const p = path.join(dir, file);
        const text = await fs.readFile(p, 'utf8');
        db.prepare(`INSERT INTO ${kind}(level_id, ts, text, sha256) VALUES (?,?,?,?)`).run(id, file.replace(/[^0-9]/g, ''), text, sha(text));
      }
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
