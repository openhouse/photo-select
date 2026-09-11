#!/usr/bin/env node
/** Load environment variables ASAP (before any OpenAI import). */
import "dotenv/config";
import "./errorHandler.js";

import { Command } from "commander";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { openSync, writeSync, closeSync } from "node:fs";
import { DEFAULT_PROMPT_PATH } from "./templates.js";
import { configureHttpFromEnv, closeDispatcher } from "./net.js";
import { scheduler } from "./scheduler.js";
import { parsePositiveInteger } from "./core/parsePositiveInteger.js";

if (process.argv.some(arg => /^(?:--knowledge-(?:live|discover|research-only)|--github-all)(=|$)/.test(arg)) && !process.argv.includes('--help')) {
  const { reuseRepositoryEnvironment } = await import('./knowledgeRun.js');
  await reuseRepositoryEnvironment();
}

function parseEnvFlag(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (/^(1|true|yes|on)$/i.test(String(value))) return true;
  if (/^(0|false|no|off)$/i.test(String(value))) return false;
  return fallback;
}

const disablePhotoFilterDefault = parseEnvFlag(
  process.env.PHOTO_SELECT_DISABLE_PEOPLE,
  false
);

const program = new Command();
program
  .name("photo-select")
  .description("Randomly triage photos with ChatGPT")
  .option("-d, --dir <path>", "Source directory of images", process.cwd())
  .option("-p, --prompt <file>", "Custom prompt file", DEFAULT_PROMPT_PATH)
  .option(
    "--provider <name>",
    "openai or ollama",
    process.env.PHOTO_SELECT_PROVIDER || "openai"
  )
  .option(
    "-m, --model <id>",
    "Model id (OpenAI or Ollama)",
    process.env.PHOTO_SELECT_MODEL
  )
  .option(
    "-k, --api-key <key>",
    "OpenAI API key",
    process.env.OPENAI_API_KEY
  )
  .option(
    "--ollama-base-url <url>",
    "Base URL for Ollama",
    process.env.OLLAMA_BASE_URL || "http://localhost:11434"
  )
  .option(
    "-c, --curators <names>",
    "Comma-separated list of curator names",
    (value) => value.split(',').map((n) => n.trim()).filter(Boolean),
    []
  )
  .option(
    "-x, --context <file>",
    "Text file with exhibition context for the curators"
  )
  .option(
    "--verbosity <level>",
    "LLM verbosity (low|medium|high)",
    process.env.PHOTO_SELECT_VERBOSITY || "high"
  )
  .option(
    "--reasoning-effort <level>",
    "Reasoning effort (minimal|low|medium|high|xhigh|auto)",
    process.env.PHOTO_SELECT_REASONING_EFFORT
  )
  .option("--no-recurse", "Process a single directory only")
  .option(
    "--target-level-size <n>",
    "Continue until a completed level contains at most N photos",
    parsePositiveInteger
  )
  .option(
    "--retry-needs-review",
    "Automatically retry files listed in NEEDS_REVIEW",
    parseEnvFlag(process.env.PHOTO_SELECT_RETRY_NEEDS_REVIEW, false)
  )
  .option(
    "--needs-review-retries <n>",
    "Maximum automatic repair passes per level",
    parsePositiveInteger,
    process.env.PHOTO_SELECT_NEEDS_REVIEW_RETRIES
      ? parsePositiveInteger(process.env.PHOTO_SELECT_NEEDS_REVIEW_RETRIES)
      : 2
  )
  .option(
    "-P, --parallel <n>",
    "Number of concurrent API calls (deprecated; use --workers)",
    (v) => Math.max(1, parseInt(v, 10))
  )
  .option("--field-notes", "Enable field notes workflow")
  .option("--github-all", "Let the curatorial model read all accessible GitHub repositories live through your private tunnel")
  .option("--knowledge-live [profile]", "Explore current knowledge repositories automatically; optional private JSON profile")
  .option("--knowledge-brief <text>", "Describe the photo project inline; no context file needed")
  .option("--knowledge-discover", "Refresh the knowledge repository/branch catalog without model requests or photo changes")
  .option("--knowledge-research-only", "Save live research without starting photo curation")
  .option("-v, --verbose", "Print extra logs")
  .option(
    "--save-io",
    "Save full prompts and responses for debugging"
  )
  .option(
    "--update [bool]",
    "Idempotent archive (skip unchanged files)",
    (value) => parseEnvFlag(value, true),
    true
  )
  .option("--force-rebuild", "Ignore manifest; rebuild archive")
  .option(
    "--stage-concurrency <n>",
    "Maximum concurrent archive clones",
    (v) => Math.max(1, parseInt(v, 10))
  )
  .option(
    "--workers <n>",
    "Number of worker processes (each runs batches sequentially)",
    (v) => Math.max(1, parseInt(v, 10))
  )
  .option(
    "--adaptive-workers",
    "Dynamically tune OpenAI request concurrency; --workers is the ceiling",
    parseEnvFlag(process.env.PHOTO_SELECT_ADAPTIVE_WORKERS, false)
  )
  .option(
    "--adaptive-min-workers <n>",
    "Minimum request concurrency while adaptive workers are enabled",
    parsePositiveInteger,
    process.env.PHOTO_SELECT_ADAPTIVE_MIN_WORKERS
      ? parsePositiveInteger(process.env.PHOTO_SELECT_ADAPTIVE_MIN_WORKERS)
      : 1
  )
  .option(
    "--concurrency <n>",
    "Maximum in-flight OpenAI requests",
    (v) => Math.max(1, parseInt(v, 10))
  )
  .option(
    "--disable-photo-filter",
    "Disable photo-filter API lookups for this job",
    disablePhotoFilterDefault
  )
  .option(
    "--refresh-people-index",
    "Force one verified rebuild of Photo Filter's people index",
    parseEnvFlag(process.env.PHOTO_SELECT_REFRESH_PEOPLE_INDEX, false)
  )
  .parse(process.argv);

