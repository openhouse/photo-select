import { describe, it, expect } from 'vitest';
import { buildPrompt, DEFAULT_PROMPT_PATH } from '../src/templates.js';

describe('buildPrompt', () => {
  it('injects role-play phrase and minutes range', async () => {
    const { prompt, minutesMin, minutesMax } = await buildPrompt(DEFAULT_PROMPT_PATH, {
      curators: ['Curator-A', 'Curator-B'],
      images: ['/tmp/a.jpg', '/tmp/b.jpg'],
    });
    expect(minutesMin).toBe(3);
    expect(minutesMax).toBe(5);
    expect(prompt).toMatch(
      /role play as Curator-A, Curator-B:\n - inidicate who is speaking\n - say what you think/i
    );
    expect(prompt).toContain(
      `MINUTES (${minutesMin}–${minutesMax} bullet lines)`
    );
  });
});
