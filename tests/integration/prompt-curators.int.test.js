import { describe, it, expect } from 'vitest';
import { buildFinalPrompt } from '../../src/core/finalizeCurators.js';

function extractCurators(text) {
  const m = text.match(/(^|\n)\s*-?\s*Curators:\s*(.+)\s*(\n|$)/);
  if (!m) {
    throw new Error(`Curators line missing. Prompt head:\n${text.slice(0, 400)}`);
  }
  return m[2].split(/,\s*/).filter(Boolean);
}

describe('finalizeCurators integration', () => {
  it('appends repeated names verbatim and orders by last appearance', async () => {
    const cli = ['Beata'];
    const photos = [
      {
        file: 'a.jpg',
        people: ['Beata (Kendell + Mandy cabin neighbor)', 'Ellen Lev'],
      },
      {
        file: 'b.jpg',
        people: ['Beata (Kendell + Mandy cabin neighbor)', 'Ray Harbin'],
      },
      { file: 'c.jpg', people: ['Ellen Lev'] },
    ];
    const { prompt } = await buildFinalPrompt({
      cliCurators: cli,
      photos,
      images: photos.map((p) => p.file),
    });
    const names = extractCurators(prompt.systemPrompt);
    expect(names).toEqual([
      'Beata',
      'Ellen Lev',
      'Beata (Kendell + Mandy cabin neighbor)',
    ]);
    const promptText = [
      '--- system ---',
      prompt.systemPrompt,
      '',
      '--- user ---',
      prompt.userPreamble,
    ].join('\n');
    const header = promptText.split('\n').slice(0, 40).join('\n');
    expect(header).toMatchSnapshot();
  });

  it('ignores placeholders and falls back to CLI curators when no repeats', async () => {
    const cli = ['Curator A'];
    const photos = [
      { file: 'a.jpg', people: ['_UNKNOWN_', 'Alice'] },
      { file: 'b.jpg', people: ['unknown #2', 'Bob'] },
    ];
    const { prompt } = await buildFinalPrompt({
      cliCurators: cli,
      photos,
      images: photos.map((p) => p.file),
    });
    const names = extractCurators(prompt.systemPrompt);
    expect(names).toEqual(['Curator A']);
  });
});