let {
  dir,
  prompt: promptPath,
  provider: providerName,
  model,
  recurse,
  apiKey,
  curators,
  context: contextPath,
  parallel,
  fieldNotes,
  verbose,
  saveIo,
  update,
  forceRebuild,
  stageConcurrency,
  workers,
  verbosity,
  reasoningEffort,
  ollamaBaseUrl,
  concurrency: concurrencyFlag,
  disablePhotoFilter,
  retryNeedsReview,
  needsReviewRetries,
  targetLevelSize,
  adaptiveWorkers,
  adaptiveMinWorkers,
  refreshPeopleIndex,
  knowledgeLive, knowledgeDiscover, knowledgeResearchOnly, knowledgeBrief, githubAll,
} = program.opts();
const liveEnabled = Boolean(knowledgeLive || knowledgeDiscover || knowledgeResearchOnly);
const privateEnabled = liveEnabled || githubAll;
const liveAbort = new AbortController();
if (githubAll && liveEnabled) program.error("Use --github-all by itself; --knowledge-live is the separate research-first mode.");
if (githubAll && !["openai", "openai-batch"].includes(providerName)) program.error("--github-all supports openai and openai-batch.");
if (knowledgeBrief && !privateEnabled) program.error("--knowledge-brief requires --knowledge-live.");
if (liveEnabled && providerName !== "openai") program.error("Live knowledge requires --provider openai; batch and Ollama are not supported yet.");
if (liveEnabled && program.getOptionValueSource("prompt") === "cli") program.error("Live knowledge uses its source-aware prompt; omit --prompt.");

if (program.getOptionValueSource && program.getOptionValueSource('parallel')) {
  const n = Number(parallel) || 1;
  if (!workers) workers = n;
  console.warn('[DEPRECATION] --parallel is deprecated; using --workers=%d\n', workers);
}
if (!workers) workers = 1;
if (adaptiveWorkers && adaptiveMinWorkers > workers) {
  program.error("--adaptive-min-workers cannot exceed --workers");
}
if (adaptiveWorkers) {
  process.env.PHOTO_SELECT_ADAPTIVE_WORKERS = "1";
  process.env.PHOTO_SELECT_ADAPTIVE_MIN_WORKERS = String(adaptiveMinWorkers);
  process.env.PHOTO_SELECT_ADAPTIVE_MAX_WORKERS = String(workers);
}

