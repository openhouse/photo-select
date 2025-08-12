export function buildReplySchema({
  instructions = false,
  fullNotes = false,
  filenames,
} = {}) {
  const base = {
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
  };

  let schema;
  if (Array.isArray(filenames) && filenames.length) {
    schema = {
      type: 'object',
      additionalProperties: false,
      required: ['minutes', 'decisions'],
      properties: {
        minutes: base,
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['filename', 'decision', 'reason'],
            properties: {
              filename: { type: 'string', enum: filenames },
              decision: { type: 'string', enum: ['keep', 'aside'] },
              reason: { type: 'string' },
            },
          },
        },
      },
    };
  } else {
    schema = {
      type: 'object',
      additionalProperties: false,
      required: ['minutes', 'decision'],
      properties: {
        minutes: base,
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
  }

  if (instructions) {
    schema.properties.field_notes_instructions = { type: 'string' };
  }
  if (fullNotes) {
    schema.properties.field_notes_md = { type: 'string' };
    schema.properties.commit_message = { type: 'string' };
  }
  return schema;
}
