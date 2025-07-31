export function buildReplySchema({ instructions = false, fullNotes = false } = {}) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['minutes', 'decision'],
    properties: {
      minutes: {
        type: 'array',
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
      decision: {
        type: 'object',
        additionalProperties: false,
        properties: {
          keep: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
          aside: {
            type: 'object',
            additionalProperties: { type: 'string' },
          },
        },
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
