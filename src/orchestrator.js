import path from "node:path";
import { readFile, writeFile, mkdir, stat, copyFile } from "node:fs/promises";
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

  // Archive original images at this level
  const levelDir = path.join(dir, `_level-${String(depth + 1).padStart(3, '0')}`);
  const initImages = await listImages(dir);
  try {
    await stat(levelDir);
  } catch {
    if (initImages.length) {
      await mkdir(levelDir, { recursive: true });
      await Promise.all(
        initImages.map((file) =>
          copyFile(file, path.join(levelDir, path.basename(file)))
        )
      );
    }
  }

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

  // Step 5 – recurse into keepDir if both keep and aside exist
  if (recurse) {
    const keepDir = path.join(dir, "_keep");
    const asideDir = path.join(dir, "_aside");
    let keepExists = false;
    try {
      keepExists = (await stat(keepDir)).isDirectory();
    } catch {
      // ignore
    }

    if (keepExists) {
      await triageDirectory({
        dir: keepDir,
        promptPath,
        model,
        recurse,
        curators,
        contextPath,
        depth: depth + 1,
      });
    } else {
      let keepCount = 0;
      let asideCount = 0;
      try {
        keepCount = (await listImages(keepDir)).length;
      } catch {
        // ignore
      }
      try {
        asideCount = (await listImages(asideDir)).length;
      } catch {
        // ignore
      }

      if (keepCount || asideCount) {
        const status = keepCount ? "kept" : "set aside";
        console.log(`${indent}🎯  All images ${status} at this level; stopping recursion.`);
      }
    }
  }
}
