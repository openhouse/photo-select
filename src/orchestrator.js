import path from "node:path";
import { writeFile } from "node:fs/promises";
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
  curators = [],
  contextPath,
  depth = 0,
}) {
  const indent = "  ".repeat(depth);
  let prompt = await readPrompt(promptPath);
  if (contextPath) {
    try {
      const { readFile } = await import('node:fs/promises');
      const context = await readFile(contextPath, 'utf8');
      prompt += `\n\nCurator FYI:\n${context}`;
    } catch (err) {
      console.warn(`Could not read context file ${contextPath}: ${err.message}`);
    }
  }
  if (curators.length) {
    const names = curators.join(', ');
    prompt = prompt.replace(/\{\{curators\}\}/g, names);
  }

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
    const reply = await chatCompletion({
      prompt,
      images: batch,
      model,
      curators,
    });
    console.log(`${indent}🤖  ChatGPT reply:\n${reply}`);

    // Step 3 – parse decisions
    const { keep, aside, notes, minutes } = parseReply(reply, batch);
    if (minutes.length) {
      const minutesFile = path.join(dir, `minutes-${Date.now()}.txt`);
      await writeFile(minutesFile, minutes.join('\n'), 'utf8');
      console.log(`${indent}📝  Saved meeting minutes to ${minutesFile}`);
    }

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

  // Step 5 – recurse into keepDir only if both groups exist
  if (recurse) {
    const keepDir = path.join(dir, "_keep");
    const asideDir = path.join(dir, "_aside");
    const keepCount = (await listImages(keepDir).catch(() => [])).length;
    const asideCount = (await listImages(asideDir).catch(() => [])).length;

    if (keepCount > 0 && asideCount > 0) {
      await triageDirectory({
        dir: keepDir,
        promptPath,
        model,
        recurse,
        curators,
        depth: depth + 1,
      });
    }
  }
}
