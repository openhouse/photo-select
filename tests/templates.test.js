import { describe, it, expect } from 'vitest';
import { buildPrompt, DEFAULT_PROMPT_PATH } from '../src/templates.js';

describe('buildPrompt', () => {
  it('includes role-play phrase and minutes range', async () => {
    const { prompt, minutesMin, minutesMax } = await buildPrompt(DEFAULT_PROMPT_PATH, {
      curators: ['Ingeborg Gerdes', 'Deborah Treisman'],
      images: ['a.jpg', 'b.jpg', 'c.jpg'],
    });
    expect(prompt).toMatch(
      /Role play as Ingeborg Gerdes, Deborah Treisman:\n - Indicate who is speaking\n - Say what you think/
    );
    expect(minutesMin).toBe(5);
    expect(minutesMax).toBe(8);
    expect(prompt).toMatch(/MINUTES \(5–8 bullet lines\)/);
  });
});
