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
  .option("--no-recurse", "Process a single directory only")
  .option("-P, --parallel <n>", "Number of concurrent API calls", (v) => Math.max(1, parseInt(v, 10)), 1)
  .option("--field-notes", "Enable field notes workflow")
  .option("-v, --verbose", "Store prompts and responses for debugging")
  .parse(process.argv);

const {
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
  ollamaBaseUrl,
} = program.opts();

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
      parallel,
      fieldNotes,
      verbose,
    });
    console.log("🎉  Finished triaging.");
  } catch (err) {
    console.error("❌  Error:", err);
    process.exit(1);
  }
})();