const envConc = Number(process.env.CONCURRENCY);
const envWorkers = Number(process.env.WORKERS);
if (!workers && Number.isFinite(envWorkers)) workers = envWorkers;
let concurrency = Number.isFinite(envConc)
  ? envConc
  : Number.isFinite(concurrencyFlag)
  ? concurrencyFlag
  : workers;
if (!Number.isFinite(concurrency) || concurrency <= 0) concurrency = 6;

// Scale transport, filesystem, and batching with worker count
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const maxSockets = clamp(workers * 2 + 2, 8, 64);
const maxFreeSockets = clamp(Math.ceil(maxSockets / 2), 4, 32);
process.env.UNDICI_CONNECTIONS = String(maxSockets);
process.env.UNDICI_KEEPALIVE_MS = "10000";
process.env.UNDICI_FREE_TIMEOUT_MS = "60000";
process.env.PHOTO_SELECT_MAX_SOCKETS = String(maxSockets);
process.env.PHOTO_SELECT_MAX_FREE_SOCKETS = String(maxFreeSockets);
process.env.PHOTO_SELECT_KEEPALIVE_MS = "10000";
process.env.PHOTO_SELECT_FREE_SOCKET_TIMEOUT_MS = "60000";
process.env.PHOTO_SELECT_RETRY_BASE_MS = String(500 + 50 * workers);
process.env.UV_THREADPOOL_SIZE = String(Math.min(64, 8 + 4 * workers));
process.env.PHOTO_SELECT_BATCH_SIZE = String(
  clamp(8 + Math.floor(workers / 2), 8, 10)
);
process.env.PHOTO_SELECT_PEOPLE_CONCURRENCY = String(
  clamp(2 * workers, 2, 16)
);
process.env.PHOTO_SELECT_BUMP_TOKENS = String(
  Math.min(4000 + 500 * (workers - 1), 8000)
);

const undiciConnections = Number(process.env.UNDICI_CONNECTIONS) || maxSockets;
scheduler.setConcurrency(Math.min(concurrency, undiciConnections));
console.log(
  `⚙️  workers=${workers} concurrency=${concurrency} undici_connections=${undiciConnections}`
);
if (adaptiveWorkers) {
  console.log(`⚙️  adaptive=on range=${adaptiveMinWorkers}..${workers}`);
}

