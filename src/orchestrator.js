import path from "node:path";
import { readFile, writeFile, mkdir, stat, copyFile } from "node:fs/promises";
import { batchStore } from "./batchContext.js";
import crypto from "node:crypto";
import { readPrompt, delay } from "./config.js";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { parseReply } from "./chatClient.js";
import { MultiBar, Presets } from "cli-progress";

function extractJsonBlock(body) {
  if (!body) return null;
  let s = String(body).trim();
  const fenced = s.match(/^```\w*\n([\s\S]*?)\n```$/);
  if (fenced) s = fenced[1];
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function useColor() {
  return process.stdout.isTTY && process.env.NO_COLOR !== '1';
}
function color(s, code) {
  return useColor() ? `\x1b[${code}m${s}\x1b[0m` : s;
}
const dim = (s) => color(s, 2),
  green = (s) => color(s, 32),
  yellow = (s) => color(s, 33);

function prettyLLMReply(raw, opts = {}) {
  const json = extractJsonBlock(raw);
  if (!json) {
    try {
      return JSON.stringify(JSON.parse(String(raw)), null, 2);
    } catch {
      return String(raw);
    }
  }
  const maxMinutes = Number(
    process.env.PHOTO_SELECT_PRETTY_MINUTES || 20
  );
  let out = '';

  if (Array.isArray(json.minutes)) {
    out += `${dim('— Minutes —')}\n`;
    const shown = json.minutes.slice(0, maxMinutes);
    for (const m of shown) {
      if (m && typeof m === 'object') {
        const who = (m.speaker ?? 'Curator').toString();
        const txt = (m.text ?? '').toString();
        out += `  • ${who}: ${txt}\n`;
      }
    }
    if (json.minutes.length > shown.length) {
      out += dim(`  … +${json.minutes.length - shown.length} more\n`);
    }
  }

  if (Array.isArray(json.decisions)) {
    const keeps = json.decisions.filter(
      (d) => d && d.decision === 'keep'
    );
    const asides = json.decisions.filter(
      (d) => d && d.decision === 'aside'
    );
    out += `${dim('— Decisions —')} ${keeps.length} keep / ${asides.length} aside\n`;
    for (const d of keeps)
      out += `  ${green('KEEP')}  ${d.filename}${
        d.reason ? ` — ${d.reason}` : ''
      }\n`;
    for (const d of asides)
      out += `  ${yellow('ASIDE')} ${d.filename}${
        d.reason ? ` — ${d.reason}` : ''
      }\n`;
  } else {
    out += JSON.stringify(json, null, 2) + '\n';
  }
  return out.trimEnd();
}

function formatDuration(ms) {
  const sec = Math.round(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Recursively triage images until the current directory is empty
 * or contains only _keep/_aside folders.
 *
 * @param {Object} options
 * @param {string} options.dir    Directory of images to triage
 * @param {string} options.promptPath   Path to the base prompt
 * @param {Object} options.provider     Chat provider instance
 * @param {string} options.model        Model id for the provider
 * @param {boolean} [options.recurse=true]  Whether to descend into _keep folders
 * @param {string[]} [options.curators=[]]   Names inserted into the prompt
 * @param {string} [options.contextPath]     Optional additional context file
 * @param {number} [options.parallel=1]      Number of API requests to run simultaneously
 * @param {number} [options.workers]         Number of worker processes for dynamic batches
 * @param {string} [options.verbosity]       Verbosity level for GPT-5 models
 * @param {string} [options.reasoningEffort] Reasoning effort for GPT-5 models
 * @param {number} [options.depth=0]         Internal recursion depth (for logging)
*/
export async function triageDirectory({
  dir,
  promptPath,
  provider,
  model,
  recurse = true,
  curators = [],
  contextPath,
  parallel = 1,
  workers,
  verbosity,
  reasoningEffort,
  depth = 0,
}) {
  if (!provider) {
    const m = await import('./providers/openai.js');
    provider = new m.default();
  }
  const indent = "  ".repeat(depth);
  let prompt = await readPrompt(promptPath);
  if (contextPath) {
    try {
      const context = await readFile(contextPath, 'utf8');
      prompt += `\n\nCurator FYI:\n${context}`;
    } catch (err) {
      console.warn(`Could not read context file ${contextPath}: ${err.message}`);
    }
  }

  console.log(`${indent}📁  Scanning ${dir}`);

  // Archive original images at this level
  const levelDir = path.join(dir, `_level-${String(depth + 1).padStart(3, '0')}`);
  const initImages = await listImages(dir);
  const levelStart = Date.now();
  const totalImages = initImages.length;
  try {
    await stat(levelDir);
  } catch {
    if (initImages.length) {
      await mkdir(levelDir, { recursive: true });
      const failedArchives = [];
      const copyFileSafe = async (
        src,
        dest,
        attempt = 0,
        maxAttempts = 3
      ) => {
        try {
          await copyFile(src, dest);
        } catch (err) {
          if (err?.code === "ECANCELED" && attempt < maxAttempts) {
            const wait = (attempt + 1) * 1000;
            console.warn(
              `${indent}⏳  Waiting for network file ${src} (${wait}ms)…`
            );
            try {
              await stat(src);
            } catch {
              // ignore
            }
            await delay(wait);
            return copyFileSafe(src, dest, attempt + 1, maxAttempts);
          }
          throw err;
        }
      };
      await Promise.all(
        initImages.map(async (file) => {
          const dest = path.join(levelDir, path.basename(file));
          try {
            await copyFileSafe(file, dest);
          } catch (err) {
            failedArchives.push(file);
            console.warn(
              `${indent}⚠️  Failed to archive ${file}: ${err.message}`
            );
          }
        })
      );
      if (failedArchives.length) {
        const listPath = path.join(levelDir, "failed-archives.txt");
        await writeFile(listPath, failedArchives.join("\n"), "utf8");
        console.warn(
          `${indent}⚠️  ${failedArchives.length} file(s) failed to archive; see ${listPath}`
        );
      }
    }
  }

  while (true) {
    const images = await listImages(dir);
    if (images.length === 0) {
      console.log(`${indent}✅  Nothing to do in ${dir}`);
      break;
    }

    console.log(`${indent}📊  ${images.length} unclassified image(s) found`);

    if (workers && workers > 0) {
      const queue = pickRandom(images, images.length);
      console.log(
        `${indent}⏳  Processing ${queue.length} image(s) with ${workers} worker(s)…`
      );

      const multibar = new MultiBar(
        {
          clearOnComplete: false,
          hideCursor: true,
          format: `${indent}{prefix} |{bar}| {stage}`,
        },
        Presets.shades_classic
      );
      try {
        const stageMap = { encoding: 1, request: 2, waiting: 3, stream: 3, done: 4 };
        const getBar = (idx) =>
          multibar.create(4, 0, { prefix: `Batch ${idx}`, stage: "queued" });
        const log = (msg) => {
          for (const line of String(msg).split(/\n/)) {
            multibar.log(line + "\n");
            if (process.env.NODE_ENV === "test") console.log(line);
          }
        };

        let batchIdx = 0;
        let completed = 0;
        const nextBatch = () => (queue.length ? queue.splice(0, 10) : null);

        async function workerFn() {
          while (true) {
            const batch = nextBatch();
            if (!batch) break;
            const idx = ++batchIdx;
            const bar = getBar(idx);
            await batchStore.run({ batch: idx }, async () => {
              try {
                const start = Date.now();
                process.env.PHOTO_SELECT_DEBUG_DIR = dir;
                const reply = await provider.chat({
                  prompt,
                  images: batch,
                  model,
                  curators,
                  verbosity,
                  reasoningEffort,
                  onProgress: (stage) => {
                    bar.update(stageMap[stage] || 0, { stage });
                  },
                  stream: true,
                });
                const ms = Date.now() - start;
                bar.update(4, { stage: "done" });
                bar.stop();
                multibar.remove(bar);
                if (process.env.PHOTO_SELECT_PRETTY !== '0') {
                  log(
                    `${indent}🤖  ChatGPT reply (pretty):\n` +
                      prettyLLMReply(reply)
                  );
                } else {
                  log(`${indent}🤖  ChatGPT reply:\n${reply}`);
                }
                log(`${indent}⏱️  Batch ${idx} completed in ${(ms / 1000).toFixed(1)}s`);

                const { keep, aside, unclassified, notes, minutes } = parseReply(
                  reply,
                  batch,
                  { model, verbosity, reasoningEffort }
                );
                if (process.env.PHOTO_SELECT_DEBUG) {
                  log(
                    `${indent}\uD83D\uDC1B  Counts: keep=${keep.length}, aside=${aside.length}, unclassified=${unclassified.length}, notes=${notes.size}`
                  );
                  for (const [f, note] of notes) {
                    log(`${indent}\uD83D\uDCDD  ${path.basename(f)} → ${note}`);
                  }
                }
                if (minutes.length) {
                  const uuid = crypto.randomUUID();
                  const minutesFile = path.join(dir, `minutes-${uuid}.txt`);
                  let minutesText = minutes.join('\n');
                  const jsonForMinutes = extractJsonBlock(reply);

                  if (
                    jsonForMinutes &&
                    process.env.PHOTO_SELECT_MINUTES_JSON !== '0'
                  ) {
                    const pretty = JSON.stringify(jsonForMinutes, null, 2);
                    minutesText +=
                      '\n\n=== LLM JSON (full) ===\n```json\n' +
                      pretty +
                      '\n```\n';
                  }
                  await writeFile(minutesFile, minutesText, 'utf8');

                  if (
                    jsonForMinutes &&
                    process.env.PHOTO_SELECT_MINUTES_JSON_SIDECAR === '1'
                  ) {
                    const jsonSidecar = minutesFile.replace(/\.txt$/i, '.json');
                    await writeFile(
                      jsonSidecar,
                      JSON.stringify(jsonForMinutes, null, 2),
                      'utf8'
                    );
                  }

                  log(
                    `${indent}📝  Saved meeting minutes${
                      jsonForMinutes ? ' (w/ decisions JSON)' : ''
                    } to ${minutesFile}`
                  );
                }

                const keepDir = path.join(dir, "_keep");
                const asideDir = path.join(dir, "_aside");
                await Promise.all([
                  moveFiles(keep, keepDir, notes),
                  moveFiles(aside, asideDir, notes),
                ]);

                if (unclassified.length) {
                  queue.push(...unclassified);
                }

                log(
                  `📂  Moved: ${keep.length} keep → ${keepDir}, ${aside.length} aside → ${asideDir}`
                );

                completed += keep.length + aside.length;
                if (completed) {
                  const remaining = totalImages - completed;
                  const elapsed = Date.now() - levelStart;
                  const etaMs = (elapsed / completed) * remaining;
                  log(
                    `${indent}⏳  ETA to finish level: ${formatDuration(etaMs)}`
                  );
                }
              } catch (err) {
                bar.update(4, { stage: "error" });
                bar.stop();
                multibar.remove(bar);
                log(`${indent}⚠️  Batch ${idx} failed: ${err.message}`);
              }
            });
          }
        }

        const pool = Array.from(
          { length: Math.min(workers, Math.max(queue.length, 1)) },
          () => workerFn()
        );
        await Promise.all(pool);
      } finally {
        multibar.stop();
      }
    } else {
      const total = Math.min(images.length, parallel * 10);
      const selection = pickRandom(images, total);
      console.log(`${indent}🔍  Selected ${selection.length} image(s)`);
      const batches = [];
      for (let i = 0; i < selection.length; i += 10) {
        batches.push(selection.slice(i, i + 10));
      }
      console.log(`${indent}⏳  Sending ${batches.length} batch(es) to ChatGPT…`);

      const multibar = new MultiBar(
        {
          clearOnComplete: false,
          hideCursor: true,
          format: `${indent}{prefix} |{bar}| {stage}`,
        },
        Presets.shades_classic
      );
      try {
        const stageMap = { encoding: 1, request: 2, waiting: 3, stream: 3, done: 4 };
        const bars = batches.map((_, i) =>
          multibar.create(4, 0, { prefix: `Batch ${i + 1}`, stage: "queued" })
        );
        const log = (msg) => {
          for (const line of String(msg).split(/\n/)) {
            multibar.log(line + "\n");
            if (process.env.NODE_ENV === "test") console.log(line);
          }
        };

        let nextIndex = 0;
        async function workerFn() {
          while (true) {
            const idx = nextIndex++;
            if (idx >= batches.length) break;
            const batch = batches[idx];
            const bar = bars[idx];
            await batchStore.run({ batch: idx + 1 }, async () => {
              try {
                const start = Date.now();
            process.env.PHOTO_SELECT_DEBUG_DIR = dir;
            const reply = await provider.chat({
              prompt,
              images: batch,
              model,
              curators,
              verbosity,
              reasoningEffort,
              onProgress: (stage) => {
                bar.update(stageMap[stage] || 0, { stage });
              },
              stream: true,
            });
                const ms = Date.now() - start;
                bar.update(4, { stage: "done" });
                bar.stop();
                multibar.remove(bar);
                if (process.env.PHOTO_SELECT_PRETTY !== '0') {
                  log(
                    `${indent}🤖  ChatGPT reply (pretty):\n` +
                      prettyLLMReply(reply)
                  );
                } else {
                  log(`${indent}🤖  ChatGPT reply:\n${reply}`);
                }
                log(`${indent}⏱️  Batch ${idx + 1} completed in ${(ms / 1000).toFixed(1)}s`);

                const { keep, aside, unclassified = [], notes, minutes } = parseReply(
                  reply,
                  batch,
                  { model, verbosity, reasoningEffort }
                );
                if (process.env.PHOTO_SELECT_DEBUG) {
                  log(
                    `${indent}\uD83D\uDC1B  Counts: keep=${keep.length}, aside=${aside.length}, unclassified=${unclassified.length}, notes=${notes.size}`
                  );
                  for (const [f, note] of notes) {
                    log(`${indent}\uD83D\uDCDD  ${path.basename(f)} \u2192 ${note}`);
                  }
                }
                if (minutes.length) {
                  const uuid = crypto.randomUUID();
                  const minutesFile = path.join(dir, `minutes-${uuid}.txt`);
                  let minutesText = minutes.join('\n');
                  const jsonForMinutes = extractJsonBlock(reply);

                  if (
                    jsonForMinutes &&
                    process.env.PHOTO_SELECT_MINUTES_JSON !== '0'
                  ) {
                    const pretty = JSON.stringify(jsonForMinutes, null, 2);
                    minutesText +=
                      '\n\n=== LLM JSON (full) ===\n```json\n' +
                      pretty +
                      '\n```\n';
                  }
                  await writeFile(minutesFile, minutesText, 'utf8');

                  if (
                    jsonForMinutes &&
                    process.env.PHOTO_SELECT_MINUTES_JSON_SIDECAR === '1'
                  ) {
                    const jsonSidecar = minutesFile.replace(/\.txt$/i, '.json');
                    await writeFile(
                      jsonSidecar,
                      JSON.stringify(jsonForMinutes, null, 2),
                      'utf8'
                    );
                  }

                  log(
                    `${indent}📝  Saved meeting minutes${
                      jsonForMinutes ? ' (w/ decisions JSON)' : ''
                    } to ${minutesFile}`
                  );
                }

                const keepDir = path.join(dir, "_keep");
                const asideDir = path.join(dir, "_aside");
                await Promise.all([
                  moveFiles(keep, keepDir, notes),
                  moveFiles(aside, asideDir, notes),
                ]);

                log(
                  `📂  Moved: ${keep.length} keep → ${keepDir}, ${aside.length} aside → ${asideDir}`
                );
              } catch (err) {
                bar.update(4, { stage: "error" });
                bar.stop();
                multibar.remove(bar);
                log(`${indent}⚠️  Batch ${idx + 1} failed: ${err.message}`);
              }
            });
          }
        }

        const pool = Array.from(
          { length: Math.min(parallel, batches.length) },
          () => workerFn()
        );
        await Promise.all(pool);
      } finally {
        multibar.stop();
      }
    }
    const remaining = (await listImages(dir)).length;
    const processed = totalImages - remaining;
    if (processed) {
      const elapsed = Date.now() - levelStart;
      const etaMs = (elapsed / processed) * remaining;
      console.log(`${indent}⏳  ETA to finish level: ${formatDuration(etaMs)}`);
    }
  }

  // Step 5 – recurse into keepDir if both keep and aside exist
  if (recurse) {
    const keepDir = path.join(dir, "_keep");
    const asideDir = path.join(dir, "_aside");
    let keepExists = false;
    try {
      keepExists = (await stat(keepDir)).isDirectory();
    } catch {
      // ignore
    }

    if (keepExists) {
      await triageDirectory({
        dir: keepDir,
        promptPath,
        provider,
        model,
        recurse,
        curators,
        contextPath,
        parallel,
        workers,
        verbosity,
        reasoningEffort,
        depth: depth + 1,
      });
    } else {
      let keepCount = 0;
      let asideCount = 0;
      try {
        keepCount = (await listImages(keepDir)).length;
      } catch {
        // ignore
      }
      try {
        asideCount = (await listImages(asideDir)).length;
      } catch {
        // ignore
      }

      if (keepCount || asideCount) {
        const status = keepCount ? "kept" : "set aside";
        console.log(`${indent}🎯  All images ${status} at this level; stopping recursion.`);
      }
    }
  }
}
