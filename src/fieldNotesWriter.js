import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function stripHeader(text) {
  return text.replace(/^(?:created:.*\n)?(?:updated:.*\n)?\n?/, '');
}

function readHeader(text) {
  const match = text.match(/^created:\s*(.+)$/m);
  return match ? match[1].trim() : new Date().toISOString();
}

export default class FieldNotesWriter {
  constructor(file) {
    this.file = file;
  }

  async read() {
    try {
      const txt = await fs.readFile(this.file, 'utf8');
      return stripHeader(txt);
    } catch {
      return '';
    }
  }

  async init() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      await fs.stat(this.file);
    } catch {
      const ts = new Date().toISOString();
      await fs.writeFile(this.file, `created: ${ts}\n\n`);
    }
  }

  autolink(text) {
    const exts = '(?:jpg|jpeg|png|gif|tif|tiff|heic|heif)';
    const re = new RegExp(`(?<![\\[(])([\\w.-]+\\.${exts})`, 'gi');
    return text.replace(re, '[$1](./$1)');
  }

  async writeFull(markdown) {
    await this.init();
    const existing = await fs.readFile(this.file, 'utf8').catch(() => '');
    const created = readHeader(existing);
    const ts = new Date().toISOString();
    const body = this.autolink(markdown.trim()) + '\n';
    const header = `created: ${created}\nupdated: ${ts}\n\n`;
    await fs.writeFile(this.file, header + body, 'utf8');
  }

  async applyDiff(diffText) {
    await this.init();
    const old = await this.read();
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fn-'));
    const oldPath = path.join(dir, 'old.md');
    const patchPath = path.join(dir, 'patch.diff');
    await fs.writeFile(oldPath, old);
    await fs.writeFile(patchPath, diffText);
    await exec('patch', [oldPath, patchPath], { cwd: dir });
    const updated = await fs.readFile(oldPath, 'utf8');
    await fs.rm(dir, { recursive: true, force: true });
    await this.writeFull(updated);
  }
}

