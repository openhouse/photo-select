import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../src/templates.js';

describe('buildPrompt', () => {
  it('includes role-play phrase and minutes range', async () => {
    const { prompt, minutesMin, minutesMax } = await buildPrompt(undefined, {
      curators: ['Curator-A', 'Curator-B'],
      images: ['a.jpg', 'b.jpg'],
    });
    expect(prompt).toMatch(
      `Role play as Curator-A, Curator-B:\n - Indicate who is speaking\n - Say what you think`
    );
    expect(prompt).toContain(
      `MINUTES (${minutesMin}–${minutesMax} bullet lines)`
    );
  });
});

