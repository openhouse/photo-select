import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { buildPrompt } from '../src/templates.js';

describe('buildPrompt', () => {
  it('injects role-play phrase and minutes range', async () => {
    const tpl = path.join(process.cwd(), 'prompts', 'default_prompt.hbs');
    const { prompt, minutesMin, minutesMax } = await buildPrompt(tpl, {
      curators: ['Ingeborg Gerdes', 'Alexandra Munroe'],
      images: ['a.jpg', 'b.jpg'],
    });
    expect(prompt).toMatch(
      /Role play as Ingeborg Gerdes, Alexandra Munroe:\n - Indicate who is speaking\n - Say what you think/
    );
    expect(prompt).toContain(`MINUTES (${minutesMin}–${minutesMax} bullet lines)`);
  });
});
