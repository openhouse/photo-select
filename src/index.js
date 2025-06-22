#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { DEFAULT_PROMPT_PATH } from "./config.js";

const program = new Command();
program
  .name("photo-select")
  .description("Randomly triage photos with ChatGPT")
  .option("-d, --dir <path>", "Source directory of images", process.cwd())
  .option("-p, --prompt <file>", "Custom prompt file", DEFAULT_PROMPT_PATH)
  .option(
    "-m, --model <id>",
    "OpenAI model id",
    process.env.PHOTO_SELECT_MODEL || "gpt-4o"
  )
  .option(
    "-k, --api-key <key>",
    "OpenAI API key",
    process.env.OPENAI_API_KEY
  )
  .option("--no-recurse", "Process a single directory only")
  .parse(process.argv);

const { dir, prompt: promptPath, model, recurse, apiKey } = program.opts();

if (apiKey) {
  process.env.OPENAI_API_KEY = apiKey;
}

(async () => {
  try {
    const absDir = path.resolve(dir);
    const { triageDirectory } = await import("./orchestrator.js");
    await triageDirectory({ dir: absDir, promptPath, model, recurse });
    console.log("🎉  Finished triaging.");
  } catch (err) {
    console.error("❌  Error:", err);
    process.exit(1);
  }
})();
