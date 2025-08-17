import path from "node:path";
import { readFile, writeFile, mkdir, stat, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { batchStore } from "./batchContext.js";
import crypto from "node:crypto";
import { delay } from "./config.js";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { parseReply } from "./chatClient.js";
import { buildPrompt } from "./templates.js";
import FieldNotesWriter from "./fieldNotesWriter.js";
import { MultiBar, Presets } from "cli-progress";

const exec = promisify(execFile);

// ---- env & defaults ---------------------------------------------------------
function envBool(name, def) {
  const v = process.env[name];
  if (v == null) return def;
  if (/^(1|true|yes|on)$/i.test(v)) return true;
  if (/^(0|false|no|off)$/i.test(v)) return false;
  return def;
}
const PRETTY = envBool("PHOTO_SELECT_PRETTY", true);                 // pretty console summary
const TRANSCRIPT_TXT = envBool("PHOTO_SELECT_TRANSCRIPT_TXT", false); // optional .txt transcript

function parsePrettyMinutes() {
  const raw = process.env.PHOTO_SELECT_PRETTY_MINUTES;
  const isTTY = process.stdout.isTTY;
  const isCI = !!process.env.CI;
  if (raw != null) {
    if (/^(all|∞|infinity|0)$/i.test(raw)) return Infinity;
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n === 0 ? Infinity : n;
  }
  return isTTY && !isCI ? Infinity : 20;
}
const MAX_MINUTES = parsePrettyMinutes();

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
  return process.stdout.isTTY && process.env.NO_COLOR !== "1";
}
function color(s, code) {
  return useColor() ? `\x1b[${code}m${s}\x1b[0m` : s;
}
const dim = (s) => color(s, 2);
const green = (s) => color(s, 32);
const yellow = (s) => color(s, 33);

const SMALL = Number(process.env.PHOTO_SELECT_SMALL_BATCH_THRESHOLD || 10);
const BATCH_CAP = 10;
const MAX_SMALL = Number(
  process.env.PHOTO_SELECT_ZERO_DECISION_MAX_STREAK_SMALL || 1
);
const MAX_LARGE = Number(
  process.env.PHOTO_SELECT_ZERO_DECISION_MAX_STREAK_LARGE || 2
);
// Enforce hard cap for vision LLM stability.
const BATCH_SIZE = Math.min(Number(process.env.PHOTO_SELECT_BATCH_SIZE || 10), BATCH_CAP);
const CONCURRENCY = Number(process.env.PHOTO_SELECT_MAX_CONCURRENT || 10);
if (process.env.PHOTO_SELECT_VERBOSE === '1') {
  console.log(
    `⚙️  BATCH_SIZE=${BATCH_SIZE} (cap=${BATCH_CAP}) CONCURRENCY=${CONCURRENCY} SMALL_THRESHOLD=${SMALL}`
  );
}

function prettyLLMReply(raw, { maxMinutes = MAX_MINUTES } = {}) {
  const json = extractJsonBlock(raw);
  if (!json) {
    try {
      return JSON.stringify(JSON.parse(String(raw)), null, 2);
    } catch {
      return String(raw);
    }
  }
  let out = "";
  if (Array.isArray(json.minutes)) {
    out += `${dim("— Minutes —")}\n`;
    const slice =
      maxMinutes === Infinity ? json.minutes : json.minutes.slice(0, maxMinutes);
    for (const m of slice) {
      if (m && typeof m === "object") {
        const who = (m.speaker ?? "Curator").toString();
        const txt = (m.text ?? "").toString();
        out += `  • ${who}: ${txt}\n`;
      }
    }
    if (maxMinutes !== Infinity && json.minutes.length > slice.length) {
      out += dim(`  … +${json.minutes.length - slice.length} more\n`);
    }
  }
  if (Array.isArray(json.decisions)) {
    const keeps = json.decisions.filter((d) => d && d.decision === "keep");
    const asides = json.decisions.filter((d) => d && d.decision === "aside");
    out += `${dim("— Decisions —")} ${keeps.length} keep / ${asides.length} aside\n`;
    for (const d of keeps)
      out += `  ${green("KEEP")}  ${d.filename}${
        d.reason ? ` — ${d.reason}` : ""
      }\n`;
    for (const d of asides)
      out += `  ${yellow("ASIDE")} ${d.filename}${
        d.reason ? ` — ${d.reason}` : ""
      }\n`;
  } else {
    out += JSON.stringify(json, null, 2) + "\n";
  }
  return out.trimEnd();
}

