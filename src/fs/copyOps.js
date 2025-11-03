import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import pLimit from "p-limit";
import { appendJournal } from "./journal.js";

const DEFAULT_STRATEGY = (process.env.COPY_STRATEGY || "auto").toLowerCase();
const DEFAULT_CONCURRENCY = Number(process.env.COPY_CONCURRENCY || 8);
const limiter = pLimit(Math.max(1, DEFAULT_CONCURRENCY));

function now() {
  return Date.now();
}

async function pathDevice(p) {
  try {
    const st = await fs.stat(p);
    return st.dev;
  } catch {
    return null;
  }
}

async function detectFsType(p) {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execa("stat", ["-f", "%T", p]);
    return stdout.trim().toLowerCase();
  } catch {
    return null;
  }
}

async function ensureDir(p, mode) {
  await fs.mkdir(p, { recursive: true, mode });
}

function tmpPath(dest) {
  const base = `${dest}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  return base;
}

async function hardlinkFile(src, dest) {
  try {
    await fs.link(src, dest);
    return "hardlink";
  } catch (err) {
    if (err?.code === "EXDEV" || err?.code === "EPERM" || err?.code === "EACCES") {
      throw Object.assign(new Error("hardlink unsupported"), { code: err.code });
    }
    throw err;
  }
}

const here = fileURLToPath(new URL(".", import.meta.url));

async function cloneFileDarwin(src, dest) {
  const helper = path.resolve(here, "../../bin/apfs-clone");
  try {
    await execa(helper, [src, dest], { stdio: "ignore" });
    return "clone";
  } catch (err) {
    if (err?.exitCode === 18 || err?.exitCode === 45 || err?.exitCode === 66) {
      const copyFlags = ["-c", "-p", "--", src, dest];
      try {
        await execa("cp", copyFlags, { stdio: "ignore" });
        return "clone";
      } catch (err2) {
        if (err2?.exitCode === 18 || err2?.exitCode === 45 || err2?.exitCode === 66) {
          throw Object.assign(new Error("clone unsupported"), { code: "ENOTSUP" });
        }
        throw err2;
      }
    }
    if (err?.code === "ENOENT" || err?.exitCode === 127) {
      // helper missing -> fall back to cp -c
      try {
        await execa("cp", ["-c", "-p", "--", src, dest], { stdio: "ignore" });
        return "clone";
      } catch (err3) {
        throw err3;
      }
    }
    if (err?.exitCode === 18 || err?.exitCode === 45) {
      throw Object.assign(new Error("clone unsupported"), { code: "ENOTSUP" });
    }
    throw err;
  }
}

async function copyByteForByte(src, dest) {
  if (process.platform === "darwin") {
    try {
      await execa("cp", ["-p", "--", src, dest], { stdio: "ignore" });
      return "copy";
    } catch (err) {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    }
  }
  if (process.platform === "linux") {
    try {
      await execa("cp", ["-a", "--", src, dest], { stdio: "ignore" });
      return "copy";
    } catch (err) {
      if (err?.code !== "ENOENT") {
        throw err;
      }
    }
  }
  await fs.copyFile(src, dest);
  const st = await fs.stat(src);
  await fs.utimes(dest, st.atime, st.mtime).catch(() => {});
  await fs.chmod(dest, st.mode).catch(() => {});
  return "copy";
}

async function ensureCleanDest(dest) {
  try {
    await fs.rm(dest, { force: true });
  } catch {}
}

async function materializeFile(src, dest, strategy, opts = {}) {
  const start = now();
  const lstat = await fs.lstat(src);
  if (lstat.isSymbolicLink()) {
    const target = await fs.readlink(src);
    await ensureDir(path.dirname(dest));
    try {
      await fs.symlink(target, dest);
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
    }
    const elapsed = now() - start;
    await appendJournal({
      op: "copy",
      from: src,
      to: dest,
      mode: "symlink",
      bytes: 0,
      ms: elapsed,
    });
    return { mode: "symlink", bytes: 0, ms: elapsed };
  }
  if (!lstat.isFile()) {
    const elapsed = now() - start;
    await appendJournal({
      op: "copy",
      from: src,
      to: dest,
      mode: "skip",
      bytes: 0,
      ms: elapsed,
    });
    return { mode: "skip", bytes: 0, ms: elapsed };
  }

  const resolvedStrategy = (strategy || DEFAULT_STRATEGY).toLowerCase();
  const attempts = [];
  if (resolvedStrategy === "move") {
    await ensureDir(path.dirname(dest));
    await ensureCleanDest(dest);
    await fs.rename(src, dest);
    const elapsed = now() - start;
    const bytes = lstat.size;
    await appendJournal({ op: "move", from: src, to: dest, mode: "move", bytes, ms: elapsed });
    return { mode: "move", bytes, ms: elapsed };
  }
  if (resolvedStrategy === "clone") {
    attempts.push("clone");
  } else if (resolvedStrategy === "hardlink") {
    attempts.push("hardlink");
  } else if (resolvedStrategy === "copy") {
    attempts.push("copy");
  } else {
    attempts.push("clone", "hardlink", "copy");
  }

  await ensureDir(path.dirname(dest));
  const destExists = await fs
    .stat(dest)
    .then(() => true)
    .catch((err) => (err?.code === "ENOENT" ? false : Promise.reject(err)));
  if (destExists) {
    const dstStat = await fs.stat(dest);
    if (dstStat.size === lstat.size && dstStat.mtimeMs >= lstat.mtimeMs) {
      const elapsed = now() - start;
      await appendJournal({
        op: "copy",
        from: src,
        to: dest,
        mode: "skip-exists",
        bytes: lstat.size,
        ms: elapsed,
      });
      return { mode: "skip-exists", bytes: lstat.size, ms: elapsed };
    }
    await ensureCleanDest(dest);
  }

  const srcDev = lstat.dev;
  const dstParent = path.dirname(dest);
  const dstDev = await pathDevice(dstParent);
  const sameDevice = dstDev != null && dstDev === srcDev;
  const fsType = sameDevice ? await detectFsType(dstParent) : null;

  for (const mode of attempts) {
    try {
      const temp = tmpPath(dest);
      await ensureCleanDest(temp);
      if (mode === "clone") {
        if (process.platform === "darwin" && sameDevice && fsType === "apfs") {
          await cloneFileDarwin(src, temp);
          await fs.rename(temp, dest);
          const elapsed = now() - start;
          const bytes = lstat.size;
          await appendJournal({ op: "copy", from: src, to: dest, mode: "clone", bytes, ms: elapsed });
          return { mode: "clone", bytes, ms: elapsed };
        }
        if (process.platform !== "darwin" && sameDevice) {
          try {
            await execa("cp", ["--reflink=auto", "--preserve=all", "--", src, temp], {
              stdio: "ignore",
            });
            await fs.rename(temp, dest);
            const elapsed = now() - start;
            const bytes = lstat.size;
            await appendJournal({ op: "copy", from: src, to: dest, mode: "clone", bytes, ms: elapsed });
            return { mode: "clone", bytes, ms: elapsed };
          } catch (err) {
            if (err?.exitCode === 1) {
              await fs.rm(temp, { force: true }).catch(() => {});
              continue;
            }
            throw err;
          }
        }
      } else if (mode === "hardlink") {
        if (!sameDevice) {
          continue;
        }
        await hardlinkFile(src, temp);
        await fs.rename(temp, dest).catch(async (err) => {
          if (err?.code === "EXDEV") throw err;
          throw err;
        });
        const elapsed = now() - start;
        const bytes = lstat.size;
        await appendJournal({ op: "copy", from: src, to: dest, mode: "hardlink", bytes, ms: elapsed });
        return { mode: "hardlink", bytes, ms: elapsed };
      } else if (mode === "copy") {
        const bytes = lstat.size;
        await copyByteForByte(src, temp);
        await fs.rename(temp, dest);
        const elapsed = now() - start;
        await appendJournal({ op: "copy", from: src, to: dest, mode: "copy", bytes, ms: elapsed });
        return { mode: "copy", bytes, ms: elapsed };
      }
      await fs.rm(temp, { force: true }).catch(() => {});
    } catch (err) {
      if (mode === "clone" && (err?.code === "ENOTSUP" || err?.code === "EXDEV")) {
        continue;
      }
      if (mode === "hardlink" && err?.code === "EXDEV") {
        continue;
      }
      throw err;
    }
  }
  const fallback = await copyByteForByte(src, dest);
  const elapsed = now() - start;
  await appendJournal({ op: "copy", from: src, to: dest, mode: fallback, bytes: lstat.size, ms: elapsed });
  return { mode: fallback, bytes: lstat.size, ms: elapsed };
}

export async function copyFile(src, dest, strategy = DEFAULT_STRATEGY, opts = {}) {
  return limiter(() => materializeFile(src, dest, strategy, opts));
}

export async function copyTree(srcDir, destDir, strategy = DEFAULT_STRATEGY, opts = {}) {
  const start = now();
  const summary = { clone: 0, hardlink: 0, copy: 0, move: 0, skipped: 0, bytes: 0 };
  const duBefore = await getDiskUsage(destDir);
  await ensureDir(destDir);
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      const st = await fs.stat(from).catch(() => null);
      await ensureDir(to, st?.mode);
      const nested = await copyTree(from, to, strategy, opts);
      for (const key of ["clone", "hardlink", "copy", "move", "skipped"]) {
        summary[key] = (summary[key] || 0) + (nested?.[key] || 0);
      }
      summary.bytes += nested?.bytes || 0;
      continue;
    }
    const result = await copyFile(from, to, strategy, opts);
    if (result.mode === "clone" || result.mode === "hardlink" || result.mode === "copy" || result.mode === "move") {
      summary[result.mode] = (summary[result.mode] || 0) + 1;
      summary.bytes += result.bytes || 0;
    } else {
      summary.skipped += 1;
    }
  }
  const elapsed = now() - start;
  const duAfter = await getDiskUsage(destDir);
  const delta = duAfter != null && duBefore != null ? duAfter - duBefore : null;
  console.log(
    `📦  copyTree ${srcDir} → ${destDir} in ${elapsed}ms (clone=${summary.clone} hardlink=${summary.hardlink} copy=${summary.copy} bytes=${summary.bytes}${
      delta != null ? ` du_delta_kb=${delta}` : ""
    })`
  );
  return { ...summary, ms: elapsed, duDeltaKb: delta };
}

async function getDiskUsage(dir) {
  try {
    const { stdout } = await execa("du", ["-sk", dir]);
    const [value] = stdout.trim().split(/\s+/);
    return Number(value);
  } catch {
    return null;
  }
}
