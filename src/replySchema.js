export function buildReplySchema({
  instructions = false,
  fullNotes = false,
  minutesMin = 3,
  minutesMax = 12,
  images = [],
} = {}) {
  const decisionItem = {
    type: 'object',
    additionalProperties: false,
    required: ['filename', 'decision', 'reason'],
    properties: {
      filename: images.length ? { type: 'string', enum: images } : { type: 'string' },
      decision: { type: 'string', enum: ['keep', 'aside'] },
      reason: { type: 'string' },
    },
  };
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['minutes', 'decisions'],
    properties: {
      minutes: {
        type: 'array',
        minItems: minutesMin,
        maxItems: minutesMax,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['speaker', 'text'],
          properties: {
            speaker: { type: 'string' },
            text: { type: 'string' },
          },
        },
      },
      decisions: {
        type: 'array',
        minItems: images.length,
        maxItems: images.length,
        items: decisionItem,
      },
    },
  };
  if (instructions) {
    schema.properties.field_notes_instructions = { type: 'string' };
  }
  if (fullNotes) {
    schema.properties.field_notes_md = { type: 'string' };
    schema.properties.commit_message = { type: 'string' };
  }
  return schema;
}
