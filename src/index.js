#!/usr/bin/env node
/** Load environment variables ASAP (before any OpenAI import). */
import "dotenv/config";
import "./errorHandler.js";

import { Command } from "commander";
import path from "node:path";
import { DEFAULT_PROMPT_PATH } from "./templates.js";


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
    "Reasoning effort (minimal|low|medium|high)",
    process.env.PHOTO_SELECT_REASONING_EFFORT
  )
  .option("--no-recurse", "Process a single directory only")
  .option(
    "-P, --parallel <n>",
    "Number of concurrent API calls (deprecated; use --workers)",
    (v) => Math.max(1, parseInt(v, 10))
  )
  .option("--field-notes", "Enable field notes workflow")
  .option("-v, --verbose", "Store prompts and responses for debugging")
  .option(
    "--workers <n>",
    "Number of worker processes (each runs batches sequentially)",
    (v) => Math.max(1, parseInt(v, 10))
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
  workers,
  verbosity,
  reasoningEffort,
  ollamaBaseUrl,
} = program.opts();

if (program.getOptionValueSource && program.getOptionValueSource('parallel')) {
  const n = Number(parallel) || 1;
  if (!workers) workers = n;
  console.warn('[DEPRECATION] --parallel is deprecated; using --workers=%d\n', workers);
}
if (!workers) workers = 1;

// Scale transport, filesystem, and batching with worker count
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const maxSockets = clamp(workers * 2 + 2, 8, 64);
const maxFreeSockets = clamp(Math.ceil(maxSockets / 2), 4, 32);
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

if (verbose) {
  process.env.PHOTO_SELECT_VERBOSE = '1';
}

if (apiKey) {
  process.env.OPENAI_API_KEY = apiKey;
}
if (ollamaBaseUrl) {
  process.env.OLLAMA_BASE_URL = ollamaBaseUrl;
}

const provider = providerName || 'openai';
let finalModel = model;
if (!finalModel) {
  finalModel = provider === 'ollama' ? 'qwen2.5vl:32b' : 'gpt-4o';
}

let finalReasoningEffort = reasoningEffort;
if (!finalReasoningEffort) {
  finalReasoningEffort = /^gpt-5/.test(finalModel) ? 'low' : 'minimal';
}
process.env.PHOTO_SELECT_USER_EFFORT = finalReasoningEffort;

(async () => {
  try {
    if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
      console.error(
        '❌  OPENAI_API_KEY is missing. Add it to a .env file or your shell env.'
      );
      process.exit(1);
    }
    const absDir = path.resolve(dir);
    const { triageDirectory } = await import('./orchestrator.js');
    const { getProvider } = await import('./providers/index.js');
    const driver = await getProvider(provider);
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
      workers,
      verbosity,
      reasoningEffort: finalReasoningEffort,
    });
    console.log("🎉  Finished triaging.");
  } catch (err) {
    console.error("❌  Error:", err);
    process.exit(1);
  }
})();
