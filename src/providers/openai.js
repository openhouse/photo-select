import path from 'node:path';
import { chatCompletion } from '../chatClient.js';
import { buildReplySchema } from '../replySchema.js';
import { parseFormatEnv } from '../formatOverride.js';

const OPENAI_FORMAT_OVERRIDE = parseFormatEnv('PHOTO_SELECT_OPENAI_FORMAT');

export default class OpenAIProvider {
  async chat({
    expectFieldNotesInstructions = false,
    expectFieldNotesMd = false,
    ...opts
  } = {}) {
    let format = OPENAI_FORMAT_OVERRIDE;
    const isGpt5 = /gpt-5/i.test(opts.model || '');
    if (format === undefined) {
      const filenames = Array.isArray(opts.images)
        ? opts.images.map((f) => path.basename(f))
        : undefined;
      format = isGpt5
        ? {
            type: 'json_schema',
            schema: buildReplySchema({
              instructions: expectFieldNotesInstructions,
              fullNotes: expectFieldNotesMd,
              filenames,
            }),
          }
        : {
            type: 'json_object',
            schema: buildReplySchema({
              instructions: expectFieldNotesInstructions,
              fullNotes: expectFieldNotesMd,
            }),
          };
    } else if (typeof format === 'string') {
      format = { type: format };
    }
    if (format !== null) {
      opts.responseFormat = format;
    }
    return chatCompletion(opts);
  }
}
