import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/templates.js';

describe('buildPrompt', () => {
  it('injects role-play phrase and minutes range', async () => {
    const { prompt, minutesMin, minutesMax } = await buildPrompt(undefined, {
      curators: ['Ingeborg Gerdes', 'Alexandra Munroe'],
      images: ['DSCF1234.jpg', 'DSCF5678.jpg'],
    });
    expect(prompt).toMatch(
      'Role play as Ingeborg Gerdes, Alexandra Munroe:\n - Indicate who is speaking\n - Say what you think'
    );
    expect(prompt).toMatch('Produce between 3 and 5 diarized items');
    expect(minutesMin).toBe(3);
    expect(minutesMax).toBe(5);
  });
});

