import fs from "node:fs";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, writeFile, rm, stat } from "node:fs/promises";
import readline from "node:readline";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

export class StageTracker {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, ".staged.jsonl");
    this.runFile = path.join(root, ".run.json");
    this.okFile = path.join(root, ".ok");
    this.completed = new Set();
    this._buffer = [];
    this.counters = { cloned: 0, copied: 0, skipped: 0, updated: 0, failed: 0 };
    this.queued = 0;
    this.startedAt = null;
    this.updatedAt = null;
  }

  async hasOk() {
    try {
      const st = await stat(this.okFile);
      return st.isFile();
    } catch (err) {
      if (err?.code === "ENOENT") return false;
      throw err;
    }
  }

  async load() {
    if (fs.existsSync(this.runFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.runFile, "utf8"));
        this.counters = {
          cloned: data.cloned || 0,
          copied: data.copied || 0,
          skipped: data.skipped || 0,
          updated: data.updated || 0,
          failed: data.failed || 0,
        };
        this.queued = data.queued || 0;
        this.startedAt = data.startedAt || null;
        this.updatedAt = data.updatedAt || null;
      } catch {
        // ignore corrupted run file; will be rewritten
      }
    }
    if (!fs.existsSync(this.file)) return;
    const rl = readline.createInterface({
      input: createReadStream(this.file),
      crlfDelay: Infinity,
    });
    for await (const line of rl) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        if (rec?.dest) {
          const rel = path.relative(this.root, rec.dest);
          this.completed.add(rel);
        }
      } catch {
        // ignore malformed entries
      }
    }
  }

  recordCompletion({ src, dest, status, mode }) {
    const rel = path.relative(this.root, dest);
    this.completed.add(rel);
    if (status === "refreshed") {
      this.counters.updated++;
    } else if (mode === "copy") {
      this.counters.copied++;
    } else {
      this.counters.cloned++;
    }
    const rec = {
      src,
      dest,
      mode: mode === "copy" ? "copied" : "cloned",
      status,
    };
    this._buffer.push(JSON.stringify(rec) + "\n");
  }

  recordSkip() {
    this.counters.skipped++;
  }

  recordFailure() {
    this.counters.failed++;
  }

  incrementQueued() {
    this.queued++;
  }

  async flush() {
    if (!this._buffer.length) return;
    await mkdir(this.root, { recursive: true });
    await appendFile(this.file, this._buffer.join(""));
    this._buffer.length = 0;
  }

  async updateRunFile() {
    if (!this.startedAt) this.startedAt = nowIso();
    this.updatedAt = nowIso();
    const payload = {
      queued: this.queued,
      cloned: this.counters.cloned,
      copied: this.counters.copied,
      skipped: this.counters.skipped,
      updated: this.counters.updated,
      failed: this.counters.failed,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
    };
    await mkdir(this.root, { recursive: true });
    await writeFile(this.runFile, JSON.stringify(payload, null, 2));
  }

  async markComplete() {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.okFile, "", "utf8");
  }

  async reset() {
    this.completed.clear();
    this._buffer.length = 0;
    this.counters = { cloned: 0, copied: 0, skipped: 0, updated: 0, failed: 0 };
    this.queued = 0;
    this.startedAt = null;
    this.updatedAt = null;
    await rm(this.file, { force: true }).catch(() => {});
    await rm(this.runFile, { force: true }).catch(() => {});
    await rm(this.okFile, { force: true }).catch(() => {});
  }
}

export default StageTracker;
