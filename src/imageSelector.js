import fs from "node:fs/promises";
import path from "node:path";
import { SUPPORTED_EXTENSIONS } from "./config.js";
import {
  copyFile as copyFileWithStrategy,
  parseStrategy,
  summarizeCopy,
  formatSummary,
} from "./fs/copyOps.js";

function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const runNext = () => {
    if (active >= limit) return;
    const item = queue.shift();
    if (!item) return;
    active++;
    item
      .fn()
      .then((value) => {
        active--;
        item.resolve(value);
        runNext();
      })
      .catch((err) => {
        active--;
        item.reject(err);
        runNext();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      runNext();
    });
}

/** Return full paths of images in `dir` (non‑recursive). */
async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

async function alreadyMaterialized(dir, name) {
  const keepDest = path.join(dir, "_keep", name);
  const asideDest = path.join(dir, "_aside", name);
  if (await fileExists(keepDest)) return true;
  if (await fileExists(asideDest)) return true;
  return false;
}

export async function listImages(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    if (await alreadyMaterialized(dir, entry.name)) {
      continue;
    }
    files.push(path.join(dir, entry.name));
  }
  files.sort();
  return files;
}

/** Pick up to `count` random items from the array. */
export function pickRandom(array, count) {
  const shuffled = array.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, array.length));
}

/** Ensure sub‑directories exist and move each file accordingly. */
export async function moveFiles(files, targetDir, notes = new Map(), options = {}) {
  if (!files.length) return { entries: [], summary: null };
  const {
    strategy = parseStrategy(options.strategy || process.env.COPY_STRATEGY),
    dryRun = false,
    requireClone = false,
    journal,
    emitLog,
    concurrency = Number(options.concurrency || process.env.PHOTO_SELECT_MATERIALIZE_CONCURRENCY) || 8,
  } = options;
  await fs.mkdir(targetDir, { recursive: true });
  const limit = createLimiter(Math.max(1, concurrency));
  const results = [];

  const tasks = files.map((file) =>
    limit(async () => {
      const dest = path.join(targetDir, path.basename(file));
      if (
        journal?.index?.has(dest) &&
        (await fs.stat(dest).then(() => true).catch(() => false))
      ) {
        const entry = {
          op: "copy",
          from: file,
          to: dest,
          mode: "skip",
          bytes: 0,
          ms: 0,
          strategy,
          ok: true,
          reason: "journal",
        };
        if (emitLog) emitLog(entry);
        if (journal) {
          await journal.record({
            ...entry,
            dst: dest,
            ok: true,
          });
        }
        results.push(entry);
        return entry;
      }
      const entry = await copyFileWithStrategy(file, dest, strategy, {
        dryRun,
        requireClone,
        journal,
        emitLog,
      });
      if (process.env.PHOTO_SELECT_DEBUG_MATERIALIZE === "1") {
        console.log("[materialize]", file, "->", dest, entry.mode);
      }
      results.push(entry);
      const note = notes.get(file);
      if (note && !dryRun) {
        const txt = dest.replace(/\.[^.]+$/, ".txt");
        await fs.writeFile(txt, note, "utf8");
      }
      return entry;
    })
  );

  await Promise.all(tasks);
  const summary = summarizeCopy(results);
  return { entries: results, summary, message: formatSummary(summary) };
}
