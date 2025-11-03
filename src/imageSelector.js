import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execa } from "execa";
import { SUPPORTED_EXTENSIONS } from "./config.js";
import { copyFile as copyFileWithStrategy } from "./fs/copyOps.js";

/** Return full paths of images in `dir` (non‑recursive). */
export async function listImages(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter(
      (e) =>
        e.isFile() &&
        SUPPORTED_EXTENSIONS.includes(path.extname(e.name).toLowerCase())
    )
    .map((e) => path.join(dir, e.name))
    .sort();
}

/** Pick up to `count` random items from the array. */
export function pickRandom(array, count) {
  const shuffled = array.slice().sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, array.length));
}

/** Materialize files into the target directory using clone/hardlink/copy. */
export async function materializeFiles(
  files,
  targetDir,
  notes = new Map(),
  {
    strategy = process.env.COPY_STRATEGY || "auto",
    dryRun = false,
    apfsRequired = false,
  } = {}
) {
  if (!files.length) {
    return { counts: {}, files: [] };
  }
  await fs.mkdir(targetDir, { recursive: true });
  const counts = new Map();
  const results = [];
  for (const file of files) {
    const dest = path.join(targetDir, path.basename(file));
    if (dryRun) {
      counts.set("dry-run", (counts.get("dry-run") || 0) + 1);
      results.push({ from: file, to: dest, mode: "dry-run" });
      continue;
    }
    const result = await copyFileWithStrategy(file, dest, strategy);
    counts.set(result.mode, (counts.get(result.mode) || 0) + 1);
    results.push({ from: file, to: dest, mode: result.mode });
    if (apfsRequired && result.mode !== "clone") {
      throw new Error(`APFS clone required but fell back to ${result.mode} for ${file}`);
    }
    const note = notes.get(file);
    if (note) {
      const txt = dest.replace(/\.[^.]+$/, ".txt");
      await fs.writeFile(txt, note, "utf8");
    }
    await tagProvenance(file, dest, result.mode).catch(() => {});
  }
  return {
    counts: Object.fromEntries(counts),
    files: results,
  };
}

async function tagProvenance(src, dest, mode) {
  if (process.platform !== "darwin") return;
  const hash = crypto.createHash("sha256").update(src).digest("hex");
  await execa("xattr", ["-w", "com.openhouse.src-path", src, dest]);
  await execa("xattr", ["-w", "com.openhouse.src-hash", hash, dest]);
  await execa("xattr", ["-w", "com.openhouse.clone-mode", mode, dest]);
}
