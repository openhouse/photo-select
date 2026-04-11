import { chatCompletion } from '../chatClient.js';
import { buildReplySchema } from '../replySchema.js';
import { parseFormatEnv } from '../formatOverride.js';
import path from 'node:path';

const OPENAI_FORMAT_OVERRIDE = parseFormatEnv('PHOTO_SELECT_OPENAI_FORMAT');
const kPromise = Symbol('openai-handle-promise');

export default class OpenAIProvider {
  name = 'openai';
  supportsAsync = false;

  async submit(options = {}) {
    const promise = this.chat(options);
    return { provider: this.name, [kPromise]: promise };
  }

  async collect(handle) {
    const raw = await handle[kPromise];
    return { raw };
  }

  async chat({
    expectFieldNotesInstructions = false,
    expectFieldNotesMd = false,
    ...opts
  } = {}) {
    let format = OPENAI_FORMAT_OVERRIDE;
    if (format === undefined) {
      format = {
        type: 'json_object',
        schema: buildReplySchema({
          instructions: expectFieldNotesInstructions,
          fullNotes: expectFieldNotesMd,
          minutesMin: opts.minutesMin,
          minutesMax: opts.minutesMax,
          images: (opts.images || []).map((f) => path.basename(f)),
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
