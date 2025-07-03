import path from "node:path";
import { readFile, writeFile, mkdir, stat, copyFile } from "node:fs/promises";
import { readPrompt } from "./config.js";
import { listImages, pickRandom, moveFiles } from "./imageSelector.js";
import { chatCompletion, parseReply } from "./chatClient.js";
import { applyPatch } from "diff";

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
  notesPath,
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

  let notesFile;
  if (fieldNotes) {
    notesFile = notesPath || path.join(dir, 'field-notes.md');
    try {
      await stat(notesFile);
    } catch {
      await writeFile(notesFile, '', { flag: 'a' });
    }
    try {
      const existing = await readFile(notesFile, 'utf8');
      if (existing.trim()) {
        prompt += `\n\nField notes so far:\n${existing}`;
      }
      prompt += `\n\nInclude a 'field_notes_diff' field with a unified diff for field-notes.md. Begin the diff with '--- a/field-notes.md' and '+++ b/field-notes.md' header lines followed by a numeric hunk header.`;
    } catch {
      // ignore read errors
    }
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
    const { keep, aside, notes, minutes, fieldNotesDiff, observations } = parseReply(reply, batch);
    if (minutes.length) {
      const minutesFile = path.join(dir, `minutes-${Date.now()}.txt`);
      await writeFile(minutesFile, minutes.join('\n'), 'utf8');
      console.log(`${indent}📝  Saved meeting minutes to ${minutesFile}`);
    }
    let notesDiff = fieldNotesDiff;
    if (!notesDiff && notesFile && observations && observations.length) {
      try {
        const current = await readFile(notesFile, 'utf8');
        const obsText = observations.map((o) => `- ${o}`).join('\n');
        // Encourage the model to preserve any uncertainty expressed in the observations
        const updatePrompt = `Current field notes:\n${current}\n\nThese observations were noted from the photos. Some may include questions or uncertain details—keep that nuance and do not overstate confidence.\n${obsText}\n\nIntegrate them into the document and return a unified diff for field-notes.md as 'field_notes_diff'.`;
        console.log(`${indent}⏳  Updating field notes…`);
        const updateReply = await chatCompletion({
          prompt: updatePrompt,
          images: [],
          model,
          curators,
        });
        console.log(`${indent}🤖  Field notes update reply:\n${updateReply}`);
        const parsed = parseReply(updateReply, []);
        notesDiff = parsed.fieldNotesDiff;
      } catch (err) {
        console.warn(`${indent}⚠️  Field notes second call failed: ${err.message}`);
      }
    }

    if (notesDiff && notesFile) {
      try {
        const current = await readFile(notesFile, 'utf8');
        let patched;
        try {
          patched = applyPatch(current, notesDiff);
        } catch {
          patched = false;
        }
        if (patched === false || patched === current) {
          try {
            patched = applyPatch(current, notesDiff, { fuzzFactor: 10 });
          } catch {
            patched = false;
          }
        }
        if ((patched === false || patched === current) && !notesDiff.trim().startsWith('---')) {
          const guess = `--- a/field-notes.md\n+++ b/field-notes.md\n${notesDiff}`;
          try {
            patched = applyPatch(current, guess);
          } catch {
            patched = false;
          }
          if (patched === false || patched === current) {
            try {
              patched = applyPatch(current, guess, { fuzzFactor: 10 });
            } catch {
              patched = false;
            }
          }
        }
        if (patched === false || patched === current) {
          const additions = notesDiff
            .split('\n')
            .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
            .map((l) => l.slice(1));
          if (additions.length) {
            patched = current + (current.endsWith('\n') ? '' : '\n') + additions.join('\n') + '\n';
          }
        }
        if (patched === false) {
          console.warn(`${indent}⚠️  Could not apply field notes diff`);
        } else {
          await writeFile(notesFile, patched, 'utf8');
          console.log(`${indent}📒  Updated field notes`);
        }
      } catch (err) {
        console.warn(`${indent}⚠️  Field notes update failed: ${err.message}`);
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

    if (keepCount && asideCount) {
      let childNotes;
      if (notesFile) {
        childNotes = path.join(keepDir, path.basename(notesFile));
        try {
          await stat(childNotes);
        } catch {
          // start a fresh field-notes.md at this level
          try { await writeFile(childNotes, '', { flag: 'a' }); } catch {}
        }
      }
      await triageDirectory({
        dir: keepDir,
        promptPath,
        model,
        recurse,
        curators,
        contextPath,
        fieldNotes,
        notesPath: childNotes,
        depth: depth + 1,
      });
    } else if (keepCount || asideCount) {
      const status = keepCount ? "kept" : "set aside";
      console.log(`${indent}🎯  All images ${status} at this level; stopping recursion.`);
    }
  }
}
