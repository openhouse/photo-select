#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { triageDirectory } from "./orchestrator.js";
import { DEFAULT_PROMPT_PATH } from "./config.js";

const program = new Command();
program
  .requiredOption("-d, --dir <path>", "Source directory of images")
  .option("-p, --prompt <file>", "Custom prompt file", DEFAULT_PROMPT_PATH)
  .option("-m, --model <id>", "OpenAI model id", "gpt-4o-mini")
  .parse(process.argv);

const { dir, prompt: promptPath, model } = program.opts();

(async () => {
  try {
    const absDir = path.resolve(dir);
    await triageDirectory({ dir: absDir, promptPath, model });
    console.log("🎉  Finished triaging.");
  } catch (err) {
    console.error("❌  Error:", err);
    process.exit(1);
  }
})();
