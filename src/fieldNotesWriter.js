import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

async function atomicWrite(file, text) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.tmp-${crypto.randomUUID()}`);
  await fs.writeFile(tmp, text, 'utf8');
  await fs.rename(tmp, file);
}

function stripHeader(text) {
  return text.replace(/^##.*\n(?:created:.*\n)?(?:updated:.*\n)?\n?/, '');
}

function readHeader(text) {
  const match = text.match(/^created:\s*(.+)$/m);
  return match ? match[1].trim() : new Date().toISOString();
}

export default class FieldNotesWriter {
  constructor(file, level = '') {
    this.file = file;
    this.level = level;
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
      const header =
        (this.level ? `## Field Notes — Level ${this.level}\n` : '') +
        `created: ${ts}\n\n`;
      await atomicWrite(this.file, header);
    }
  }

  autolink(text) {
    const exts = '(?:jpg|jpeg|png|gif|tif|tiff|heic|heif)';
    const re = new RegExp(`(?<![\\[(])([\\w.-]+\\.${exts})`, 'gi');
    return text.replace(re, (m, name) => {
      const p = path.join(path.dirname(this.file), name);
      if (fsSync.existsSync(p)) return `[${name}](./${name})`;
      return m;
    });
  }

  async writeFull(markdown) {
    await this.init();
    const existing = await fs.readFile(this.file, 'utf8').catch(() => '');
    const created = readHeader(existing);
    const ts = new Date().toISOString();
    let body = this.autolink(markdown.trim());
    if ((body.match(/!\[/g) || []).length > 3) {
      body += '\n\n> **Warning**: Inline image limit exceeded.';
    }
    body += '\n';
    const header =
      (this.level ? `## Field Notes — Level ${this.level}\n` : '') +
      `created: ${created}\nupdated: ${ts}\n\n`;
    await atomicWrite(this.file, header + body);
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

