import path from 'node:path';
import fs from 'node:fs/promises';
import Handlebars from 'handlebars';

const DEFAULT_SYSTEM_TEMPLATE_PATH = path.resolve(
  new URL('../../prompts/system_prompt.hbs', import.meta.url).pathname,
);

const DEFAULT_USER_TEMPLATE_PATH = path.resolve(
  new URL('../../prompts/user_preamble.hbs', import.meta.url).pathname,
);

async function compileTemplate(filePath, data) {
  const absolute = path.resolve(filePath);
  const source = await fs.readFile(absolute, 'utf8');
  const template = Handlebars.compile(source, { noEscape: true });
  return template(data);
}

export async function buildPromptParts(
  data = {},
  {
    systemTemplatePath = DEFAULT_SYSTEM_TEMPLATE_PATH,
    userTemplatePath = DEFAULT_USER_TEMPLATE_PATH,
  } = {},
) {
  const systemPrompt = await compileTemplate(systemTemplatePath, data);
  const userPreamble = await compileTemplate(userTemplatePath, data);
  return { systemPrompt, userPreamble };
}

export { DEFAULT_SYSTEM_TEMPLATE_PATH, DEFAULT_USER_TEMPLATE_PATH };
