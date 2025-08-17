import { describe, it, expect } from 'vitest';
import { isPlaceholder, sanitizePeople } from '../src/lib/people.js';

describe('people sanitizer', () => {
  it('detects placeholder tokens', () => {
    ['_UNKNOWN_', 'unknown', 'Unknown #2', 'unknown3', 'unknown 3'].forEach(t =>
      expect(isPlaceholder(t)).toBe(true)
    );
    ['Olivia J Mann', 'Beata (neighbor)', 'Unknown Pleasures'].forEach(t =>
      expect(isPlaceholder(t)).toBe(false)
    );
  });

  it('trims and drops placeholders only', () => {
    const raw = ['  Olivia J Mann ', '_UNKNOWN_', 'Beata (neighbor)', 'unknown #1', 'Olivia J Mann'];
    expect(sanitizePeople(raw)).toEqual(['Olivia J Mann', 'Beata (neighbor)', 'Olivia J Mann']);
  });
});
