import path from "node:path";
import { readFile, writeFile, mkdir, stat, copyFile } from "node:fs/promises";
import { renderTemplate } from "./config.js";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { chatCompletion, parseReply } from "./chatClient.js";
import { FieldNotesWriter } from "./fieldNotes.js";
import { sha256 } from "./hash.js";

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
  fieldNotes = false,
  showPrompt,
  depth = 0,
}) {
  const indent = "  ".repeat(depth);
  let context = "";
  if (contextPath) {
    try {
      context = await readFile(contextPath, 'utf8');
    } catch (err) {
      console.warn(`Could not read context file ${contextPath}: ${err.message}`);
    }
  }

  const levelDir = path.join(dir, `_level-${String(depth + 1).padStart(3, '0')}`);
  const initImages = await listImages(dir);
  let levelExists = false;
  try {
    levelExists = (await stat(levelDir)).isDirectory();
  } catch {
    /* ignore */
  }
  let notesWriter;
  let fieldNotesText = "";
  if (fieldNotes) {
    notesWriter = new FieldNotesWriter(path.join(levelDir, 'field-notes.md'));
    await notesWriter.init();
    const existing = await notesWriter.read();
    if (existing) fieldNotesText = existing;
  }

  const names = curators.join(', ');
  let prompt = await renderTemplate(promptPath, {
    curators: names,
    context,
    fieldNotes: fieldNotesText,
  });
  let basePrompt = prompt;
  if (fieldNotes) {
    const addonPath = new URL('../prompts/field_notes_addon.txt', import.meta.url).pathname;
    try {
      const addon = await readFile(addonPath, 'utf8');
      prompt += `\n${addon}`;
    } catch (err) {
      console.warn(`Could not read field notes addon: ${err.message}`);
    }
  }

  // Snapshot the prompt to reproduce this batch later.
  // Storing `.prompt.txt` allows us to rerun the exact call.
  await mkdir(levelDir, { recursive: true });
  await writeFile(path.join(levelDir, '.prompt.txt'), prompt, 'utf8');

  if (showPrompt) {
    if (showPrompt === 'hash') {
      console.log(`${indent}📑  Prompt hash ${sha256(prompt)}`);
    } else if (showPrompt === 'preview') {
      const lines = prompt.split('\n');
      const preview = lines.slice(0, 100).join('\n');
      const truncated = lines.length > 100 ? '\n...<truncated>...' : '';
      console.log(`${indent}📑  Prompt preview:\n${preview}${truncated}`);
      console.log(`${indent}📑  Prompt hash ${sha256(prompt)}`);
    } else {
      console.log(`${indent}📑  Prompt:\n${prompt}`);
    }
  }

  console.log(`${indent}📁  Scanning ${dir}`);

  // Archive original images at this level when directory didn't exist
  if (!levelExists && initImages.length) {
    await Promise.all(
      initImages.map((file) => copyFile(file, path.join(levelDir, path.basename(file))))
    );
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
    let reply = await chatCompletion({
      prompt,
      images: batch,
      model,
      curators,
    });
    console.log(`${indent}🤖  ChatGPT reply:\n${reply}`);

    let parsed;
    try {
      // Step 3 – parse decisions. Missing field_notes keys break the two-pass workflow.
      parsed = parseReply(reply, batch, {
        expectFieldNotesDiff: fieldNotes,
      });
    } catch (err) {
      if (/field_notes_/.test(err.message)) {
        // Retry once asking the model to regenerate with all keys.
        const retryPrompt = `${prompt}\nPrevious response omitted required keys—regenerate.`;
        reply = await chatCompletion({
          prompt: retryPrompt,
          images: batch,
          model,
          curators,
        });
        console.log(`${indent}🤖  Retry reply:\n${reply}`);
        parsed = parseReply(reply, batch, {
          expectFieldNotesDiff: fieldNotes,
        });
      } else {
        throw err;
      }
    }
    const { keep, aside, notes, minutes, fieldNotesDiff, fieldNotesMd } = parsed;
    if (minutes.length) {
      const minutesFile = path.join(dir, `minutes-${Date.now()}.txt`);
      await writeFile(minutesFile, minutes.join('\n'), 'utf8');
      console.log(`${indent}📝  Saved meeting minutes to ${minutesFile}`);
    }

    if (notesWriter && (fieldNotesDiff || fieldNotesMd)) {
      try {
        if (fieldNotesMd) {
          await notesWriter.writeFull(fieldNotesMd);
        } else {
          const existing = (await notesWriter.read()) || '';
          const secondPrompt = await renderTemplate(
            new URL('../prompts/field_notes_second_pass.hbs', import.meta.url).pathname,
            { prompt: basePrompt, existing, diff: fieldNotesDiff }
          );

          // Snapshot second-pass prompt for reproducibility
          await mkdir(levelDir, { recursive: true });
          await writeFile(path.join(levelDir, '.prompt.second.txt'), secondPrompt, 'utf8');

          if (showPrompt) {
            if (showPrompt === 'hash') {
              console.log(`${indent}📑  Second-pass hash ${sha256(secondPrompt)}`);
            } else if (showPrompt === 'preview') {
              const lines2 = secondPrompt.split('\n');
              const prev = lines2.slice(0, 100).join('\n');
              const trunc = lines2.length > 100 ? '\n...<truncated>...' : '';
              console.log(`${indent}📑  Second-pass preview:\n${prev}${trunc}`);
              console.log(`${indent}📑  Second-pass hash ${sha256(secondPrompt)}`);
            } else {
              console.log(`${indent}📑  Second-pass prompt:\n${secondPrompt}`);
            }
          }
          const second = await chatCompletion({
            prompt: secondPrompt,
            images: batch,
            model,
            curators,
          });
          const parsed = parseReply(second, batch, {
            expectFieldNotesMd: true,
          });
          if (parsed.fieldNotesMd) {
            await notesWriter.writeFull(parsed.fieldNotesMd);
          } else {
            console.warn(`${indent}No field_notes_md returned; diff ignored`);
          }
        }
      } catch (err) {
        console.warn(`${indent}Failed to update field notes: ${err.message}`);
      }
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
