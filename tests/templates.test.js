import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildPrompt, renderTemplate } from '../src/templates.js';

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

  it('reports the stable context prefix without changing rendered prompt text', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-cache-prefix-'));
    const contextPath = path.join(dir, 'brief.md');
    const context = 'Stable context sentence. '.repeat(300);
    await fs.writeFile(contextPath, context);

    try {
      const { prompt, promptCachePrefix, minutesMin, minutesMax } =
        await buildPrompt(undefined, {
          curators: ['Ingeborg Gerdes'],
          images: ['a.jpg'],
          contextPath,
        });
      const legacyPrompt = await renderTemplate(undefined, {
        curators: 'Ingeborg Gerdes',
        images: ['a.jpg'],
        context,
        hasFieldNotes: false,
        isSecondPass: false,
        minutesMin,
        minutesMax,
      });

      expect(prompt).toBe(legacyPrompt);
      expect(prompt).not.toContain('PHOTO_SELECT_CACHE_BREAKPOINT');
      expect(prompt.startsWith(promptCachePrefix)).toBe(true);
      expect(promptCachePrefix).toContain(context);
      expect(prompt.slice(promptCachePrefix.length)).toContain(
        'Role play as Ingeborg Gerdes'
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('preserves a context containing the internal marker and disables caching', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ps-cache-collision-'));
    const contextPath = path.join(dir, 'brief.md');
    const context = 'Literal \uE000PHOTO_SELECT_CACHE_BREAKPOINT\uE001 content.';
    await fs.writeFile(contextPath, context);

    try {
      const { prompt, promptCachePrefix } = await buildPrompt(undefined, {
        contextPath,
      });
      expect(prompt).toContain(context);
      expect(promptCachePrefix).toBeUndefined();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
