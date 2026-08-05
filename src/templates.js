import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import Handlebars from 'handlebars';

const fmin = Number(process.env.PHOTO_SELECT_MINUTES_FACTOR_MIN || 1.5);
const fmax = Number(process.env.PHOTO_SELECT_MINUTES_FACTOR_MAX || 2.5);
const CACHE_BREAKPOINT_SENTINEL =
  '\uE000PHOTO_SELECT_CACHE_BREAKPOINT\uE001';

export const DEFAULT_PROMPT_PATH = path.resolve(
  fileURLToPath(new URL('../prompts/default_prompt.hbs', import.meta.url))
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
  const context = contextPath
    ? await fs.readFile(contextPath, 'utf8').catch(() => '')
    : '';

  const base = Math.max(curators.length || 1, images.length || 1);
  const minutesMin = Math.ceil(fmin * base);
  const minutesMax = Math.ceil(fmax * base);
  const markCacheBoundary =
    Boolean(context) && !context.includes(CACHE_BREAKPOINT_SENTINEL);

  const renderedPrompt = await renderTemplate(filePath, {
    curators: curators.join(', '),
    images: images.map((f) => path.basename(f)),
    context: markCacheBoundary
      ? `${context}${CACHE_BREAKPOINT_SENTINEL}`
      : context,
    fieldNotes,
    fieldNotesPrev,
    fieldNotesPrev2,
    commitMessages,
    hasFieldNotes,
    isSecondPass,
    minutesMin,
    minutesMax,
  });

  const markerIndex = markCacheBoundary
    ? renderedPrompt.indexOf(CACHE_BREAKPOINT_SENTINEL)
    : -1;
  const prompt = markCacheBoundary
    ? renderedPrompt.replaceAll(CACHE_BREAKPOINT_SENTINEL, '')
    : renderedPrompt;
  const promptCachePrefix =
    markerIndex >= 0 ? prompt.slice(0, markerIndex) : undefined;

  return { prompt, promptCachePrefix, minutesMin, minutesMax };
}
