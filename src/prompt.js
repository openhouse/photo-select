import { readFile } from 'node:fs/promises';
import { renderTemplate } from './config.js';

export async function buildPrompt(promptPath, { curators = [], contextPath } = {}) {
  const names = curators.join(', ');
  let context = '';
  if (contextPath) {
    try {
      context = await readFile(contextPath, 'utf8');
    } catch (err) {
      console.warn(`Could not read context file ${contextPath}: ${err.message}`);
    }
  }
  return renderTemplate(promptPath, { curators: names, context });
}
