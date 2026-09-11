import {expect, it} from 'vitest';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildPrompt, DEFAULT_PROMPT_PATH} from '../src/templates.js';
import {GithubCurationProvider} from '../src/providers/github.js';
import {requestInstructions} from './helpers/githubRequest.js';
import {originalPromptSource, originalPromptSha256, renderOriginalPrompt} from './helpers/originalPrompt.js';

it('pins the original instructions independently of the current template and renderer', async () => {
  const original = await originalPromptSource();
  expect(createHash('sha256').update(original).digest('hex')).toBe(originalPromptSha256);
  expect(await fs.readFile(DEFAULT_PROMPT_PATH, 'utf8')).toBe(original);
});

const longContext = Array.from({length: 300}, (_, i) =>
  `Record ${i}: amber bridge cedar delta field — 漢字, café & <neighbors>.\n`).join('');
const cases = [
  {name: 'no context', context: ''},
  {name: 'literal Unicode and template-like context', context: 'Café & <neighbors> {{curators}}\r\nhttps://github.com/fixture/private'},
  {name: 'full cached context', context: longContext},
  {name: 'field-note revisions', context: longContext, hasFieldNotes: true, isSecondPass: true,
    fieldNotes: 'Current notes', fieldNotesPrev: 'Prior notes', fieldNotesPrev2: 'Earlier notes',
    commitMessages: ['First revision', 'Second revision']},
];
it.each(cases)('matches pre-PR instructions at the API boundary: $name', async ({name, context, ...notes}) => {
  const images = ['/fixture/a.jpg', '/fixture/b.jpg'], curators = ['Base A', 'Base B', 'Tagged Guest'];
  const expected = await renderOriginalPrompt({images, curators, context, ...notes});
  const rendered = await buildPrompt(undefined, {images, curators, contextText: context, ...notes});
  expect(rendered.prompt).toBe(expected.prompt);
  expect([rendered.minutesMin, rendered.minutesMax]).toEqual([5, 8]);
  const calls = [];
  const provider = new GithubCurationProvider({tunnelId: 'tunnel_' + 'a'.repeat(32), curators, brief: context,
    encodeImage: async () => Buffer.from('synthetic image'),
    respond: async request => {
      calls.push(request);
      return {status: 'completed', output_text: JSON.stringify({
        minutes: Array.from({length: 5}, () => ({speaker: 'Jamie', text: 'What next?'})),
        decisions: ['a.jpg', 'b.jpg'].map(filename => ({filename, decision: 'aside', reason: 'Uncertain.'})),
      })};
    },
  });
  await provider.chat({model: 'gpt-5.6-terra', images, ...rendered,
    photoPeople: [{file: 'a.jpg', people: ['Tagged Guest']}]});
  const request = calls[0];
  expect(calls).toHaveLength(1);
  expect(requestInstructions(request)).toBe(expected.prompt);
  if (context === longContext) expect(request.prompt_cache_key).toMatch(/^photo-select:github-v3:/);
  else expect(request.prompt_cache_key).toBeUndefined();
  const user = request.input.at(-1);
  expect(user.content.filter(part => part.type === 'input_text')).toEqual([
    {type: 'input_text', text: 'Here are the images:\nRespond in json format.'},
    {type: 'input_text', text: JSON.stringify({filename: 'a.jpg', people: ['Tagged Guest']})},
    {type: 'input_text', text: JSON.stringify({filename: 'b.jpg'})},
  ]);
  expect(user.content.filter(part => part.type === 'input_image')).toHaveLength(2);
  expect(request.tools[0]).toMatchObject({type: 'mcp', server_label: 'github'});
  expect(request.tools[0]).not.toHaveProperty('authorization');
});
