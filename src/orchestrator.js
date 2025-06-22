import path from "node:path";
import { readPrompt } from "./config.js";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { chatCompletion, parseReply } from "./chatClient.js";

/**
 * Recursively triage images until the current directory is empty
 * or contains only _keep/_aside folders.
 */
export async function triageDirectory({ dir, promptPath, model, recurse = true }) {
  const prompt = await readPrompt(promptPath);

  let images = await listImages(dir);
  if (images.length === 0) {
    console.log(`✅  Nothing to do in ${dir}`);
    return;
  }

  // Step 1 – select ≤10
  const batch = pickRandom(images, 10);
  console.log(`🔍  Selected ${batch.length} image(s) in ${path.basename(dir)}`);

  // Step 2 – ask ChatGPT
  const reply = await chatCompletion({ prompt, images: batch, model });
  console.log("🤖  ChatGPT reply:\n", reply);

  // Step 3 – parse decisions
  const { keep, aside } = parseReply(reply, batch);

  // Step 4 – move files
  const keepDir = path.join(dir, "_keep");
  const asideDir = path.join(dir, "_aside");
  await Promise.all([moveFiles(keep, keepDir), moveFiles(aside, asideDir)]);

  console.log(
    `📂  Moved: ${keep.length} keep → ${keepDir}, ${aside.length} aside → ${asideDir}`
  );

  // Step 5 – recurse into keepDir if enabled
  if (recurse) {
    await triageDirectory({ dir: keepDir, promptPath, model, recurse });
  }
}