let shuttingDown = false;
async function handleSignal(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (privateEnabled) { liveAbort.abort(); return; }
  console.log(`\n🛑  received ${sig}, shutting down…`);
  scheduler.setConcurrency(0);
  await scheduler.waitForIdle().catch(() => {});
  await closeDispatcher().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', handleSignal);
process.on('SIGTERM', handleSignal);

// Early bootstrap log (helps confirm the process is alive).
if (process.env.PHOTO_SELECT_VERBOSE === '1') {
  console.log(`🔧 bootstrap: node=${process.version} workers=${workers} dir=${process.cwd()}`);
}

// Configure HTTP dispatcher only if explicitly enabled.
// This is async but we don't block startup on it.
void configureHttpFromEnv();

if (verbose) {
  process.env.PHOTO_SELECT_VERBOSE = '1';
}

if (apiKey) {
  process.env.OPENAI_API_KEY = apiKey;
}
if (ollamaBaseUrl) {
  process.env.OLLAMA_BASE_URL = ollamaBaseUrl;
}
if (disablePhotoFilter) {
  process.env.PHOTO_SELECT_DISABLE_PEOPLE = '1';
}

const provider = providerName || 'openai';
let finalModel = model;
if (!finalModel) {
  finalModel = provider === 'ollama' ? 'qwen2.5vl:32b' : 'gpt-4o';
}

let finalReasoningEffort = reasoningEffort?.toLowerCase();
if (!finalReasoningEffort) {
  finalReasoningEffort = /^gpt-5/.test(finalModel) ? 'low' : 'minimal';
}
process.env.PHOTO_SELECT_USER_EFFORT = finalReasoningEffort;

(async () => {
  let liveRun;
  try {
    if (privateEnabled) {
      const { reuseRepositoryEnvironment } = await import('./knowledgeRun.js');
      await reuseRepositoryEnvironment();
    }
    if ((provider === 'openai' || githubAll) && !process.env.OPENAI_API_KEY && !knowledgeDiscover) {
      console.error(
        '❌  OPENAI_API_KEY is missing. Add it to a .env file or your shell env.'
      );
      process.exit(1);
    }
    let absDir = path.resolve(dir);
    let restoreOutput = () => {};
    if (privateEnabled) {
      const brief = [knowledgeBrief, contextPath ? await readFile(path.resolve(contextPath), 'utf8') : undefined].filter(Boolean).join('\n\n') || undefined;
      if (githubAll) {
        const { startGithubRun } = await import('./githubRun.js');
        liveRun = await startGithubRun({source:absDir,brief,curators,provider,signal:liveAbort.signal,progress:line=>console.log(line)});
      } else {
      const { startLiveKnowledge, loadLiveProfile } = await import('./knowledgeRun.js');
      const profile = await loadLiveProfile(knowledgeLive || true);
      liveRun = await startLiveKnowledge({profile, source:absDir, brief, model:finalModel,
        discoverOnly:knowledgeDiscover, researchOnly:knowledgeResearchOnly, signal:liveAbort.signal, progress:line=>console.log(line)});
      if (knowledgeDiscover || knowledgeResearchOnly) { console.log(`knowledge: saved ${liveRun.root}`); return; }
      }
      absDir = liveRun.images; contextPath = undefined; curators = [...liveRun.provider.curators]; promptPath = githubAll ? promptPath : liveRun.provider.promptPath;
      if(!githubAll)process.env.PHOTO_SELECT_DISABLE_PEOPLE = '1';
      process.umask(0o077);
      if(!githubAll)process.chdir(liveRun.root);
      const fd=openSync(path.join(liveRun.root,'runtime.log'),'a',0o600);
      const stdout=process.stdout.write, stderr=process.stderr.write;
      const privateWrite=(stream,original)=>(chunk,encoding,callback)=>{
        const bytes=typeof chunk==='string'?Buffer.from(chunk,typeof encoding==='string'?encoding:'utf8'):chunk;
        writeSync(fd,bytes);
        if(verbose)return original.call(stream,chunk,encoding,callback);
        if(typeof encoding==='function')encoding();else callback?.();
        return true;
      };
      process.stdout.write=privateWrite(process.stdout,stdout);
      process.stderr.write=privateWrite(process.stderr,stderr);
      restoreOutput=()=>{process.stdout.write=stdout;process.stderr.write=stderr;closeSync(fd);};
    }
    try {
    const { triageDirectory } = await import('./orchestrator.js');
    const { getProvider } = await import('./providers/index.js');
    const driver = liveRun?.provider || await getProvider(provider);
    await triageDirectory({
      dir: absDir,
      promptPath,
      provider: driver,
      model: finalModel,
      recurse,
      curators,
      contextPath,
      fieldNotes,
      verbose,
      saveIo,
      update,
      forceRebuild,
      stageConcurrency,
      workers,
      verbosity,
      reasoningEffort: finalReasoningEffort,
      retryNeedsReview,
      needsReviewRetries,
      targetLevelSize,
      refreshPeopleIndex,
    });
    } finally { restoreOutput(); await liveRun?.stop?.(); }
    console.log(liveRun ? `knowledge: curation and field notes saved in ${liveRun.root}` : "🎉  Finished triaging.");
  } catch (err) {
    if (privateEnabled) { console.error("knowledge: held — " + (err?.code === "KNOWLEDGE_HELD" ? err.message : "Check the private run and your input configuration.")); process.exitCode = liveAbort.signal.aborted ? 130 : 1; return; }
    if (err?.code === "BILLING_LIMIT") {
      console.error(
        `⏸️  OpenAI API credits exhausted. Run paused${
          Number.isInteger(err?.remainingImages)
            ? ` with ${err.remainingImages} image(s) remaining`
            : ""
        }; completed work was preserved.`
      );
      console.error("   Add credits, then rerun the same command to resume.");
      if (process.env.PHOTO_SELECT_VERBOSE === "1" && err?.cause) {
        console.error("  ↳ cause:", err.cause);
      }
      process.exitCode = err?.exitCode || 75;
      return;
    }
    console.error("❌  Error:", err);
    process.exit(1);
  } finally { await liveRun?.stop?.(); }
})();
