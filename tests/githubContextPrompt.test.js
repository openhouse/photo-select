import {afterEach, expect, it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildPrompt} from '../src/templates.js';
import {renderOriginalPrompt} from './helpers/originalPrompt.js';

const invitation = 'To understand the situation more fully, explore our team’s knowledge wiki graph on GitHub.';
const roots = [];
afterEach(async () => Promise.all(roots.splice(0).map(root => fs.rm(root, {recursive: true, force: true}))));
const inputs = {curators: ['Base'], images: ['a.jpg']};

// A missing condition, unconditional addition, or hostname substring match
// must fail at the rendered-prompt boundary, independently of production helpers.
it.each([
  ['repository', 'https://github.com/team/wiki'],
  ['Markdown', '[wiki](https://github.com/team/wiki/tree/latest)'],
  ['autolink', '<https://github.com/team/wiki/blob/main/README.md>'],
  ['multiple links', 'https://github.com/team/one https://github.com/team/two'],
  ['HTTP and case', 'HTTP://GITHUB.COM/team/wiki'],
  ['www', 'https://www.github.com/team/wiki'],
  ['root with punctuation', 'Our graph (https://github.com).'],
  ['late in a large context', 'Context café & <neighbors> {{curators}}\r\n'.repeat(15000) + 'https://github.com/team/wiki'],
])('adds exactly one invitation for a GitHub link: %s', async (_name, context) => {
  const original = await renderOriginalPrompt({...inputs, context});
  const result = await buildPrompt(undefined, {...inputs, contextText: context});
  const expected = original.prompt.replace('####################\nBackground', invitation + '\n\n####################\nBackground');
  expect(result.prompt).toBe(expected);
  expect(result.prompt.split(invitation)).toHaveLength(2);
  expect(result.promptCachePrefix).toContain(invitation);
  expect(result.promptCachePrefix.endsWith(context)).toBe(true);
});

it.each([
  ['empty', ''],
  ['ordinary text', 'Our GitHub knowledge wiki graph'],
  ['other website', 'https://example.com/team/wiki'],
  ['lookalike host', 'https://github.com.example.org/team/wiki'],
  ['host suffix', 'https://notgithub.com/team/wiki'],
  ['URL path', 'https://example.com/github.com/team/wiki'],
  ['URL query', 'https://example.com/?next=https://github.com/team/wiki'],
  ['userinfo', 'https://github.com@example.org/team/wiki'],
  ['email', 'team@github.com'],
])('preserves every historical byte without a GitHub link: %s', async (_name, context) => {
  const original = await renderOriginalPrompt({...inputs, context});
  const result = await buildPrompt(undefined, {...inputs, contextText: context});
  expect(result.prompt).toBe(original.prompt);
});

it('uses the same condition for a context file and an inline context override', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'github-context-prompt-')); roots.push(root);
  const contextPath = path.join(root, 'context.txt');
  const context = 'Read https://github.com/team/private-wiki';
  await fs.writeFile(contextPath, context);
  const fromFile = await buildPrompt(undefined, {...inputs, contextPath});
  const inline = await buildPrompt(undefined, {...inputs, contextText: context});
  expect(fromFile).toEqual(inline);
  expect(fromFile.prompt).toContain(invitation);
  const override = await buildPrompt(undefined, {...inputs, contextPath, contextText: 'No links here.'});
  expect(override.prompt).not.toContain(invitation);
});

it('does not treat links in field notes or curator names as context links', async () => {
  const result = await buildPrompt(undefined, {...inputs, contextText: 'No context links.',
    curators: ['https://github.com/team/wiki'], hasFieldNotes: true, fieldNotes: 'https://github.com/team/wiki'});
  expect(result.prompt).not.toContain(invitation);
});

it('leaves custom templates unchanged and exposes the condition for explicit opt-in', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'github-context-custom-')); roots.push(root);
  const file = path.join(root, 'custom.hbs'), contextText = 'https://github.com/team/wiki';
  await fs.writeFile(file, 'Custom instructions: {{context}}');
  expect((await buildPrompt(file, {...inputs, contextText})).prompt).toBe('Custom instructions: ' + contextText);
  await fs.writeFile(file, '{{#if hasGithubLinks}}Explore. {{/if}}{{context}}');
  expect((await buildPrompt(file, {...inputs, contextText})).prompt).toBe('Explore. ' + contextText);
  expect((await buildPrompt(file, {...inputs, contextText: 'No links.'})).prompt).toBe('No links.');
});
