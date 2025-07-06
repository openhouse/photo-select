import path from "node:path";
import { readFile, writeFile, mkdir, stat, copyFile } from "node:fs/promises";
import { renderTemplate } from "./config.js";
import { buildPrompt } from "./prompt.js";
import { writeStats } from "./stats.js";
import { execSync } from "node:child_process";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { chatCompletion, parseReply } from "./chatClient.js";
import { FieldNotesWriter } from "./fieldNotes.js";

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
  showPrompt = false,
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
  let basePrompt = await renderTemplate(promptPath, {
    curators: names,
    context,
    fieldNotes: fieldNotesText,
    images: [],
  });
  let addon = '';
  if (fieldNotes) {
    const addonPath = new URL('../prompts/field_notes_addon.txt', import.meta.url).pathname;
    try {
      addon = await readFile(addonPath, 'utf8');
    } catch (err) {
      console.warn(`Could not read field notes addon: ${err.message}`);
    }
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
    let prompt = await buildPrompt(promptPath, {
      curators,
      contextPath,
      fieldNotes: fieldNotesText,
      images: batch,
    });
    if (addon) prompt += `\n${addon}`;
    let beforeLines = 0;
    if (notesWriter) {
      const prev = await notesWriter.read();
      beforeLines = prev ? prev.split('\n').length : 0;
    }
    const start = Date.now();
    const ts = Date.now();
    await writeFile(path.join(promptsDir, `${ts}.prompt.txt`), prompt, 'utf8');
    if (showPrompt) {
      console.log(`${indent}📑  Prompt:\n${prompt}`);
    }
    const replyObj = await chatCompletion({
      prompt,
      images: batch,
      model,
      curators,
    });
    const reply = JSON.stringify(replyObj, null, 2);
    await writeFile(path.join(repliesDir, `${ts}.raw.json`), reply, 'utf8');
    console.log(`${indent}🤖  ChatGPT reply:\n${reply}`);

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
          const secondObj = await chatCompletion({
            prompt: secondPrompt,
            images: batch,
            model,
            curators,
          });
          const second = JSON.stringify(secondObj, null, 2);
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

    let afterLines = beforeLines;
    if (notesWriter) {
      const txt = await notesWriter.read();
      afterLines = txt ? txt.split('\n').length : 0;
    }
    const latency = Date.now() - start;
    await writeStats({
      decision_latency_ms: latency,
      images_reviewed: batch.length,
      field_notes_lines_added: afterLines - beforeLines,
    });

    const filesToCommit = [path.join(repliesDir, `${ts}.raw.json`)];
    if (notesWriter) filesToCommit.push(notesWriter.file);
    if (process.env.NODE_ENV !== 'test') {
      try {
        execSync(`git add ${filesToCommit.map(f => `"${f}"`).join(' ')} && git commit -m "photo-select batch"`);
      } catch (err) {
        console.warn(`${indent}Git commit failed: ${err.message}`);
      }
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
        fieldNotes,
        showPrompt,
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
