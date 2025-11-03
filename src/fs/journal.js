import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";

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
