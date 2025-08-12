import { chatCompletion } from '../chatClient.js';
import { buildReplySchema } from '../replySchema.js';
import { parseFormatEnv } from '../formatOverride.js';
import path from 'node:path';

const OPENAI_FORMAT_OVERRIDE = parseFormatEnv('PHOTO_SELECT_OPENAI_FORMAT');

export default class OpenAIProvider {
  async chat({
    expectFieldNotesInstructions = false,
    expectFieldNotesMd = false,
    ...opts
  } = {}) {
    let format = OPENAI_FORMAT_OVERRIDE;
    if (format === undefined) {
      const files = /gpt-5/i.test(opts.model || '')
        ? (opts.images || []).map((f) => path.basename(f))
        : [];
      const schema = buildReplySchema({
        instructions: expectFieldNotesInstructions,
        fullNotes: expectFieldNotesMd,
        files,
      });
      format = files.length
        ? { type: 'json_schema', json_schema: schema }
        : { type: 'json_object', schema };
    } else if (typeof format === 'string') {
      format = { type: format };
    }
    if (format !== null) {
      opts.responseFormat = format;
    }
    return chatCompletion(opts);
  }
}
