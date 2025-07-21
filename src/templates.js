import path from 'node:path';
import fs from 'node:fs/promises';
import Handlebars from 'handlebars';

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
  { curators = [], images = [], contextPath, fieldNotes }
) {
  const context = contextPath
    ? await fs.readFile(contextPath, 'utf8').catch(() => '')
    : '';
  return renderTemplate(filePath, {
    curators: curators.join(', '),
    images: images.map((f) => path.basename(f)),
    context,
    fieldNotes,
  });
}

