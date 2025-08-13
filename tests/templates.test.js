import { describe, it, expect, beforeEach } from 'vitest';
import { buildPrompt } from '../src/templates.js';

describe('buildPrompt', () => {
  beforeEach(() => {
    delete process.env.PHOTO_SELECT_MINUTES_FACTOR_MIN;
    delete process.env.PHOTO_SELECT_MINUTES_FACTOR_MAX;
  });

  it('injects role play phrase and minutes range', async () => {
    const { prompt, minutesMin, minutesMax } = await buildPrompt(undefined, {
      curators: ['Ingeborg Gerdes', 'Deborah Treisman'],
      images: ['a.jpg', 'b.jpg', 'c.jpg'],
    });
    const names = 'Ingeborg Gerdes, Deborah Treisman';
    expect(prompt).toContain(
      `role play as ${names}:\n - inidicate who is speaking\n - say what you think`
    );
    expect(prompt).toContain(`MINUTES (${minutesMin}–${minutesMax} bullet lines)`);
    expect(minutesMin).toBe(Math.ceil(1.5 * 3));
    expect(minutesMax).toBe(Math.ceil(2.5 * 3));
  });
});