async function ensureGitRepo(dir) {
  try {
    await stat(path.join(dir, ".git"));
  } catch {
    await exec("git", ["init"], { cwd: dir });
  }
}

async function commitFile(repoDir, file, message) {
  await exec("git", ["add", file], { cwd: repoDir });
  await exec("git", ["commit", "-m", message], { cwd: repoDir });
}

async function getRevisionHistory(repoDir, file, count = 2) {
  try {
    const rel = path.relative(repoDir, file);
    const { stdout } = await exec(
      "git",
      ["log", "--format=%H", "--follow", "--", rel],
      { cwd: repoDir }
    );
    const hashes = stdout.trim().split("\n").filter(Boolean);
    const versions = [];
    for (let i = 1; i <= count && i < hashes.length; i++) {
      const sha = hashes[i];
      const { stdout: content } = await exec(
        "git",
        ["show", `${sha}:${rel}`],
        { cwd: repoDir }
      );
      versions.push(content.trim());
    }
    return versions;
  } catch {
    return [];
  }
}

async function getCommitMessages(repoDir, file) {
  try {
    const rel = path.relative(repoDir, file);
    const { stdout } = await exec(
      "git",
      ["log", "--format=%s", "--follow", "--", rel],
      { cwd: repoDir }
    );
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
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
* @param {boolean} [options.fieldNotes=false] Enable field notes workflow
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
  fieldNotes = false,
  verbose = false,
  saveIo = false,
  workers = 1,
  verbosity,
  reasoningEffort,
  depth = 0,
  gitRoot,
}) {
  if (!provider) {
    const m = await import('./providers/openai.js');
    provider = new m.default();
  }
  const indent = "  ".repeat(depth);
  let notesWriter;

  let dynamicWorkers = workers;
  let consecutiveGatewayErrors = 0;
  function isGatewayError(e) {
    const s = e?.status || e?.code;
    return s === 502 || s === 503;
  }
  function noteGatewayError() {
    consecutiveGatewayErrors++;
    if (consecutiveGatewayErrors >= 3 && dynamicWorkers > 1) {
      dynamicWorkers = 1;
      console.warn(
        `${indent}⚠️  High gateway error rate → reducing workers to 1 for the next 10 minutes.`
      );
      setTimeout(() => {
        dynamicWorkers = workers;
        consecutiveGatewayErrors = 0;
      }, 10 * 60 * 1000);
    }
  }

  if (depth === 0) {
    const shown = MAX_MINUTES === Infinity ? 'all' : String(MAX_MINUTES);
    console.log(dim(`UI: pretty=${PRETTY?'on':'off'}, transcript_txt=${TRANSCRIPT_TXT?'on':'off'}, minutes_shown=${shown}`));
  }

  if (!gitRoot) gitRoot = dir;
  if (fieldNotes && depth === 0) {
    await ensureGitRepo(gitRoot);
  }

  console.log(`${indent}📁  Scanning ${dir}`);

  // Archive original images at this level
  const levelDir = path.join(dir, `_level-${String(depth + 1).padStart(3, '0')}`);
  const initImages = await listImages(dir);
  const levelStart = Date.now();
  const totalImages = initImages.length;
  const totalBatches = Math.ceil(totalImages / BATCH_SIZE);
  await mkdir(levelDir, { recursive: true });
  if (saveIo) {
    await mkdir(path.join(levelDir, '_prompts'), { recursive: true });
    await mkdir(path.join(levelDir, '_responses'), { recursive: true });
  }
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
        console.warn(`${indent}⏳  Waiting for network file ${src} (${wait}ms)…`);
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
        console.warn(`${indent}⚠️  Failed to archive ${file}: ${err.message}`);
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

  if (fieldNotes) {
    const lvl = String(depth + 1).padStart(3, '0');
    notesWriter = new FieldNotesWriter(path.join(levelDir, 'field-notes.md'), lvl);
    await notesWriter.init();
  }

  let completedBatches = 0;

  while (true) {
    const images = await listImages(dir);
    if (images.length === 0) {
      console.log(`${indent}✅  Nothing to do in ${dir}`);
      break;
    }

    console.log(`${indent}📊  ${images.length} unclassified image(s) found`);
    const queue = pickRandom(images, images.length);
    console.log(
      `${indent}⏳  Processing ${queue.length} image(s) with ${dynamicWorkers} worker(s)…`
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
        const nextBatch = () => (queue.length ? queue.splice(0, BATCH_SIZE) : null);

        async function workerFn() {
          while (true) {
            const batch = nextBatch();
            if (!batch) break;
            const idx = ++batchIdx;
            const bar = getBar(idx);
            await batchStore.run({ batch: idx }, async () => {
              try {
                const batchStart = Date.now();
                const maxStreak =
                  batch.length <= SMALL ? MAX_SMALL : MAX_LARGE;
                let attempts = 0;
                let reply;
                let keep = [];
                let aside = [];
                let unclassified = [];
                let notes = new Map();
                let minutes = [];
                const saveText = async (kind, attempt, text) => {
                  if (!saveIo) return;
                  const dirName = kind === 'prompt' ? '_prompts' : '_responses';
                  const attemptSuffix = attempt > 1 ? `-${attempt}` : '';
                  const file = path.join(
                    levelDir,
                    dirName,
                    `batch-${String(idx).padStart(3, '0')}${attemptSuffix}.txt`
                  );
                  try {
                    await writeFile(file, text, 'utf8');
                  } catch {
                    /* ignore */
                  }
                };

                const first = await buildPrompt(promptPath, {
                  curators,
                  contextPath,
                  images: batch,
                  hasFieldNotes: false,
                  isSecondPass: false,
                });
                const meta = { model, verbosity, reasoningEffort };
                let attemptNum = 1;
                await saveText('prompt', attemptNum, first.prompt);
                reply = await provider.chat({
                  prompt: first.prompt,
                  images: batch,
                  model,
                  curators,
                  verbosity,
                  reasoningEffort,
                  minutesMin: first.minutesMin,
                  minutesMax: first.minutesMax,
                  onProgress: (stage) => {
                    bar.update(stageMap[stage] || 0, { stage });
                  },
                  stream: true,
                });
                await saveText('response', attemptNum, reply);
                ({ keep, aside, unclassified, notes, minutes } = parseReply(
                  reply,
                  batch,
                  meta
                ));
                if (keep.length + aside.length === 0) {
                  attempts++;
                  if (attempts <= maxStreak) {
                    const repair = [
                      `role play as ${curators.join(", ")}:\n - inidicate who is speaking\n - say what you think`,
                      "You are continuing the same curatorial session.",
                      "Return only the block below. No minutes, no commentary.",
                      "",
                      "=== DECISIONS_JSON ===",
                      '{"decisions":[{"filename":"<from list>","decision":"keep|aside","reason":""}]}',
                      "=== END ===",
                      "",
                      "Files (use each exactly once):",
                      ...batch.map((f) => `- ${path.basename(f)}`),
                    ].join("\n");
                    attemptNum++;
                    await saveText('prompt', attemptNum, repair);
                    reply = await provider.chat({
                      prompt: repair,
                      images: batch,
                      model,
                      curators,
                      verbosity: "low",
                      reasoningEffort,
                      minutesMin: 0,
                      minutesMax: 0,
                      onProgress: (stage) => {
                        bar.update(stageMap[stage] || 0, { stage });
                      },
                      stream: true,
                    });
                    await saveText('response', attemptNum, reply);
                    ({ keep, aside, unclassified, notes } = parseReply(
                      reply,
                      batch,
                      meta
                    ));
                  }
                  if (keep.length + aside.length === 0) {
                    console.log(
                      dim(
                        `⚠️  No decisions after ${attempts} attempt(s); marking NEEDS_REVIEW and continuing.`
                      )
                    );
                    const marker = path.join(dir, "NEEDS_REVIEW");
                    const list = batch.map((f) => path.basename(f)).join("\n");
                    try {
                      const prev = await readFile(marker, "utf8").catch(() => "");
                      await writeFile(marker, `${prev}${list}\n`, "utf8");
                    } catch {}
                    return;
                  }
                }
                const ms = Date.now() - batchStart;
                bar.update(4, { stage: "done" });
                bar.stop();
                multibar.remove(bar);
                if (PRETTY) {
                  log(`${indent}🤖  ChatGPT reply (pretty):\n` + prettyLLMReply(reply));
                } else {
                  log(`${indent}🤖  ChatGPT reply:\n${reply}`);
                }
                log(
                  `${indent}⏱️  Batch ${idx} completed in ${(ms / 1000).toFixed(1)}s`
                );

                // Write primary minutes JSON and optional transcript
                const uuid = crypto.randomUUID();
                const jsonPath = path.join(dir, `minutes-${uuid}.json`);
                const j =
                  extractJsonBlock(reply) || (() => {
                    const mk = (arr, tag) =>
                      arr.map((f) => ({
                        filename: path.basename(f),
                        decision: tag,
                        reason: (notes.get(f) || "").toString(),
                      }));
                    const decisions = [
                      ...mk(keep, "keep"),
                      ...mk(aside, "aside"),
                    ];
                    const minutesObjs = minutes.map((line) => {
                      const m = line.match(/^([^:]+):\s*(.*)$/);
                      return m
                        ? { speaker: m[1], text: m[2] }
                        : { speaker: "Curator", text: line };
                    });
                    return { minutes: minutesObjs, decisions };
                  })();
                await writeFile(jsonPath, JSON.stringify(j, null, 2), "utf8");
                log(`${indent}📝  Saved minutes JSON to ${jsonPath}`);
                if (TRANSCRIPT_TXT && Array.isArray(j.minutes)) {
                  const txtPath = path.join(dir, `minutes-${uuid}.txt`);
                  let out = j.minutes
                    .map((m) => `${m.speaker || "Curator"}: ${m.text || ""}`)
                    .join("\n");
                  if (Array.isArray(j.decisions)) {
                    const keeps = j.decisions.filter((d) => d.decision === "keep");
                    const asides = j.decisions.filter((d) => d.decision === "aside");
                    out += `\n\n— Decisions — ${keeps.length} keep / ${asides.length} aside\n`;
                    for (const d of keeps)
                      out += `  KEEP  ${d.filename}${d.reason ? ' — ' + d.reason : ''}\n`;
                    for (const d of asides)
                      out += `  ASIDE ${d.filename}${d.reason ? ' — ' + d.reason : ''}\n`;
                  }
                  await writeFile(txtPath, out, "utf8");
                  log(`${indent}📝  Saved transcript TXT to ${txtPath}`);
                }
                const keepDir = path.join(dir, "_keep");
                const asideDir = path.join(dir, "_aside");
                await Promise.all([
                  moveFiles(keep, keepDir, notes),
                  moveFiles(aside, asideDir, notes),
                ]);
                  if (unclassified.length && keep.length + aside.length > 0) {
                    queue.push(...unclassified);
                  }
                log(
                  `📂  Moved: ${keep.length} keep → ${keepDir}, ${aside.length} aside → ${asideDir}`
                );

                if (keep.length + aside.length > 0) {
                  completedBatches++;
                  const elapsedSec = (Date.now() - levelStart) / 1000;
                  const remaining = totalBatches - completedBatches;
                  const tps = completedBatches / elapsedSec;
                  const etaSec = tps > 0 ? Math.ceil(remaining / tps) : Infinity;
                  log(
                    `${indent}⏳  ETA to finish level: ${formatDuration(etaSec * 1000)}`
                  );
                }
              } catch (err) {
                if (isGatewayError(err)) noteGatewayError();
                bar.update(4, { stage: "error" });
                bar.stop();
                multibar.remove(bar);
                log(`${indent}⚠️  Batch ${idx} failed: ${err.message}`);
              }
            });
          }
        }

        const pool = Array.from(
          { length: Math.min(dynamicWorkers, Math.max(queue.length, 1)) },
          () => workerFn()
        );
        await Promise.all(pool);
      } finally {
        multibar.stop();
      }
      const remaining = (await listImages(dir)).length;
      const remainingBatches = Math.ceil(remaining / BATCH_SIZE);
      if (completedBatches) {
        const elapsedSec = (Date.now() - levelStart) / 1000;
        const tps = completedBatches / elapsedSec;
        const etaSec = tps > 0 ? Math.ceil(remainingBatches / tps) : Infinity;
        console.log(
          `${indent}⏳  ETA to finish level: ${formatDuration(etaSec * 1000)}`
        );
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
        fieldNotes,
        verbose,
        saveIo,
        workers,
        verbosity,
        reasoningEffort,
        depth: depth + 1,
        gitRoot,
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
