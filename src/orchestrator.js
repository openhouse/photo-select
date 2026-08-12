import path from "node:path";
import { readFile, writeFile, mkdir, stat, rename, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { batchStore } from "./batchContext.js";
import crypto from "node:crypto";
import { ensureArchiveLevel } from "./archive/ensureArchiveLevel.js";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { parseReply, getPeople, prefetchPeople } from "./chatClient.js";
import { buildPrompt } from "./templates.js";
import FieldNotesWriter from "./fieldNotesWriter.js";
import { MultiBar, Presets } from "cli-progress";
import { sanitizePeople } from "./lib/people.js";
import { finalizeCurators } from "./core/finalizeCurators.js";
import { evaluateLevelOutcome } from "./core/evaluateLevelOutcome.js";
import { reconcileDecisionFilenames } from "./core/reconcileDecisionFilenames.js";
import { planNeedsReviewRetry } from "./core/planNeedsReviewRetry.js";

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


function looksLikeOpenAIResponseEnvelope(reply) {
  try {
    const obj = JSON.parse(String(reply));
    return Boolean(
      obj?.object === "response" ||
        (typeof obj?.id === "string" && obj.id.startsWith("resp_")) ||
        (typeof obj?.status === "string" && (obj?.output || obj?.usage || obj?.incomplete_details)) ||
        obj?.text?.format?.schema
    );
  } catch {
    return false;
  }
}

export function validateDecisionSet({ keep, aside, batch, requireComplete = false }) {
  const expected = new Set(batch.map((f) => path.basename(f)));
  const seen = new Map();

  for (const file of [...keep, ...aside]) {
    const name = path.basename(file);

    if (!expected.has(name)) {
      const err = new Error(`Invalid decision set: unknown file ${name}`);
      err.code = "INVALID_DECISIONS";
      throw err;
    }

    seen.set(name, (seen.get(name) || 0) + 1);
  }

  for (const [name, count] of seen.entries()) {
    if (count !== 1) {
      const err = new Error(`Invalid decision set: duplicate decision for ${name}`);
      err.code = "INVALID_DECISIONS";
      throw err;
    }
  }

  if (requireComplete) {
    for (const name of expected) {
      if (!seen.has(name)) {
        const err = new Error(`Invalid decision set: missing ${name}`);
        err.code = "INVALID_DECISIONS";
        throw err;
      }
    }

    if (seen.size !== expected.size) {
      const err = new Error(`Invalid decision set: expected ${expected.size}, got ${seen.size}`);
      err.code = "INVALID_DECISIONS";
      throw err;
    }
  }
}

function failureReason(err) {
  const reason = err?.reason || err?.incomplete_details?.reason || err?.status || err?.message || "unknown";
  return `${err?.code || "BATCH_FAILED"}:${reason}`;
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


async function readNeedsReviewNames(dir) {
  try {
    const raw = await readFile(path.join(dir, "NEEDS_REVIEW"), "utf8");
    return new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/)[0])
        .filter(Boolean)
    );
  } catch {
    return new Set();
  }
}

async function writeNeedsReviewEntries(dir, entries) {
  const marker = path.join(dir, "NEEDS_REVIEW");
  const existing = new Map();
  try {
    const raw = await readFile(marker, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [name, ...rest] = trimmed.split(/\s+/);
      existing.set(name, rest.join(" "));
    }
  } catch {
    /* no marker yet */
  }
  for (const { name, reason } of entries) {
    existing.set(name, reason || "NEEDS_REVIEW");
  }
  const lines = [...existing.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, reason]) => `${name}	${reason}`);
  await writeFile(marker, lines.length ? `${lines.join("\n")}\n` : "", "utf8");
}

