import fs from "node:fs/promises";
import path from "node:path";
import { SUPPORTED_EXTENSIONS } from "./config.js";

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

/** Ensure sub‑directories exist and move each file accordingly. */
export async function moveFiles(files, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  await Promise.all(
    files.map(async (file) => {
      const dest = path.join(targetDir, path.basename(file));
      await fs.rename(file, dest);
    })
  );
}
