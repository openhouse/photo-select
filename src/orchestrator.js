import path from "node:path";
import { readPrompt } from "./config.js";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { chatCompletion, parseReply } from "./chatClient.js";

/**
 * Recursively triage images until the current directory is empty
 * or contains only _keep/_aside folders.
 */
export async function triageDirectory({
  dir,
  promptPath,
  model,
  recurse = true,
  depth = 0,
}) {
  const indent = "  ".repeat(depth);
  const prompt = await readPrompt(promptPath);

  console.log(`${indent}📁  Scanning ${dir}`);

  while (true) {
    const images = await listImages(dir);
    if (images.length === 0) {
      console.log(`${indent}✅  Nothing to do in ${dir}`);
      break;
    }

    console.log(`${indent}📊  ${images.length} unclassified image(s) found`);

    // Step 1 – select ≤10
    const batch = pickRandom(images, 10);
    console.log(`${indent}🔍  Selected ${batch.length} image(s)`);

    // Step 2 – ask ChatGPT
    console.log(`${indent}⏳  Sending batch to ChatGPT…`);
    const reply = await chatCompletion({ prompt, images: batch, model });
    console.log(`${indent}🤖  ChatGPT reply:\n${reply}`);

    // Step 3 – parse decisions
    const { keep, aside, notes } = parseReply(reply, batch);

    // Step 4 – move files
    const keepDir = path.join(dir, "_keep");
    const asideDir = path.join(dir, "_aside");
    await Promise.all([
      moveFiles(keep, keepDir, notes),
      moveFiles(aside, asideDir, notes),
    ]);

    console.log(
      `📂  Moved: ${keep.length} keep → ${keepDir}, ${aside.length} aside → ${asideDir}`
    );
  }

  // Step 5 – recurse into keepDir if enabled
  if (recurse) {
    await triageDirectory({
      dir: path.join(dir, "_keep"),
      promptPath,
      model,
      recurse,
      depth: depth + 1,
    });
  }
}
