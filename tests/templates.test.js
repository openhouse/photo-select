import { describe, it, expect } from 'vitest';
import { buildPrompt, DEFAULT_PROMPT_PATH } from '../src/templates.js';

describe('buildPrompt', () => {
  it('includes role-play line and minutes range', async () => {
    const { prompt, minutesMin, minutesMax } = await buildPrompt(
      DEFAULT_PROMPT_PATH,
      {
        curators: ['Ingeborg Gerdes', 'Deborah Treisman'],
        images: ['a.jpg', 'b.jpg'],
      }
    );
    expect(prompt).toContain(
      'Role play as Ingeborg Gerdes, Deborah Treisman:\n - Indicate who is speaking\n - Say what you think'
    );
    expect(prompt).toContain(
      `MINUTES (${minutesMin}\u2013${minutesMax} bullet lines)`
    );
  });
});

