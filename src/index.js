#!/usr/bin/env node
/** Load environment variables ASAP (before any OpenAI import). */
import "dotenv/config";

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
  .option("--field-notes", "Enable field notes workflow")
  .parse(process.argv);

const { dir, prompt: promptPath, model, recurse, apiKey, curators, context: contextPath, fieldNotes } = program.opts();

if (apiKey) {
  process.env.OPENAI_API_KEY = apiKey;
}

(async () => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "❌  OPENAI_API_KEY is missing. Add it to a .env file or your shell env."
      );
      process.exit(1);
    }
    const absDir = path.resolve(dir);
    const { triageDirectory } = await import("./orchestrator.js");
    await triageDirectory({
      dir: absDir,
      promptPath,
      model,
      recurse,
      curators,
      contextPath,
      fieldNotes,
    });
    console.log("🎉  Finished triaging.");
  } catch (err) {
    console.error("❌  Error:", err);
    process.exit(1);
  }
})();
