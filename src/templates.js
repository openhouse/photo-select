import path from 'node:path';
import fs from 'node:fs/promises';
import {
  buildPromptParts,
  DEFAULT_SYSTEM_TEMPLATE_PATH,
  DEFAULT_USER_TEMPLATE_PATH,
} from './core/promptBuilder.js';

const fmin = Number(process.env.PHOTO_SELECT_MINUTES_FACTOR_MIN || 1.5);
const fmax = Number(process.env.PHOTO_SELECT_MINUTES_FACTOR_MAX || 2.5);

export const DEFAULT_SYSTEM_PROMPT_PATH = DEFAULT_SYSTEM_TEMPLATE_PATH;
export const DEFAULT_PROMPT_PATH = DEFAULT_USER_TEMPLATE_PATH;

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

  const data = {
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
  };

  const { systemPrompt, userPreamble } = await buildPromptParts(data, {
    systemTemplatePath: DEFAULT_SYSTEM_TEMPLATE_PATH,
    userTemplatePath: filePath ? path.resolve(filePath) : DEFAULT_USER_TEMPLATE_PATH,
  });

  return { prompt: { systemPrompt, userPreamble }, minutesMin, minutesMax };
}

