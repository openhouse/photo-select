// Independent oracle: never import the current production template or renderer.
// Source: f7a5a01dfc7badddbec9841df91a24d88d11d27c:prompts/default_prompt.hbs.
import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';

export const originalPromptPath = new URL('../fixtures/pre-github-default-prompt.hbs', import.meta.url);
export const originalPromptSha256 = '23183bcd94e0d49b13b582e2b8bec7da26965d0cda3fe860e86711a9d2c55cc3';
export async function originalPromptSource() {
  return fs.readFile(originalPromptPath, 'utf8');
}
export async function renderOriginalPrompt({curators = [], images = [], context = '', source, ...notes} = {}) {
  // These are the pre-PR defaults, deliberately independent of buildPrompt.
  const count = Math.max(curators.length || 1, images.length || 1);
  const minutesMin = Math.ceil(1.5 * count), minutesMax = Math.ceil(2.5 * count);
  const prompt = Handlebars.compile(source ?? await originalPromptSource(), {noEscape: true})({
    ...notes, curators: curators.join(', '), images: images.map(file => path.basename(file)),
    context, minutesMin, minutesMax,
  });
  return {prompt, minutesMin, minutesMax};
}

// The sole prompt addition authorized by Jamie on 2026-09-11. Keep the
// historical fixture untouched; callers explicitly select the expected delta.
export function withGithubExploration(prompt) {
  return prompt.replace('####################\nBackground',
    'To understand the situation more fully, explore our team’s knowledge wiki graph on GitHub.\n\n####################\nBackground');
}
