import { readFile } from 'node:fs/promises';
import { readPrompt } from './config.js';

export async function buildPrompt(promptPath, { curators = [], contextPath } = {}) {
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
  return prompt;
}
