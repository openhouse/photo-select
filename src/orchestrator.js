import path from "node:path";
import { readFile, writeFile, mkdir, stat, copyFile } from "node:fs/promises";
import { batchStore } from "./batchContext.js";
import crypto from "node:crypto";
import { delay } from "./config.js";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { parseReply } from "./chatClient.js";
import { buildPrompt, renderTemplate } from "./templates.js";
import FieldNotesWriter from "./fieldNotesWriter.js";
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
 * @param {Object} options.provider     Chat provider instance
 * @param {string} options.model        Model id for the provider
 * @param {boolean} [options.recurse=true]  Whether to descend into _keep folders
 * @param {string[]} [options.curators=[]]   Names inserted into the prompt
 * @param {string} [options.contextPath]     Optional additional context file
 * @param {number} [options.parallel=1]      Number of API requests to run simultaneously
 * @param {boolean} [options.fieldNotes=false] Enable field notes workflow
 * @param {number} [options.depth=0]         Internal recursion depth (for logging)
*/
export async function triageDirectory({
  dir,
  promptPath,
  provider,
  model,
  recurse = true,
  curators = [],
  contextPath,
  parallel = 1,
  fieldNotes = false,
  depth = 0,
}) {
  if (!provider) {
    const m = await import('./providers/openai.js');
    provider = new m.default();
  }
  const indent = "  ".repeat(depth);
  const addon = fieldNotes
    ? await readFile(
        new URL('../prompts/field_notes_addon.txt', import.meta.url).pathname,
        'utf8'
      )
    : '';
  let notesWriter;

  console.log(`${indent}📁  Scanning ${dir}`);

  // Archive original images at this level
  const levelDir = path.join(dir, `_level-${String(depth + 1).padStart(3, '0')}`);
  if (fieldNotes && !notesWriter) {
    const lvl = String(depth + 1).padStart(3, '0');
    notesWriter = new FieldNotesWriter(
      path.join(levelDir, 'field-notes.md'),
      lvl
    );
    await notesWriter.init();
  }
  const initImages = await listImages(dir);
  const levelStart = Date.now();
  const totalImages = initImages.length;
  let levelExists = true;
  try {
    await stat(levelDir);
  } catch {
    levelExists = false;
  }
  if (!levelExists && initImages.length) {
    await mkdir(levelDir, { recursive: true });
      const failedArchives = [];
      const copyFileSafe = async (
        src,
        dest,
        attempt = 0,
        maxAttempts = 3
      ) => {
        try {
          await copyFile(src, dest);
        } catch (err) {
          if (err?.code === "ECANCELED" && attempt < maxAttempts) {
            const wait = (attempt + 1) * 1000;
            console.warn(
              `${indent}⏳  Waiting for network file ${src} (${wait}ms)…`
            );
            try {
              await stat(src);
            } catch {
              // ignore
            }
            await delay(wait);
            return copyFileSafe(src, dest, attempt + 1, maxAttempts);
          }
          throw err;
        }
      };
      await Promise.all(
        initImages.map(async (file) => {
          const dest = path.join(levelDir, path.basename(file));
          try {
            await copyFileSafe(file, dest);
          } catch (err) {
            failedArchives.push(file);
            console.warn(
              `${indent}⚠️  Failed to archive ${file}: ${err.message}`
            );
          }
        })
      );
      if (failedArchives.length) {
        const listPath = path.join(levelDir, "failed-archives.txt");
        await writeFile(listPath, failedArchives.join("\n"), "utf8");
        console.warn(
          `${indent}⚠️  ${failedArchives.length} file(s) failed to archive; see ${listPath}`
        );
      }
    }

  if (fieldNotes && !notesWriter) {
    const lvl = String(depth + 1).padStart(3, '0');
    notesWriter = new FieldNotesWriter(
      path.join(levelDir, 'field-notes.md'),
      lvl
    );
    await notesWriter.init();
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

    let nextIndex = 0;
    async function worker() {
      while (true) {
        const idx = nextIndex++;
        if (idx >= batches.length) break;
        const batch = batches[idx];
        const bar = bars[idx];
        await batchStore.run({ batch: idx + 1 }, async () => {
          try {
            const notesText = notesWriter ? await notesWriter.read() : undefined;
            const basePrompt = await buildPrompt(promptPath, {
              curators,
              contextPath,
              images: batch,
              fieldNotes: notesText,
            });
            let prompt = basePrompt;
            if (addon) prompt += `\n${addon}`;
            const start = Date.now();
            const reply = await provider.chat({
              prompt,
              images: batch,
              model,
              curators,
              onProgress: (stage) => {
                bar.update(stageMap[stage] || 0, { stage });
              },
              stream: true,
            });
            const ms = Date.now() - start;
            bar.update(4, { stage: "done" });
            bar.stop();
            console.log(`${indent}🤖  ChatGPT reply:\n${reply}`);
            console.log(`${indent}⏱️  Batch ${idx + 1} completed in ${(ms / 1000).toFixed(1)}s`);

            let parsed = parseReply(reply, batch, {
              expectFieldNotesDiff: !!notesWriter,
            });
            const {
              keep,
              aside,
              notes,
              minutes,
              fieldNotesDiff,
              fieldNotesMd,
              fieldNotesMessage,
            } = parsed;
            if (notesWriter && (fieldNotesMd || fieldNotesDiff)) {
              if (fieldNotesMd) {
                await notesWriter.writeFull(fieldNotesMd);
              } else if (fieldNotesDiff) {
                const secondPrompt = await renderTemplate(
                  new URL('../prompts/field_notes_second_pass.hbs', import.meta.url)
                    .pathname,
                  {
                    prompt: basePrompt,
                    existing: notesText,
                    diff: fieldNotesDiff,
                  }
                );
                const second = await provider.chat({
                  prompt: secondPrompt,
                  images: batch,
                  model,
                  curators,
                  stream: true,
                  onProgress: (stage) => {
                    bar.update(stageMap[stage] || 0, { stage });
                  },
                });
                parsed = parseReply(second, batch, { expectFieldNotesMd: true });
                if (parsed.fieldNotesMd) {
                  await notesWriter.writeFull(parsed.fieldNotesMd);
                }
              }
              if (fieldNotesMessage) {
                console.log(`${indent}📓  ${fieldNotesMessage}`);
              }
            }
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
        });
      }
    }

    const workers = Array.from(
      { length: Math.min(parallel, batches.length) },
      () => worker()
    );
    await Promise.all(workers);
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
        provider,
        model,
        recurse,
        curators,
        contextPath,
        parallel,
        fieldNotes,
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
