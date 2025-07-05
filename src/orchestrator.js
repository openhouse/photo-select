import path from "node:path";
import { writeFile, mkdir, stat, copyFile } from "node:fs/promises";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { chatCompletion, parseReply } from "./chatClient.js";
import { FieldNotesWriter } from "./fieldNotes.js";

/**
 * Recursively triage images until the current directory is empty
 * or contains only _keep/_aside folders.
 */
export async function triageDirectory({
  dir,
  prompt,
  model,
  recurse = true,
  curators = [],
  depth = 0,
}) {
  const indent = "  ".repeat(depth);

  console.log(`${indent}📁  Scanning ${dir}`);

  // Archive original images at this level
  const levelDir = path.join(dir, `_level-${String(depth + 1).padStart(3, '0')}`);
  const initImages = await listImages(dir);
  const promptsDir = path.join(levelDir, 'prompts');
  const repliesDir = path.join(levelDir, 'replies');
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

  if (showPrompt) {
    console.log(`${indent}📑  Prompt:\n${prompt}`);
  }

  console.log(`${indent}📁  Scanning ${dir}`);

  // Archive original images at this level
  try {
    await stat(levelDir);
  } catch {
    // ignore
  }
  await mkdir(levelDir, { recursive: true });
  await mkdir(promptsDir, { recursive: true });
  await mkdir(repliesDir, { recursive: true });
  if (initImages.length) {
    await Promise.all(
      initImages.map((file) =>
        copyFile(file, path.join(levelDir, path.basename(file)))
      )
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
    const ts = Date.now();
    await writeFile(path.join(promptsDir, `${ts}.prompt.txt`), prompt, 'utf8');
    const reply = await chatCompletion({
>>>>>>> 0890d84fef0310c2fe9bb5c155815202b945b78d
      prompt,
      images: batch,
      model,
      curators,
    });
    await writeFile(path.join(repliesDir, `${ts}.raw.json`), reply, 'utf8');
    console.log(`${indent}🤖  ChatGPT reply:\n${reply}`);

<<<<<<< HEAD
    let parsed;
    try {
      // Step 3 – parse decisions. Missing field_notes keys break the two-pass workflow.
=======
    // Step 3 – parse decisions
    let parsed;
    try {
      parsed = parseReply(reply, batch, {
        expectFieldNotesDiff: fieldNotes,
      });
    } catch (err) {
      console.warn(`${indent}Failed to parse reply: ${err.message}`);
      continue;
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
          if (showPrompt) {
            console.log(`${indent}📑  Second-pass prompt:\n${secondPrompt}`);
          }
          await writeFile(path.join(promptsDir, `${ts}-second.prompt.txt`), secondPrompt, 'utf8');
          const second = await chatCompletion({
            prompt: secondPrompt,
            images: batch,
            model,
            curators,
          });
          await writeFile(path.join(repliesDir, `${ts}-second.raw.json`), second, 'utf8');
          let parsed;
          try {
            parsed = parseReply(second, batch, {
              expectFieldNotesMd: true,
            });
          } catch (err) {
            console.warn(`${indent}Failed to parse second-pass reply: ${err.message}`);
            continue;
          }
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
        prompt,
        model,
        recurse,
        curators,
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