async function clearNeedsReviewEntries(dir, files) {
  if (!files.length) return;
  const marker = path.join(dir, "NEEDS_REVIEW");
  const clear = new Set(files.map((file) => path.basename(file)));
  let raw;
  try {
    raw = await readFile(marker, "utf8");
  } catch {
    return;
  }
  const kept = raw
    .split(/\r?\n/)
    .filter((line) => {
      const name = line.trim().split(/\s+/)[0];
      return name && !clear.has(name);
    });
  await writeFile(marker, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
}

const NEEDS_REVIEW_RETRY_SCHEMA = 1;

async function readNeedsReviewRetryState(statePath) {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    if (
      parsed?.schemaVersion !== NEEDS_REVIEW_RETRY_SCHEMA ||
      !Number.isInteger(parsed?.retriesUsed) ||
      parsed.retriesUsed < 0
    ) {
      throw new Error("invalid retry-state shape");
    }
    return parsed.retriesUsed;
  } catch (err) {
    if (err?.code === "ENOENT") return 0;
    const wrapped = new Error(
      `Cannot read NEEDS_REVIEW retry state at ${statePath}: ${err.message}`
    );
    wrapped.code = "INVALID_NEEDS_REVIEW_RETRY_STATE";
    wrapped.cause = err;
    throw wrapped;
  }
}

