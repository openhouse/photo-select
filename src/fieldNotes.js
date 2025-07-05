import fs from 'node:fs/promises';
import path from 'node:path';
import { applyPatch } from 'diff';

export class FieldNotesWriter {
  constructor(file) {
    this.file = file;
  }

  async read() {
    try {
      return await fs.readFile(this.file, 'utf8');
    } catch {
      return null;
    }
  }

  async init() {
    const existing = await this.read();
    if (existing === null) {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const created = `<!-- created: ${new Date().toISOString()} -->\n`;
      await fs.writeFile(this.file, created, 'utf8');
    }
  }

  autolink(text) {
    const regex = /\[([^\]]+\.(?:jpg|jpeg|png|gif|tif|tiff|heic|heif))\](?!\()/gi;
    return text.replace(regex, (m, name) => `[${name}](./${name})`);
  }

  async writeFull(markdown) {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const existing = await this.read();
    let content = this.autolink(markdown.trim()) + '\n';
    if (existing === null) {
      const created = `<!-- created: ${new Date().toISOString()} -->`;
      content = `${created}\n${content}`;
    } else {
      const createdMatch = existing.match(/<!-- created: .*?-->/);
      const created = createdMatch ? createdMatch[0] + '\n' : '';
      const updates = (existing.match(/<!-- updated: .*?-->/g) || []).join('\n');
      const stamp = `<!-- updated: ${new Date().toISOString()} -->`;
      content = `${created}${content}${updates ? updates + '\n' : ''}${stamp}\n`;
    }
    await fs.writeFile(this.file, content, 'utf8');
  }

  async applyDiff(diffText) {
    const current = (await this.read()) || '';
    const patched = applyPatch(current, diffText, { fuzzFactor: 2 });
    if (patched === false) throw new Error('Failed to apply diff');
    await this.writeFull(patched);
  }
}
