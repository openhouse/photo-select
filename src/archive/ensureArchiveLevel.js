import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { ensureClone } from "./ensureClone.js";
import { Manifest } from "./manifest.js";
import { StageTracker } from "./stageTracker.js";
import { SimpleSemaphore } from "../lib/semaphore.js";

const DEFAULT_PROGRESS_INTERVAL = 1000;
let didLogStrategy = false;

function ensureMetadataShield(levelDir) {
  const marker = path.join(levelDir, ".metadata_never_index");
  return writeFile(marker, "").catch(() => {});
}

function computeConcurrency({ cliValue }) {
  if (Number.isFinite(cliValue) && cliValue > 0) {
    return cliValue;
  }
  const envStage = Number(process.env.PHOTO_SELECT_STAGE_CONCURRENCY);
  if (Number.isFinite(envStage) && envStage > 0) return envStage;
  const envFs = Number(process.env.PHOTO_SELECT_FS_CONCURRENCY);
  if (Number.isFinite(envFs) && envFs > 0) return envFs;
  return 12;
}

export async function ensureArchiveLevel({
  levelDir,
  files,
  update = true,
  forceRebuild = false,
  stageConcurrency,
  verbose = false,
}) {
  const concurrency = computeConcurrency({ cliValue: stageConcurrency });
  if (!didLogStrategy) {
    const apfs = process.platform === "darwin" ? "yes" : "no";
    console.log(
      `staging: mode=clone-if-missing stage_concurrency=${concurrency} apfs_clone=${apfs}`
    );
    didLogStrategy = true;
  }

  await mkdir(levelDir, { recursive: true });
  await ensureMetadataShield(levelDir);

  const manifest = new Manifest(levelDir);
  const tracker = new StageTracker(levelDir);

  if (forceRebuild) {
    await tracker.reset();
    manifest.clear();
    await manifest.removeFiles();
  } else {
    // Even when .ok exists, load the append-only tracker/manifest before
    // deciding what to skip.  A level archive can be complete for the files
    // seen in an earlier pass while still needing to accept late arrivals.
    await manifest.load();
    await tracker.load();
  }

  const skipSet = new Set(tracker.completed);
  const counters = { created: 0, refreshed: 0, skipped: 0, errors: 0 };
  const failedFiles = [];
  const queue = new SimpleSemaphore(concurrency);
  const start = Date.now();
  let processed = 0;
  let flushed = 0;

  const levelName = path.basename(levelDir);
  if (verbose) {
    const remaining = Math.max(files.length - skipSet.size, 0);
    console.log(
      `${levelName} resume: cloned=${tracker.counters.cloned} copied=${tracker.counters.copied} skipped=${tracker.counters.skipped} failed=${tracker.counters.failed} remaining=${remaining}`
    );
  }

  const tasks = files.map(async (src) => {
    const dest = path.join(levelDir, path.basename(src));
    const rel = path.relative(levelDir, dest);
    tracker.incrementQueued();

    if (update && !forceRebuild && skipSet.has(rel)) {
      counters.skipped++;
      tracker.recordSkip();
      processed++;
      if (processed % DEFAULT_PROGRESS_INTERVAL === 0 && verbose) {
        console.log(
          `archive progress: level=${levelName} processed=${processed}/${files.length}`
        );
      }
      if (processed - flushed >= 250) {
        flushed = processed;
        await tracker.updateRunFile();
      }
      return;
    }

    await queue.run(async () => {
      try {
        const outcome = await ensureClone(src, dest, {
          manifest: update ? manifest : undefined,
          root: levelDir,
          update,
          force: forceRebuild || !update,
          on: {
            created: (_, info) => {
              counters.created++;
              tracker.recordCompletion({
                src,
                dest,
                status: "created",
                mode: info?.mode === "copy" ? "copy" : "clone",
              });
            },
            refreshed: (_, info) => {
              counters.refreshed++;
              tracker.recordCompletion({
                src,
                dest,
                status: "refreshed",
                mode: info?.mode === "copy" ? "copy" : "clone",
              });
            },
            skipped: () => {
              counters.skipped++;
              tracker.recordSkip();
            },
          },
        });
        if (outcome === "skipped") {
          skipSet.add(rel);
        }
      } catch (err) {
        counters.errors++;
        tracker.recordFailure();
        if (verbose) {
          console.warn(`archive: failed to stage ${src}: ${err.message}`);
        }
        failedFiles.push({ src, error: err });
      } finally {
        processed++;
        if (processed % DEFAULT_PROGRESS_INTERVAL === 0 && verbose) {
          console.log(
            `archive progress: level=${levelName} processed=${processed}/${files.length}`
          );
        }
        if (processed - flushed >= 250) {
          flushed = processed;
          await Promise.all([tracker.flush(), manifest.flush(), tracker.updateRunFile()]);
        }
      }
    });
  });

  await Promise.all(tasks);
  await tracker.flush();
  await manifest.flush();
  await tracker.updateRunFile();

  if (counters.errors === 0) {
    await tracker.markComplete();
  }

  const elapsed = Date.now() - start;
  console.log(
    `archive: created=${counters.created} refreshed=${counters.refreshed} skipped=${counters.skipped} errors=${counters.errors} elapsed=${Math.round(
      elapsed / 1000
    )}s`
  );

  await manifest.writeSnapshot().catch(() => {});

  return { ...counters, failed: failedFiles.map((f) => f.src) };
}

export default ensureArchiveLevel;
