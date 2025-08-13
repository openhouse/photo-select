import { describe, it, expect } from 'vitest';
import { buildReplySchema } from '../src/replySchema.js';

describe('buildReplySchema', () => {
  it('sets minutes bounds', () => {
    const schema = buildReplySchema({ minutesMin: 2, minutesMax: 4 });
    expect(schema.properties.minutes.minItems).toBe(2);
    expect(schema.properties.minutes.maxItems).toBe(4);
  });
});
