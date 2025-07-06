import { describe, it, expect } from 'vitest';
import { Reply } from '../src/replySchema.js';

const fixture = {
  minutes: [{ speaker: 'A', text: 'done?' }],
  decision: { keep: { 'a.jpg': 'ok' }, aside: { 'b.jpg': 'bad' } }
};

describe('reply schema', () => {
  it('validates fixture', () => {
    expect(() => Reply.parse(fixture)).not.toThrow();
  });
});
