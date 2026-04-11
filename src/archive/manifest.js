import fs from "node:fs";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, rename, writeFile, rm } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";

function lineToRecord(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

export class Manifest {
  constructor(root, file = ".ps-manifest.jsonl") {
    this.root = root;
    this.file = path.join(root, file);
    this.map = new Map();
    this._buffer = [];
    this._loaded = false;
  }

  get size() {
    return this.map.size;
  }

  async load() {
    if (this._loaded) return;
    this._loaded = true;
    if (!fs.existsSync(this.file)) return;
    const rl = readline.createInterface({
      input: createReadStream(this.file),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      const rec = lineToRecord(line);
      if (rec && rec.rel) {
        this.map.set(rec.rel, { size: rec.size, mtimeMs: rec.mtimeMs });
      }
    }
  }

  clear() {
    this.map.clear();
    this._buffer.length = 0;
    this._loaded = true;
  }

  get(rel) {
    return this.map.get(rel);
  }

  set(rel, fp) {
    if (!rel) return;
    this.map.set(rel, { size: fp.size, mtimeMs: fp.mtimeMs });
    this._buffer.push(JSON.stringify({ rel, ...fp }) + "\n");
  }

  async flush() {
    if (!this._buffer.length) return;
    await mkdir(this.root, { recursive: true });
    await appendFile(this.file, this._buffer.join(""));
    this._buffer.length = 0;
  }

  async writeSnapshot(target = ".manifest.json") {
    await mkdir(this.root, { recursive: true });
    const out = path.join(this.root, target);
    const tmp = `${out}.tmp`;
    const payload = Object.fromEntries(this.map.entries());
    await writeFile(tmp, JSON.stringify(payload, null, 2));
    await rename(tmp, out);
  }

  async removeFiles() {
    await rm(this.file, { force: true }).catch(() => {});
    const snapshot = path.join(this.root, ".manifest.json");
    await rm(snapshot, { force: true }).catch(() => {});
  }
}

export default Manifest;
