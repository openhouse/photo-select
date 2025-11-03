<<<<<<< HEAD
import { promises as fs, constants as FS_CONSTANTS } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import { OperationJournal } from "./journal.js";

const DEFAULT_STRATEGY = (process.env.COPY_STRATEGY || "auto").toLowerCase();
const CLONE_MODES = new Set(["clone", "clonefile", "cp-clone", "reflink"]);

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

async function statfsSafe(p) {
  if (!fs.statfs) return null;
  try {
    return await fs.statfs(p);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

function randomSuffix() {
  return crypto.randomBytes(6).toString("hex");
}

async function findHelper() {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const candidates = [
    path.resolve("bin/apfs-clone"),
    path.resolve(process.cwd(), "bin/apfs-clone"),
    path.resolve(here, "../../bin/apfs-clone"),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function tryClone(src, tmp) {
  if (os.platform() !== "darwin") return null;
  const helper = await findHelper();
  if (helper) {
    try {
      await execa(helper, [src, tmp]);
      return { mode: "clone", via: "clonefile" };
    } catch (err) {
      if (err?.errno === "EXDEV" || err?.code === "EXDEV" || err?.exitCode === 18) {
        return null;
      }
      if (err?.errno === "ENOTSUP" || err?.code === "ENOTSUP") {
        // fall through to cp -c
      } else {
        // other errors propagate to allow fallback attempts
      }
    }
  }
  try {
    await execa("cp", ["-c", "-p", "--", src, tmp]);
    return { mode: "clone", via: "cp-c" };
  } catch (err) {
    if (err?.stderr && /Operation not supported/i.test(err.stderr)) {
      return null;
    }
    if (err?.exitCode === 77 || err?.exitCode === 95) {
      return null;
    }
    // treat all other errors as hard failure to signal fallback
=======
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
>>>>>>> 0ae3a4d44102f9c967930a22cba4020805285663
    return null;
  }
}

<<<<<<< HEAD
async function tryLinuxReflink(src, tmp) {
  if (os.platform() !== "linux") return null;
  try {
    await execa("cp", ["--reflink=auto", "--preserve=xattr,timestamps,mode", "--", src, tmp]);
    return { mode: "clone", via: "reflink" };
  } catch (err) {
    if (err?.stderr && /reflink/i.test(err.stderr)) {
      return null;
    }
=======
async function detectFsType(p) {
  if (process.platform !== "darwin") return null;
  try {
    const { stdout } = await execa("stat", ["-f", "%T", p]);
    return stdout.trim().toLowerCase();
  } catch {
>>>>>>> 0ae3a4d44102f9c967930a22cba4020805285663
    return null;
  }
}

<<<<<<< HEAD
async function tryHardlink(src, tmp) {
  try {
    await fs.link(src, tmp);
    return { mode: "hardlink", via: "link" };
  } catch (err) {
    if (err?.code === "EXDEV" || err?.code === "EPERM" || err?.code === "EACCES") {
      return null;
    }
    if (err?.code === "EMLINK" || err?.code === "EEXIST") {
      return null;
=======
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
>>>>>>> 0ae3a4d44102f9c967930a22cba4020805285663
    }
    throw err;
  }
}

<<<<<<< HEAD
async function tryCopy(src, tmp) {
  if (os.platform() === "darwin") {
    try {
      await execa("cp", ["-p", "--", src, tmp]);
      return { mode: "copy", via: "cp" };
    } catch (err) {
      // fall through to fs.copyFile
    }
  }
  await fs.copyFile(src, tmp, FS_CONSTANTS.COPYFILE_FICLONE);
  return { mode: "copy", via: "node" };
}

async function tryMove(src, tmp) {
  try {
    await fs.rename(src, tmp);
    return { mode: "move", via: "rename" };
  } catch (err) {
    if (err?.code === "EXDEV") return null;
=======
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
>>>>>>> 0ae3a4d44102f9c967930a22cba4020805285663
    throw err;
  }
}

<<<<<<< HEAD
function resolveStrategy(strategy, sameDevice) {
  const list = [];
  switch (strategy) {
    case "clone":
      list.push("clone", "copy");
      break;
    case "hardlink":
      list.push("hardlink", "copy");
      break;
    case "move":
      list.push("move", "clone", "hardlink", "copy");
      break;
    case "copy":
      list.push("copy");
      break;
    case "auto":
    default:
      if (sameDevice) {
        list.push("clone", "hardlink", "copy");
      } else {
        list.push("clone", "copy");
      }
      break;
  }
  return list;
}

function buildEntry({
  src,
  dst,
  mode,
  ms,
  bytes,
  strategy,
  ok = true,
  error,
  via,
}) {
  const entry = {
    op: "copy",
    from: src,
    to: dst,
    mode,
    bytes,
    ms: Math.round(ms),
    strategy,
    ok,
  };
  if (via) entry.via = via;
  if (error) {
    entry.error = error;
  }
  return entry;
}

async function setXattrHint(dst, key, value) {
  if (process.platform !== "darwin") return;
  if (!value) return;
  try {
    await execa("xattr", ["-w", key, value, dst]);
  } catch {
    // ignore xattr failures; not all filesystems support it
  }
}

/**
 * Copy a single file with clone/hardlink fallbacks.
 * @param {string} src
 * @param {string} dst
 * @param {"auto"|"clone"|"hardlink"|"copy"|"move"} [strategy]
 * @param {{
 *   dryRun?: boolean,
 *   requireClone?: boolean,
 *   journal?: OperationJournal,
 *   emitLog?: (entry: any) => void,
 * }} [options]
 */
export async function copyFile(src, dst, strategy = DEFAULT_STRATEGY, options = {}) {
  const { dryRun = false, requireClone = false, journal, emitLog } = options;
  const start = performance.now();
  const srcStat = await fs.stat(src, { bigint: true });
  const bytes = Number(srcStat.size);
  const dstDir = path.dirname(dst);
  await fs.mkdir(dstDir, { recursive: true });
  const dstDirStat = await fs.stat(dstDir, { bigint: true });
  const sameDevice = srcStat.dev === dstDirStat.dev;
  const strategies = resolveStrategy(strategy, sameDevice);
  const tmp = `${dst}.${Date.now()}-${randomSuffix()}`;

  if (dryRun) {
    const entry = buildEntry({
      src,
      dst,
      mode: strategies[0] || strategy,
      ms: 0,
      bytes,
      strategy,
    });
    if (emitLog) emitLog(entry);
    if (journal) await journal.record({ ...entry, dst, ok: true, dryRun: true });
    return entry;
  }

  if (await exists(dst)) {
    const entry = buildEntry({ src, dst, mode: "skip", ms: 0, bytes, strategy });
    if (emitLog) emitLog(entry);
    if (journal) await journal.record({ ...entry, dst, ok: true, reason: "exists" });
    return entry;
  }

  const statfs = await statfsSafe(src);
  const isApfs = Boolean(statfs?.type && statfs?.type === 0x42534653);
  let result = null;
  let lastError = null;

  for (const step of strategies) {
    try {
      let attemptResult = null;
      switch (step) {
        case "clone":
          attemptResult = (await tryClone(src, tmp)) || (await tryLinuxReflink(src, tmp));
          if (!attemptResult) break;
          break;
        case "hardlink":
          attemptResult = await tryHardlink(src, tmp);
          if (!attemptResult) break;
          break;
        case "copy":
          attemptResult = await tryCopy(src, tmp);
          break;
        case "move":
          attemptResult = await tryMove(src, tmp);
          if (!attemptResult) break;
          break;
        default:
          break;
      }
      if (!attemptResult) {
        continue;
      }
      await fs.rename(tmp, dst);
      result = attemptResult;
      break;
    } catch (err) {
      lastError = err;
      try {
        await fs.unlink(tmp);
      } catch {}
    }
  }

  if (!result) {
    if (lastError) throw lastError;
    throw new Error(`Failed to copy ${src} -> ${dst}`);
  }

  const via = result.via;
  await setXattrHint(dst, "com.openhouse.clone-mode", result.mode);
  await setXattrHint(dst, "com.openhouse.src-path", src);
  await setXattrHint(
    dst,
    "com.openhouse.src-hash",
    crypto.createHash("sha256").update(src, "utf8").digest("hex")
  );
  if (isApfs && CLONE_MODES.has(result.mode) && !requireClone) {
    await setXattrHint(dst, "com.apple.decmpfs", "preserve");
  }
  const ms = performance.now() - start;
  const entry = buildEntry({
    src,
    dst,
    mode: result.mode,
    ms,
    bytes,
    strategy,
    via,
  });

  if (requireClone && !CLONE_MODES.has(result.mode)) {
    entry.ok = false;
    entry.error = "clone-required";
    if (emitLog) emitLog(entry);
    if (journal) await journal.record({ ...entry, dst, ok: false });
    throw new Error(`Clone required but ${result.mode} used for ${dst}`);
  }

  if (emitLog) emitLog(entry);
  if (journal) await journal.record({ ...entry, dst, ok: true });
  return entry;
}

function createLimiter(limit) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (queue.length === 0) return;
    if (active >= limit) return;
    const { fn, resolve, reject } = queue.shift();
    active++;
    fn()
      .then((value) => {
        active--;
        resolve(value);
        next();
      })
      .catch((err) => {
        active--;
        reject(err);
        next();
      });
  };
  return function limitFn(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

async function du(pathname) {
  try {
    const { stdout } = await execa("du", ["-sk", pathname]);
    const value = parseInt(stdout.split(/\s+/)[0], 10);
    return Number.isFinite(value) ? value : null;
=======
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
>>>>>>> 0ae3a4d44102f9c967930a22cba4020805285663
  } catch {
    return null;
  }
}
<<<<<<< HEAD

async function copyDirectoryMetadata(src, dst) {
  const st = await fs.stat(src);
  await fs.chmod(dst, st.mode);
  await fs.utimes(dst, st.atime, st.mtime);
}

async function handleSymlink(src, dst) {
  const target = await fs.readlink(src);
  await fs.symlink(target, dst);
}

/**
 * Recursively copy a tree, preserving metadata.
 * @param {string} srcDir
 * @param {string} dstDir
 * @param {"auto"|"clone"|"hardlink"|"copy"|"move"} [strategy]
 * @param {{
 *   dryRun?: boolean,
 *   requireClone?: boolean,
 *   concurrency?: number,
 *   journal?: OperationJournal,
 *   emitLog?: (entry: any) => void,
 * }} [options]
 */
export async function copyTree(
  srcDir,
  dstDir,
  strategy = DEFAULT_STRATEGY,
  options = {}
) {
  const {
    dryRun = false,
    requireClone = false,
    concurrency = 8,
    journal,
    emitLog,
  } = options;
  const limit = createLimiter(Math.max(1, concurrency));
  const results = [];
  const tasks = [];
  const started = performance.now();

  const beforeDu = dryRun ? null : await du(dstDir);
  const walk = async (currentSrc, currentDst) => {
    const stat = await fs.lstat(currentSrc);
    if (stat.isSymbolicLink()) {
      if (!dryRun) {
        await fs.mkdir(path.dirname(currentDst), { recursive: true });
        await handleSymlink(currentSrc, currentDst);
        if (emitLog) {
          emitLog({
            op: "copy",
            from: currentSrc,
            to: currentDst,
            mode: "symlink",
            bytes: 0,
            ms: 0,
            strategy,
            ok: true,
          });
        }
        if (journal) {
          await journal.record({
            op: "copy",
            src: currentSrc,
            dst: currentDst,
            mode: "symlink",
            bytes: 0,
            ms: 0,
            ok: true,
          });
        }
      }
      return;
    }
    if (stat.isDirectory()) {
      if (!dryRun) {
        await fs.mkdir(currentDst, { recursive: true });
        await copyDirectoryMetadata(currentSrc, currentDst);
      }
      const entries = await fs.readdir(currentSrc);
      for (const entry of entries) {
        await walk(path.join(currentSrc, entry), path.join(currentDst, entry));
      }
      return;
    }
    if (!stat.isFile()) {
      if (emitLog) {
        emitLog({
          op: "copy",
          from: currentSrc,
          to: currentDst,
          mode: "skip",
          bytes: 0,
          ms: 0,
          strategy,
          ok: false,
          error: "unsupported",
        });
      }
      if (journal) {
        await journal.record({
          op: "copy",
          src: currentSrc,
          dst: currentDst,
          mode: "skip",
          bytes: 0,
          ms: 0,
          ok: false,
          error: "unsupported",
        });
      }
      return;
    }
    const task = limit(async () => {
      const entry = await copyFile(currentSrc, currentDst, strategy, {
        dryRun,
        requireClone,
        journal,
        emitLog,
      });
      results.push(entry);
      return entry;
    });
    tasks.push(task);
  };

  await walk(srcDir, dstDir);
  await Promise.all(tasks);
  const elapsed = performance.now() - started;
  const afterDu = dryRun ? null : await du(dstDir);
  const counts = results.reduce(
    (acc, entry) => {
      const { mode } = entry;
      acc.total += 1;
      if (!acc[mode]) acc[mode] = 0;
      acc[mode] += 1;
      acc.bytes += entry.bytes || 0;
      return acc;
    },
    { total: 0, bytes: 0 }
  );
  return {
    entries: results,
    counts,
    ms: elapsed,
    duDelta: afterDu != null && beforeDu != null ? afterDu - beforeDu : null,
  };
}

export function parseStrategy(input) {
  if (!input) return DEFAULT_STRATEGY;
  const normalized = input.toLowerCase();
  if (["auto", "clone", "hardlink", "copy", "move"].includes(normalized)) {
    return normalized;
  }
  return DEFAULT_STRATEGY;
}

export function summarizeCopy(entries) {
  const summary = {
    clone: 0,
    hardlink: 0,
    copy: 0,
    move: 0,
    skip: 0,
    totalBytes: 0,
  };
  for (const entry of entries) {
    const mode = entry.mode;
    if (summary[mode] != null) {
      summary[mode] += 1;
    }
    summary.totalBytes += entry.bytes || 0;
  }
  return summary;
}

export function formatSummary(summary) {
  const parts = [];
  if (summary.clone) parts.push(`cloned ${summary.clone}`);
  if (summary.hardlink) parts.push(`hardlinked ${summary.hardlink}`);
  if (summary.copy) parts.push(`copied ${summary.copy}`);
  if (summary.move) parts.push(`moved ${summary.move}`);
  if (summary.skip) parts.push(`skipped ${summary.skip}`);
  return parts.length ? parts.join(", ") : "no files touched";
}

export { OperationJournal } from "./journal.js";
=======
>>>>>>> 0ae3a4d44102f9c967930a22cba4020805285663
