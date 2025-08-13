import path from 'node:path';
import fs from 'node:fs/promises';
import Handlebars from 'handlebars';

const fmin = Number(process.env.PHOTO_SELECT_MINUTES_FACTOR_MIN || 1.5);
const fmax = Number(process.env.PHOTO_SELECT_MINUTES_FACTOR_MAX || 2.5);

export const DEFAULT_PROMPT_PATH = path.resolve(
  new URL('../prompts/default_prompt.hbs', import.meta.url).pathname
);

export async function renderTemplate(filePath = DEFAULT_PROMPT_PATH, data = {}) {
  const source = await fs.readFile(filePath, 'utf8');
  const template = Handlebars.compile(source, { noEscape: true });
  return template(data);
}

export async function buildPrompt(
  filePath,
  {
    curators = [],
    images = [],
    contextPath,
    fieldNotes,
    fieldNotesPrev,
    fieldNotesPrev2,
    commitMessages,
    hasFieldNotes = false,
    isSecondPass = false,
  }
) {
  const base = Math.max(curators.length || 1, images.length || 1);
  const minutesMin = Math.ceil(fmin * base);
  const minutesMax = Math.ceil(fmax * base);

  const context = contextPath
    ? await fs.readFile(contextPath, 'utf8').catch(() => '')
    : '';
  const prompt = await renderTemplate(filePath, {
    curators: curators.join(', '),
    images: images.map((f) => path.basename(f)),
    context,
    fieldNotes,
    fieldNotesPrev,
    fieldNotesPrev2,
    commitMessages,
    hasFieldNotes,
    isSecondPass,
    minutesMin,
    minutesMax,
  });
  return { prompt, minutesMin, minutesMax };
}

