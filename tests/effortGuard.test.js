import { describe, it, expect } from 'vitest';
import { enforceEffortGuard } from '../src/effortGuard.js';

describe('effort guard', () => {
  it('blocks downshifting', () => {
    process.env.PHOTO_SELECT_USER_EFFORT = 'high';
    expect(() => enforceEffortGuard('medium')).toThrow(/EffortGuard/);
    delete process.env.PHOTO_SELECT_USER_EFFORT;
  });

  it('allows auto', () => {
    process.env.PHOTO_SELECT_USER_EFFORT = 'auto';
    expect(() => enforceEffortGuard('minimal')).not.toThrow();
    delete process.env.PHOTO_SELECT_USER_EFFORT;
  });
});
