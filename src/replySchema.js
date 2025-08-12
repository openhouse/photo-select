import path from 'node:path';

export function buildReplySchema({ instructions = false, fullNotes = false, files = [] } = {}) {
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['minutes'],
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
    },
  };

  if (files.length) {
    schema.required.push('decisions');
    schema.properties.decisions = {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['filename', 'decision', 'reason'],
        properties: {
          filename: { type: 'string', enum: files.map((f) => path.basename(f)) },
          decision: { type: 'string', enum: ['keep', 'aside'] },
          reason: { type: 'string' },
        },
      },
    };
  } else {
    schema.required.push('decision');
    schema.properties.decision = {
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