async function writeNeedsReviewRetryState(statePath, { retriesUsed, maxRetries }) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(
    temporaryPath,
    JSON.stringify(
      {
        schemaVersion: NEEDS_REVIEW_RETRY_SCHEMA,
        retriesUsed,
        maxRetries,
        updatedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );
  await rename(temporaryPath, statePath);
}

export async function listLevelState(dir, { retryNeedsReview = envBool("PHOTO_SELECT_RETRY_NEEDS_REVIEW", false) } = {}) {
  const allImages = await listImages(dir);
  const needsReviewNames = await readNeedsReviewNames(dir);
  const eligibleImages = [];
  const needsReviewImages = [];

  for (const file of allImages) {
    if (needsReviewNames.has(path.basename(file))) {
      needsReviewImages.push(file);
      if (retryNeedsReview) eligibleImages.push(file);
    } else {
      eligibleImages.push(file);
    }
  }

  return {
    allImages,
    eligibleImages,
    needsReviewImages,
    ignoredImagesOrFiles: [],
    needsReviewNames,
  };
}

export async function findShallowestLevelWithEligibleImages(rootDir, options = {}) {
  const allowDescendWithNeedsReview = options.allowDescendWithNeedsReview ?? envBool("PHOTO_SELECT_ALLOW_DESCEND_WITH_NEEDS_REVIEW", false);
  let current = rootDir;
  let depth = 0;

  while (await dirExists(current)) {
    const state = await listLevelState(current, options);
    const level = depth + 1;
    if (state.eligibleImages.length > 0) {
      console.log(`${"  ".repeat(depth)}📊  level ${level}: ${state.eligibleImages.length} eligible image(s), ${state.needsReviewImages.length} NEEDS_REVIEW held`);
      return { dir: current, depth, level, state };
    }
    if (state.needsReviewImages.length > 0) {
      console.warn(`${"  ".repeat(depth)}⚠️  level ${level}: 0 eligible image(s), ${state.needsReviewImages.length} held for NEEDS_REVIEW in ${current}`);
      if (!allowDescendWithNeedsReview) {
        return { dir: current, depth, level, state, blocked: true, blockedCount: state.needsReviewImages.length };
      }
      console.log(`${"  ".repeat(depth)}↘️  no eligible work at level ${level}; checking _keep`);
    }
    const [hasKeep, hasAside] = await Promise.all([
      dirExists(path.join(current, "_keep")),
      dirExists(path.join(current, "_aside")),
    ]);
    let levelSize;
    if (Number.isInteger(options.targetLevelSize)) {
      try {
        levelSize = (
          await listImages(
            path.join(current, `_level-${String(level).padStart(3, "0")}`)
          )
        ).length;
      } catch (err) {
        if (err?.code !== "ENOENT") throw err;
      }
    }
    const outcome = evaluateLevelOutcome({
      complete: state.needsReviewImages.length === 0,
      hasKeep,
      hasAside,
      levelSize,
      targetLevelSize: options.targetLevelSize,
    });
    if (outcome.shouldStop) {
      return {
        dir: current,
        depth,
        level,
        levelSize,
        state,
        stopped: true,
        outcome,
      };
    }
    const next = path.join(current, "_keep");
    if (!(await dirExists(next))) return null;
    current = next;
    depth += 1;
  }
  return null;
}

export async function triageTree(options) {
  const rootDir = options.dir;
  let lastDepth = 0;

  if (Number.isInteger(options.targetLevelSize)) {
    console.log(
      `🎯  target-level-size=${options.targetLevelSize}: complete levels until one contains at most this many photos.`
    );
  }
  if (options.retryNeedsReview) {
    console.log(
      `🔁  needs-review-retries=${options.needsReviewRetries}: automatic repair passes per level.`
    );
  }

  while (true) {
    const work = await findShallowestLevelWithEligibleImages(rootDir, options);
    if (!work) {
      console.log("✅  No pending image files found in cascade.");
      break;
    }
    if (work.stopped) {
      if (work.outcome.state === "target_reached") {
        console.log(
          `${"  ".repeat(work.depth)}🎯  Completed level ${work.level} contains ${work.levelSize} photo(s), meeting target ≤ ${options.targetLevelSize}; stopping recursion.`
        );
        break;
      }
      const bucket = work.outcome.state === "unanimous_keep" ? "kept" : "set aside";
      console.log(
        `${"  ".repeat(work.depth)}🎯  All images ${bucket} at completed level ${work.level}; stopping recursion.`
      );
      break;
    }
    if (work.blocked) {
      console.warn(`⚠️  Cascade blocked at ${work.dir}: ${work.blockedCount} file(s) need review. Not descending.`);
      break;
    }
    console.log(`${"  ".repeat(work.depth)}🧭  scheduler selected: level=${work.level} source=${work.dir} eligible=${work.state.eligibleImages.length}`);
    if (work.depth < lastDepth) {
      console.log(`${"  ".repeat(work.depth)}↩️  returning to shallower level before continuing deeper`);
    }
    const result = await triageDirectory({
      ...options,
      dir: work.dir,
      depth: work.depth,
      recurse: false,
      _cascadeLevel: true,
      gitRoot: options.gitRoot || rootDir,
    });
    if (result?.blocked) {
      console.warn(`⚠️  Cascade blocked at ${work.dir}: ${result.blockedCount} file(s) need review. Not descending.`);
      break;
    }
    const postState = await listLevelState(work.dir, options);
    console.log(`${"  ".repeat(work.depth)}🔎  level drain check: level=${work.level} source=${work.dir} eligible=${postState.eligibleImages.length}`);
    if (postState.eligibleImages.length > 0) {
      console.log(`${"  ".repeat(work.depth)}🔁  level still has eligible files; repeating level=${work.level}`);
    } else {
      console.log(`${"  ".repeat(work.depth)}✅  level drained; checking shallowest source again`);
    }
    lastDepth = work.depth;
    console.log("🔁  Re-scanning cascade from base before descending further…");
  }
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

async function dirExists(p) {
  try {
    return (await stat(p)).isDirectory();
  } catch (err) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

/**
 * Follow the _keep chain until we find a directory with unclassified images or
 * run out of nested _keep folders.
 *
 * @param {string} startDir
 * @returns {Promise<{dir: string, hops: number}>}
 */
export async function resolveResumeLevel(startDir) {
  let current = startDir;
  let hops = 0;

  while (true) {
    const imagesHere = await listImages(current);
    if (imagesHere.length > 0) {
      return { dir: current, hops };
    }

    const next = path.join(current, "_keep");
    if (!(await dirExists(next))) {
      return { dir: current, hops };
    }

    current = next;
    hops += 1;
  }
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
 * @param {number} [options.targetLevelSize] Continue until a completed level has at most this many photos
 * @param {boolean} [options.retryNeedsReview=false] Automatically repair held files
 * @param {number} [options.needsReviewRetries=2] Maximum repair passes per level
 * @param {string[]} [options.curators=[]]   Names inserted into the prompt
 * @param {string} [options.contextPath]     Optional additional context file
 * @param {boolean} [options.refreshPeopleIndex=false] Force one derived people-index refresh
* @param {boolean} [options.fieldNotes=false] Enable field notes workflow
* @param {number} [options.depth=0]         Internal recursion depth (for logging)
*/
export async function triageDirectory(options) {
  let {
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
    update = true,
    forceRebuild = false,
    stageConcurrency,
    retryNeedsReview = envBool("PHOTO_SELECT_RETRY_NEEDS_REVIEW", false),
    needsReviewRetries = Number(process.env.PHOTO_SELECT_NEEDS_REVIEW_RETRIES || 2),
    allowDescendWithNeedsReview = envBool("PHOTO_SELECT_ALLOW_DESCEND_WITH_NEEDS_REVIEW", false),
    targetLevelSize,
    refreshPeopleIndex = false,
    _cascadeLevel = false,
  } = options;
  if (!Number.isInteger(needsReviewRetries) || needsReviewRetries < 1) {
    throw new Error("needsReviewRetries must be a positive integer");
  }
  if (!provider) {
    const m = await import('./providers/openai.js');
    provider = new m.default();
  }
  if (recurse && depth === 0 && !_cascadeLevel) {
    return triageTree({
      ...options,
      provider,
      retryNeedsReview,
      needsReviewRetries,
      allowDescendWithNeedsReview,
    });
  }
  const indent = "  ".repeat(depth);
  let notesWriter;

  function isBillingLimitError(err) {
    if (!err) return false;
    const candidates = [
      err?.message,
      err?.error?.message,
      err?.cause?.message,
      err?.response?.data?.error?.message,
      err?.response?.data?.message,
      err?.response?.error?.message,
      err?.response?.message,
      err?.body?.error?.message,
      err?.body?.message,
    ]
      .flat()
      .filter(Boolean)
      .map((msg) => String(msg));
    return candidates.some((message) => /billing (hard )?limit/i.test(message));
  }

  function createBillingLimitError(err) {
    const wrapped = new Error("Billing hard limit reached; aborting remaining batches.");
    wrapped.code = "BILLING_LIMIT";
    wrapped.cause = err;
    return wrapped;
  }

  function isPromptCacheSafetyError(err) {
    return err?.code === "PROMPT_CACHE_PROBE_MISS";
  }

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

  if (recurse) {
    const { dir: workDir, hops } = await resolveResumeLevel(dir);
    if (workDir !== dir) {
      const relative = path.relative(dir, workDir) || ".";
      const prettyRelative = relative === "." ? "." : relative.split(path.sep).join("/");
      console.log(
        `${indent}↘️  No unclassified images at this level; resuming in ${prettyRelative}`
      );
      return triageDirectory({
        ...options,
        dir: workDir,
        depth: depth + hops,
        provider,
        gitRoot,
        update,
        forceRebuild,
        stageConcurrency,
      });
    }
  }

  if (fieldNotes && depth === 0) {
    await ensureGitRepo(gitRoot);
  }

  console.log(`${indent}📁  Scanning ${dir}`);

  // Archive original images at this level
  const levelDir = path.join(dir, `_level-${String(depth + 1).padStart(3, '0')}`);
  const runSession = async (payload) => {
    const handle = await provider.submit({
      levelDir,
      ...payload,
    });
    return provider.collect(handle);
  };
  const levelStart = Date.now();
  await mkdir(levelDir, { recursive: true });
  if (saveIo) {
    await mkdir(path.join(levelDir, '_prompts'), { recursive: true });
    await mkdir(path.join(levelDir, '_responses'), { recursive: true });
  }
  if (!update && depth === 0) {
    console.warn("⚠️ archive update disabled — will re-clone all files");
  }

  if (fieldNotes) {
    const lvl = String(depth + 1).padStart(3, '0');
    notesWriter = new FieldNotesWriter(path.join(levelDir, 'field-notes.md'), lvl);
    await notesWriter.init();
  }

  let completedBatches = 0;
  const retrySuppressedNames = new Set();
  const needsReviewRetryStatePath = path.join(
    levelDir,
    ".batch",
    "needs-review-retries.json"
  );
  let needsReviewRetriesUsed = retryNeedsReview
    ? await readNeedsReviewRetryState(needsReviewRetryStatePath)
    : 0;

  while (true) {
    const state = await listLevelState(dir, { retryNeedsReview: false });
    const activeImages = state.eligibleImages.filter(
      (file) => !retrySuppressedNames.has(path.basename(file))
    );
    const retryableHeldImages = state.needsReviewImages.filter(
      (file) => !retrySuppressedNames.has(path.basename(file))
    );
    const retryPlan = planNeedsReviewRetry({
      enabled: retryNeedsReview,
      retriesUsed: needsReviewRetriesUsed,
      maxRetries: needsReviewRetries,
      heldCount: retryableHeldImages.length,
    });
    let images = activeImages;
    if (retryPlan.shouldRetry) {
      needsReviewRetriesUsed = retryPlan.retriesUsed;
      await writeNeedsReviewRetryState(needsReviewRetryStatePath, {
        retriesUsed: needsReviewRetriesUsed,
        maxRetries: needsReviewRetries,
      });
      images = [...activeImages, ...retryableHeldImages];
      console.log(
        `${indent}🔁  NEEDS_REVIEW repair pass ${retryPlan.attempt}/${needsReviewRetries}: ${retryableHeldImages.length} held image(s).`
      );
    }
    console.log(`${indent}📊  level ${depth + 1}: ${state.allImages.length} source image(s): ${images.length} eligible, ${state.needsReviewImages.length} NEEDS_REVIEW`);
    if (images.length === 0) {
      if (state.needsReviewImages.length > 0) {
        const pendingRetry = planNeedsReviewRetry({
          enabled: retryNeedsReview,
          retriesUsed: needsReviewRetriesUsed,
          maxRetries: needsReviewRetries,
          heldCount: state.needsReviewImages.length,
        });
        if (pendingRetry.shouldRetry && retrySuppressedNames.size > 0) {
          retrySuppressedNames.clear();
          console.log(
            `${indent}🔁  Preparing automatic NEEDS_REVIEW repair pass ${pendingRetry.attempt}/${needsReviewRetries}.`
          );
          continue;
        }
        if (retryNeedsReview && pendingRetry.reason === "exhausted") {
          console.warn(
            `${indent}⚠️  NEEDS_REVIEW automatic repair budget exhausted (${needsReviewRetriesUsed}/${needsReviewRetries}) for level ${depth + 1}.`
          );
        }
        console.warn(`${indent}⚠️  Level blocked: ${dir} has ${state.needsReviewImages.length} image file(s) needing review. Not descending.`);
        return { blocked: true, blockedCount: state.needsReviewImages.length };
      }
      if (retryNeedsReview) {
        await rm(needsReviewRetryStatePath, { force: true });
      }
      console.log(`${indent}✅  Level settled: ${dir} has 0 active image files.`);
      break;
    }

    const archiveResult = await ensureArchiveLevel({
      levelDir,
      files: images,
      update,
      forceRebuild,
      stageConcurrency,
      verbose,
    });
    if (archiveResult.failed?.length) {
      const listPath = path.join(levelDir, "failed-archives.txt");
      await writeFile(listPath, archiveResult.failed.join("\n"), "utf8");
      console.warn(
        `${indent}⚠️  ${archiveResult.failed.length} file(s) failed to archive; see ${listPath}`
      );
    }

    const peopleStart = Date.now();
    const peopleResult = await prefetchPeople(images, {
      force: refreshPeopleIndex,
    });
    if (verbose && peopleResult.mode === "bulk") {
      console.log(
        `${indent}people-index: status=${peopleResult.indexStatus} corpus=${peopleResult.corpusSha256.slice(0, 12)} sources=${peopleResult.sourceCount} names=${peopleResult.names} elapsed=${((Date.now() - peopleStart) / 1000).toFixed(1)}s source_freshness=${peopleResult.sourceFreshness}`,
      );
    } else if (verbose && peopleResult.mode === "legacy-fallback") {
      console.warn(
        `${indent}people-index: mode=legacy-fallback reason=${peopleResult.reason ?? "unsupported"}`,
      );
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
          const text = String(msg).endsWith("\n") ? String(msg) : `${String(msg)}\n`;
          multibar.log(text);
          if (process.env.NODE_ENV === "test") console.log(text.trimEnd());
        };
        let batchIdx = 0;
        let abortProcessing = false;
        const nextBatch = () =>
          !abortProcessing && queue.length ? queue.splice(0, BATCH_SIZE) : null;

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

                const markNeedsReview = async (reason) => {
                  try {
                    await writeNeedsReviewEntries(
                      dir,
                      batch.map((f) => ({ name: path.basename(f), reason }))
                    );
                    for (const file of batch) retrySuppressedNames.add(path.basename(file));
                  } catch {
                    /* ignore */
                  }
                };

                const meta = { model, verbosity, reasoningEffort };
                const reconcileReply = (raw) => {
                  const result = reconcileDecisionFilenames(
                    raw,
                    batch.map((file) => path.basename(file))
                  );
                  for (const repair of result.repairs) {
                    log(
                      `${indent}🔧  Reconciled response filename ${repair.returned} → ${repair.canonical}`
                    );
                  }
                  return result.reply;
                };
                let attemptNum = 1;
                let finalCurators = curators;
                let added = [];
                const prepareFirstRequest = async () => {
                  const names = batch.map((file) => path.basename(file));
                  const peopleLists = await Promise.all(
                    names.map((name) => getPeople(name))
                  );
                  const photos = names.map((name, i) => ({
                    file: name,
                    people: sanitizePeople(peopleLists[i]),
                  }));
                  const finalized = finalizeCurators(curators, photos);
                  finalCurators = finalized.finalCurators;
                  added = finalized.added;
                  if (added.length) {
                    log(
                      `👥  Batch ${idx} additional curators from tags: ${added.join(', ')}`
                    );
                  }
                  const first = await buildPrompt(promptPath, {
                    curators: finalCurators,
                    contextPath,
                    images: batch,
                    hasFieldNotes: false,
                    isSecondPass: false,
                  });
                  await saveText('prompt', attemptNum, first.prompt);
                  return {
                    prompt: first.prompt,
                    promptCachePrefix: first.promptCachePrefix,
                    images: batch,
                    model,
                    curators: finalCurators,
                    baseCuratorCount: curators.length,
                    dynamicCuratorCount: added.length,
                    verbosity,
                    reasoningEffort,
                    minutesMin: first.minutesMin,
                    minutesMax: first.minutesMax,
                    onProgress: (stage) => {
                      bar.update(stageMap[stage] || 0, { stage });
                    },
                    stream: true,
                  };
                };
                const firstResult = provider.supportsDeferredPreparation
                  ? await runSession({ model, prepare: prepareFirstRequest })
                  : await runSession(await prepareFirstRequest());
                reply = firstResult.raw;
                await saveText('response', attemptNum, reply);
                if (looksLikeOpenAIResponseEnvelope(reply)) {
                  const err = new Error('Raw OpenAI response envelope is not a curatorial reply');
                  err.code = 'PROVIDER_ENVELOPE_NOT_DECISIONS';
                  throw err;
                }
                reply = reconcileReply(reply);
                ({ keep, aside, unclassified, notes, minutes } = parseReply(
                  reply,
                  batch,
                  meta
                ));
                if (keep.length + aside.length === 0) {
                  attempts++;
                  if (attempts <= maxStreak) {
                    const repair = [
                      `role play as ${finalCurators.join(", ")}:\n - inidicate who is speaking\n - say what you think`,
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
                    const repairResult = await runSession({
                      prompt: repair,
                      images: batch,
                      model,
                      curators: finalCurators,
                      baseCuratorCount: curators.length,
                      dynamicCuratorCount: added.length,
                      verbosity: "low",
                      reasoningEffort,
                      minutesMin: 0,
                      minutesMax: 0,
                      onProgress: (stage) => {
                        bar.update(stageMap[stage] || 0, { stage });
                      },
                      stream: true,
                    });
                    reply = repairResult.raw;
                    await saveText('response', attemptNum, reply);
                    if (looksLikeOpenAIResponseEnvelope(reply)) {
                      const err = new Error('Raw OpenAI response envelope is not a curatorial reply');
                      err.code = 'PROVIDER_ENVELOPE_NOT_DECISIONS';
                      throw err;
                    }
                    reply = reconcileReply(reply);
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
                    await markNeedsReview("NO_DECISIONS");
                    return;
                  }
                }
                validateDecisionSet({
                  keep,
                  aside,
                  batch,
                  requireComplete: Boolean(firstResult?.json),
                });
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
                await clearNeedsReviewEntries(dir, [...keep, ...aside]);
                  if (unclassified.length && keep.length + aside.length > 0) {
                    queue.push(...unclassified);
                  }
                log(
                  `📂  Moved: ${keep.length} keep → ${keepDir}, ${aside.length} aside → ${asideDir}`
                );

                if (keep.length + aside.length > 0) {
                  completedBatches++;
                  const elapsedSec = (Date.now() - levelStart) / 1000;
                  const remainingNow = (await listLevelState(dir, { retryNeedsReview: false })).eligibleImages.length;
                  const remainingBatchesNow = Math.ceil(remainingNow / BATCH_SIZE);
                  const tps = completedBatches / elapsedSec;
                  const etaSec = tps > 0 ? Math.ceil(remainingBatchesNow / tps) : Infinity;
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
                const safeFailureCodes = new Set([
                  "OPENAI_RESPONSE_INCOMPLETE",
                  "INCOMPLETE_RESPONSE",
                  "OPENAI_RESPONSE_NO_OUTPUT",
                  "NO_ASSISTANT_OUTPUT",
                  "NO_EXTRACTABLE_ASSISTANT_OUTPUT",
                  "PROVIDER_ENVELOPE_NOT_DECISIONS",
                  "INVALID_DECISIONS",
                  "EMPTY_PROVIDER_PAYLOAD",
                ]);
                if (safeFailureCodes.has(err?.code)) {
                  const reason = failureReason(err);
                  try {
                    await writeNeedsReviewEntries(
                      dir,
                      batch.map((f) => ({ name: path.basename(f), reason }))
                    );
                    for (const file of batch) retrySuppressedNames.add(path.basename(file));
                  } catch {
                    /* ignore */
                  }
                  log(`${indent}⚠️  Files left unmoved and added to NEEDS_REVIEW (${reason}).`);
                  return;
                }
                if (isPromptCacheSafetyError(err)) {
                  const alreadyAborting = abortProcessing;
                  abortProcessing = true;
                  queue.length = 0;
                  if (!alreadyAborting) {
                    log(`${indent}🛑  Prompt-cache probe missed; stopping remaining batches to prevent uncached fanout.`);
                  }
                  throw err;
                }
                if (isBillingLimitError(err) && !abortProcessing) {
                  abortProcessing = true;
                  queue.length = 0;
                  log(`${indent}🛑  Billing limit reached; stopping remaining batches.`);
                  throw createBillingLimitError(err);
                }
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
      const nextState = await listLevelState(dir, { retryNeedsReview: false });
      const remaining = nextState.eligibleImages.filter(
        (file) => !retrySuppressedNames.has(path.basename(file))
      ).length;
      const remainingBatches = Math.ceil(remaining / BATCH_SIZE);
      console.log(`${indent}🔎  level drain check: level=${depth + 1} source=${dir} eligible=${remaining}`);
      if (remaining > 0) console.log(`${indent}🔁  level still has eligible files; repeating level=${depth + 1}`);
      if (completedBatches) {
        const elapsedSec = (Date.now() - levelStart) / 1000;
        const tps = completedBatches / elapsedSec;
        const etaSec = tps > 0 ? Math.ceil(remainingBatches / tps) : Infinity;
        console.log(
          `${indent}⏳  ETA to finish level: ${formatDuration(etaSec * 1000)}`
        );
      }
}

  // Step 5 – recurse into keepDir only after a mixed completed level
  if (recurse) {
    const keepDir = path.join(dir, "_keep");
    const asideDir = path.join(dir, "_aside");

    const countImages = async (folder) => {
      try {
        return (await listImages(folder)).length;
      } catch (err) {
        if (err?.code === "ENOENT") return 0;
        throw err;
      }
    };

    const [keepCount, hasDeeperKeep, hasKeep, hasAside] = await Promise.all([
      countImages(keepDir),
      dirExists(path.join(keepDir, "_keep")),
      dirExists(keepDir),
      dirExists(asideDir),
    ]);

    const outcome = evaluateLevelOutcome({
      complete: true,
      hasKeep,
      hasAside,
      levelSize: await countImages(levelDir),
      targetLevelSize,
    });
    const keepHasWork = keepCount > 0 || hasDeeperKeep;
    if (outcome.shouldStop) {
      if (outcome.state === "target_reached") {
        console.log(
          `${indent}🎯  Completed level ${depth + 1} meets target ≤ ${targetLevelSize}; stopping recursion.`
        );
      } else {
        const bucket = outcome.state === "unanimous_keep" ? "kept" : "set aside";
        console.log(`${indent}🎯  All images ${bucket} at this level; stopping recursion.`);
      }
    } else if (keepHasWork) {
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
        update,
        forceRebuild,
        stageConcurrency,
        retryNeedsReview,
        needsReviewRetries,
        targetLevelSize,
      });
    }
  }
  return { blocked: false, blockedCount: 0 };
}
