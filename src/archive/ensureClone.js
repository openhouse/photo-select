import { stat, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { cloneIfMissing } from "../fsx.js";

function fingerprint(stats) {
  return { size: stats.size, mtimeMs: stats.mtimeMs };
}

function sameFingerprint(a, b) {
  return !!a && !!b && a.size === b.size && a.mtimeMs === b.mtimeMs;
}

async function safeStat(p) {
  try {
    return await stat(p);
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function ensureClone(
  src,
  dest,
  { manifest, root, update = true, force = false, on } = {}
) {
  const rel = root ? path.relative(root, dest) : dest;
  await mkdir(path.dirname(dest), { recursive: true });
  const srcStats = await stat(src);
  const fp = fingerprint(srcStats);

  if (force) {
    await unlink(dest).catch(() => {});
  }

  if (update && !force && manifest) {
    const prior = manifest.get(rel);
    if (sameFingerprint(prior, fp)) {
      const destStats = await safeStat(dest);
      if (destStats && sameFingerprint(fp, fingerprint(destStats))) {
        manifest.set(rel, fp);
        on?.skipped?.(rel, { reason: "manifest" });
        return "skipped";
      }
    }
  }

  if (!update && !force) {
    await unlink(dest).catch(() => {});
  }

  const result = await cloneIfMissing(src, dest);

  if (result.status === "skipped") {
    manifest?.set(rel, fp);
    on?.skipped?.(rel, { reason: "dest-exists" });
    return "skipped";
  }

  if (result.status === "updated") {
    manifest?.set(rel, fp);
    on?.refreshed?.(rel, { mode: result.mode });
    return "refreshed";
  }

  if (result.status === "cloned" || result.status === "copied") {
    manifest?.set(rel, fp);
    const mode = result.status === "cloned" ? "clone" : "copy";
    on?.created?.(rel, { mode });
    return "created";
  }

  manifest?.set(rel, fp);
  return "created";
}

export default ensureClone;
