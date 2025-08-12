import path from 'node:path';

export function buildReplySchema({ instructions = false, fullNotes = false, filenames } = {}) {
  if (Array.isArray(filenames) && filenames.length) {
    const names = filenames.map((f) => path.basename(f));
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['minutes', 'decisions'],
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
        decisions: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['filename', 'decision', 'reason'],
            properties: {
              filename: { type: 'string', enum: names },
              decision: { type: 'string', enum: ['keep', 'aside'] },
              reason: { type: 'string' },
            },
          },
        },
      },
    };
    return schema;
  }

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
