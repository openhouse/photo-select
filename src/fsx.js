import { mkdir, stat, copyFile } from "node:fs/promises";
import { constants as C } from "node:fs";
import path from "node:path";

const EPSILON_MS = Number(process.env.PHOTO_SELECT_CLONE_EPSILON_MS || 10);
const FALLBACK_CODES = new Set(["EINVAL", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "ERR_FS_COPYFILE_IMPL"]);

async function ensureParent(file) {
  await mkdir(path.dirname(file), { recursive: true });
}

async function safeStat(p) {
  try {
    return await stat(p);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function cloneIfMissing(src, dest) {
  await ensureParent(dest);
  try {
    await copyFile(src, dest, C.COPYFILE_FICLONE | C.COPYFILE_EXCL);
    return { status: "cloned", mode: "clone" };
  } catch (err) {
    if (err?.code === "EEXIST") {
      const [srcStats, destStats] = await Promise.all([stat(src), safeStat(dest)]);
      if (destStats && srcStats.size === destStats.size) {
        if (destStats.mtimeMs >= srcStats.mtimeMs - EPSILON_MS) {
          return { status: "skipped", mode: null };
        }
      }
      try {
        await copyFile(src, dest, C.COPYFILE_FICLONE);
        return { status: "updated", mode: "clone" };
      } catch (cloneErr) {
        if (!FALLBACK_CODES.has(cloneErr?.code)) {
          throw cloneErr;
        }
      }
      await copyFile(src, dest);
      return { status: "updated", mode: "copy" };
    }

    if (FALLBACK_CODES.has(err?.code)) {
      try {
        await copyFile(src, dest, C.COPYFILE_EXCL);
        return { status: "copied", mode: "copy" };
      } catch (fallbackErr) {
        if (fallbackErr?.code === "EEXIST") {
          return { status: "skipped", mode: null };
        }
        throw fallbackErr;
      }
    }

    throw err;
  }
}

export default cloneIfMissing;
