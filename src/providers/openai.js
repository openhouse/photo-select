import { chatCompletion } from '../chatClient.js';
import { buildReplySchema } from '../replySchema.js';
import { parseFormatEnv } from '../formatOverride.js';

const OPENAI_FORMAT_OVERRIDE = parseFormatEnv('PHOTO_SELECT_OPENAI_FORMAT');

export default class OpenAIProvider {
  async chat({
    expectFieldNotesInstructions = false,
    expectFieldNotesMd = false,
    model = 'gpt-4o',
    ...opts
  } = {}) {
    if (/^gpt-5/.test(model)) {
      return chatCompletion({
        ...opts,
        model,
        expectFieldNotesInstructions,
        expectFieldNotesMd,
      });
    }
    let format = OPENAI_FORMAT_OVERRIDE;
    if (format === undefined) {
      format = {
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
    return chatCompletion({
      ...opts,
      model,
      expectFieldNotesInstructions,
      expectFieldNotesMd,
    });
  }
}
