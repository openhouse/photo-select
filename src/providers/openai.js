import { chatCompletion } from '../chatClient.js';
import { buildReplySchema } from '../replySchema.js';
import { parseFormatEnv } from '../formatOverride.js';

const OPENAI_FORMAT_OVERRIDE = parseFormatEnv('PHOTO_SELECT_OPENAI_FORMAT');

export default class OpenAIProvider {
  async chat({
    expectFieldNotesInstructions = false,
    expectFieldNotesMd = false,
    images = [],
    model = '',
    ...opts
  } = {}) {
    let format = OPENAI_FORMAT_OVERRIDE;
    if (format === undefined) {
      if (/^gpt-5/i.test(model)) {
        format = {
          type: 'json_schema',
          json_schema: {
            name: 'photo_select',
            schema: buildReplySchema({
              instructions: expectFieldNotesInstructions,
              fullNotes: expectFieldNotesMd,
              filenames: images,
            }),
          },
        };
      } else {
        format = {
          type: 'json_object',
          schema: buildReplySchema({
            instructions: expectFieldNotesInstructions,
            fullNotes: expectFieldNotesMd,
          }),
        };
      }
    } else if (typeof format === 'string') {
      format = { type: format };
    }
    if (format !== null) {
      opts.responseFormat = format;
    }
    return chatCompletion({ ...opts, images, model });
  }
}
