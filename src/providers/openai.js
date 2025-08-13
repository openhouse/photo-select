import { chatCompletion } from '../chatClient.js';
import { buildReplySchema } from '../replySchema.js';
import { parseFormatEnv } from '../formatOverride.js';

const OPENAI_FORMAT_OVERRIDE = parseFormatEnv('PHOTO_SELECT_OPENAI_FORMAT');

export default class OpenAIProvider {
  async chat({
    expectFieldNotesInstructions = false,
    expectFieldNotesMd = false,
    minutesMin,
    minutesMax,
    responseFormat,
    ...opts
  } = {}) {
    let format = responseFormat ?? OPENAI_FORMAT_OVERRIDE;
    if (format === undefined) {
      format = {
        type: 'json_object',
        schema: buildReplySchema({
          instructions: expectFieldNotesInstructions,
          fullNotes: expectFieldNotesMd,
          minutesMin,
          minutesMax,
        }),
      };
    } else if (typeof format === 'string') {
      format = { type: format };
    }
    if (format !== null) {
      opts.responseFormat = format;
    }
    return chatCompletion({ minutesMin, minutesMax, ...opts });
  }
}
