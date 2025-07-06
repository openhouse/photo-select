import path from "node:path";
import { readFile, writeFile, mkdir, stat, copyFile } from "node:fs/promises";
import crypto from "node:crypto";
import { readPrompt } from "./config.js";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { chatCompletion, parseReply } from "./chatClient.js";
import { MultiBar, Presets } from "cli-progress";

function formatDuration(ms) {
  const sec = Math.round(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}h ${m}m ${s}s`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

/**
 * Recursively triage images until the current directory is empty
 * or contains only _keep/_aside folders.
 *
 * @param {Object} options
 * @param {string} options.dir    Directory of images to triage
 * @param {string} options.promptPath   Path to the base prompt
 * @param {string} options.model        OpenAI model id
 * @param {boolean} [options.recurse=true]  Whether to descend into _keep folders
 * @param {string[]} [options.curators=[]]   Names inserted into the prompt
 * @param {string} [options.contextPath]     Optional additional context file
 * @param {number} [options.parallel=1]      Number of API requests to run simultaneously
 * @param {number} [options.depth=0]         Internal recursion depth (for logging)
*/
export async function triageDirectory({
  dir,
  promptPath,
  model,
  recurse = true,
  curators = [],
  contextPath,
  parallel = 1,
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
  const levelStart = Date.now();
  const totalImages = initImages.length;
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

    // Step 1 – select up to parallel × 10 images
    const total = Math.min(images.length, parallel * 10);
    const selection = pickRandom(images, total);
    console.log(`${indent}🔍  Selected ${selection.length} image(s)`);

    const batches = [];
    for (let i = 0; i < selection.length; i += 10) {
      batches.push(selection.slice(i, i + 10));
    }

    console.log(`${indent}⏳  Sending ${batches.length} batch(es) to ChatGPT…`);

    const multibar = new MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format: `${indent}{prefix} |{bar}| {stage}`,
      },
      Presets.shades_classic
    );
    const stageMap = { encoding: 1, request: 2, waiting: 3, done: 4 };
    const bars = batches.map((_, i) =>
      multibar.create(4, 0, { prefix: `Batch ${i + 1}`, stage: "queued" })
    );

    await Promise.all(
      batches.map(async (batch, idx) => {
        const bar = bars[idx];
        try {
          const start = Date.now();
          const reply = await chatCompletion({
            prompt,
            images: batch,
            model,
            curators,
            onProgress: (stage) => {
              bar.update(stageMap[stage] || 0, { stage });
            },
          });
          const ms = Date.now() - start;
          bar.update(4, { stage: "done" });
          bar.stop();
          console.log(`${indent}🤖  ChatGPT reply:\n${reply}`);
          console.log(`${indent}⏱️  Batch ${idx + 1} completed in ${(ms / 1000).toFixed(1)}s`);

          const { keep, aside, notes, minutes } = parseReply(reply, batch);
          if (minutes.length) {
            const uuid = crypto.randomUUID();
            const minutesFile = path.join(dir, `minutes-${uuid}.txt`);
            await writeFile(minutesFile, minutes.join('\n'), 'utf8');
            console.log(`${indent}📝  Saved meeting minutes to ${minutesFile}`);
          }

          const keepDir = path.join(dir, "_keep");
          const asideDir = path.join(dir, "_aside");
          await Promise.all([
            moveFiles(keep, keepDir, notes),
            moveFiles(aside, asideDir, notes),
          ]);

          console.log(
            `📂  Moved: ${keep.length} keep → ${keepDir}, ${aside.length} aside → ${asideDir}`
          );
        } catch (err) {
          bar.update(4, { stage: "error" });
          bar.stop();
          console.warn(`${indent}⚠️  Batch ${idx + 1} failed: ${err.message}`);
        }
      })
    );
    multibar.stop();
    const remaining = (await listImages(dir)).length;
    const processed = totalImages - remaining;
    if (processed) {
      const elapsed = Date.now() - levelStart;
      const etaMs = (elapsed / processed) * remaining;
      console.log(`${indent}⏳  ETA to finish level: ${formatDuration(etaMs)}`);
    }
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
        parallel,
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
