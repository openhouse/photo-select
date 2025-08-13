import { describe, it, expect } from 'vitest';
import { buildPrompt, DEFAULT_PROMPT_PATH } from '../src/templates.js';

const images = ['a.jpg', 'b.jpg'];
const curators = ['Curator-A', 'Curator-B'];

describe('buildPrompt', () => {
  it('injects role-play phrase and minutes range', async () => {
    const { prompt, minutesMin, minutesMax } = await buildPrompt(DEFAULT_PROMPT_PATH, {
      curators,
      images,
    });
    const line = `Role play as Curator-A, Curator-B:\n - inidicate who is speaking\n - say what you think`;
    expect(prompt).toContain(line);
    expect(prompt).toContain(`MINUTES (${minutesMin}–${minutesMax} bullet lines)`);
  });
});
