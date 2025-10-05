import { describe, expect, it } from 'vitest';
import { finalizeCurators } from '../src/core/finalizeCurators.js';

describe('finalizeCurators (passthrough)', () => {
  it('appends repeated names by last appearance and keeps parentheses', () => {
    const cliCurators = ['Curator A'];
    const photos = [
      { people: ['Jordan', 'Curator A'] },
      { people: ['Nia (context)'] },
      { people: ['Jordan', 'Nia (context)'] },
    ];

    const { finalCurators, added } = finalizeCurators(cliCurators, photos);

    expect(finalCurators).toEqual(['Curator A', 'Jordan', 'Nia (context)']);
    expect(added).toEqual(['Jordan', 'Nia (context)']);
  });
});
