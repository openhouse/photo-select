import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
<<<<<<< HEAD
import { finished } from "node:stream/promises";

/**
 * Append-only operation journal with newline-delimited JSON entries.
 *
 * Each record must already be a plain object; a timestamp is injected if
 * missing. On construction the journal loads prior successful operations so
 * callers can skip work on resume without re-reading the entire file later.
 */
export class OperationJournal {
  /**
   * @param {string} filePath
   */
  constructor(filePath) {
    this.filePath = filePath;
    this._stream = null;
    this._index = new Map();
    this._loading = null;
  }

  async init() {
    if (this._stream) return;
    const dir = path.dirname(this.filePath);
    await fsp.mkdir(dir, { recursive: true });
    this._stream = fs.createWriteStream(this.filePath, {
      flags: "a",
      encoding: "utf8",
    });
    this._loading = this._primeIndex();
    await this._loading;
  }

  async _primeIndex() {
    try {
      const data = await fsp.readFile(this.filePath, "utf8");
      for (const line of data.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line);
          if (entry?.dst && entry?.ok) {
            this._index.set(entry.dst, entry);
          }
        } catch {
          // ignore corrupt lines but keep them in the journal for auditing
        }
      }
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
    }
  }

  /**
   * Returns a snapshot of successful destination paths.
   * @returns {Map<string, any>}
   */
  get index() {
    return this._index;
  }

  /**
   * Record an entry to the journal.
   * @param {object} payload
   */
  async record(payload) {
    if (!this._stream) {
      await this.init();
    }
    const entry = { ...payload };
    if (!entry.t) entry.t = new Date().toISOString();
    if (entry.ok && entry.dst) {
      this._index.set(entry.dst, entry);
    }
    this._stream.write(JSON.stringify(entry) + "\n");
  }

  async close() {
    if (!this._stream) return;
    this._stream.end();
    await finished(this._stream);
    this._stream = null;
  }
}

export async function withJournal(filePath, fn) {
  const journal = new OperationJournal(filePath);
  await journal.init();
  try {
    return await fn(journal);
  } finally {
    await journal.close();
  }
}
=======

const JOURNAL_PATH = process.env.PHOTO_SELECT_JOURNAL_PATH ||
  path.resolve(process.cwd(), "data/journal.ndjson");

function ensureDirSync(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

let stream;
let pending = 0;

function getStream() {
  if (!stream) {
    ensureDirSync(JOURNAL_PATH);
    stream = fs.createWriteStream(JOURNAL_PATH, { flags: "a" });
    stream.on("error", (err) => {
      console.warn(`⚠️  journal write failed: ${err?.message || err}`);
    });
  }
  return stream;
}

export async function appendJournal(entry) {
  try {
    const out = JSON.stringify(entry);
    const s = getStream();
    pending++;
    await new Promise((resolve, reject) => {
      s.write(out + "\n", (err) => {
        pending--;
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (err) {
    console.warn(`⚠️  Failed to append journal entry: ${err?.message || err}`);
  }
}

export async function flushJournal() {
  const s = stream;
  if (!s) return;
  await new Promise((resolve) => {
    if (pending === 0) return resolve();
    const onDrain = () => {
      if (pending === 0) {
        s.off("drain", onDrain);
        resolve();
      }
    };
    s.on("drain", onDrain);
    onDrain();
  });
  await fsp.fsync?.(s.fd).catch(() => {});
}

export function getJournalPath() {
  return JOURNAL_PATH;
}
>>>>>>> 0ae3a4d44102f9c967930a22cba4020805285663
