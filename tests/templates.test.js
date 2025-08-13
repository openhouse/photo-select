import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/templates.js';

describe('buildPrompt', () => {
  it('injects role-play phrase and minutes range', async () => {
    const { prompt, minutesMin, minutesMax } = await buildPrompt(undefined, {
      curators: ['Ingeborg Gerdes', 'Alexandra Munroe'],
      images: ['DSCF1234.jpg', 'DSCF5678.jpg'],
    });
    expect(prompt).toMatch(
      'role play as Ingeborg Gerdes, Alexandra Munroe:\n - inidicate who is speaking\n - say what you think'
    );
    expect(prompt).toMatch('MINUTES (3–5 bullet lines)');
    expect(minutesMin).toBe(3);
    expect(minutesMax).toBe(5);
  });
});

