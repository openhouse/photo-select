import { buildMessages, MAX_RESPONSE_TOKENS } from '../chatClient.js';
import { delay } from '../config.js';
import { Ollama } from 'ollama';
import { buildReplySchema } from '../replySchema.js';
import { parseFormatEnv } from '../formatOverride.js';
import path from 'node:path';

const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const client = new Ollama({ host: BASE_URL });
// Check for an environment override. When undefined we generate a JSON schema
// dynamically for each request. Set the variable to "" to omit the parameter
// entirely.
const OLLAMA_FORMAT_OVERRIDE = parseFormatEnv('PHOTO_SELECT_OLLAMA_FORMAT');
// Default to a long response (~32k tokens) matching the output limit of many
// OpenAI models.
const OLLAMA_NUM_PREDICT = Number.parseInt(
  process.env.PHOTO_SELECT_OLLAMA_NUM_PREDICT,
  10
) || MAX_RESPONSE_TOKENS;

const kPromise = Symbol('ollama-handle');

export default class OllamaProvider {
  name = 'ollama';
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
    prompt,
    images,
    model,
    curators = [],
    maxRetries = 3,
    onProgress = () => {},
    savePayload,
    expectFieldNotesInstructions = false,
    expectFieldNotesMd = false,
    minutesMin,
    minutesMax,
  } = {}) {
    let attempt = 0;
    while (true) {
      try {
        onProgress('encoding');
        const { messages } = await buildMessages(prompt, images, curators);
        const [system, user] = messages;
        const injectedText = system.content.trim();
        const textParts = [];
        const imagePaths = [];
        if (injectedText) textParts.push(injectedText);
        if (Array.isArray(user.content)) {
          let idx = 0;
          for (const part of user.content) {
            if (part.type === 'text') textParts.push(part.text);
            if (part.type === 'image_url') {
              const file = images[idx++];
              if (file) imagePaths.push(file);
            }
          }
        } else {
          textParts.push(String(user.content));
        }
        user.content = textParts.join('\n');
        if (imagePaths.length) user.images = imagePaths;
        const finalMessages = [system, user];
        onProgress('request');

        const params = {
          model,
          messages: finalMessages,
          stream: false,
          options: { num_predict: OLLAMA_NUM_PREDICT },
        };

        // Build the request format. If an environment override is not provided
        // generate a structured-output schema matching the expected reply
        // shape. Legacy "json" mode remains available but is unreliable with
        // images.
        let format = OLLAMA_FORMAT_OVERRIDE;
        if (format === undefined) {
          format = buildReplySchema({
            instructions: expectFieldNotesInstructions,
            fullNotes: expectFieldNotesMd,
            minutesMin,
            minutesMax,
            images: (images || []).map((f) => path.basename(f)),
          });
        }
        if (format !== null) {
          const isPlainJson = format === 'json';
          if (!(isPlainJson && imagePaths.length > 0)) {
            params.format = format;
          }
        }

        if (typeof savePayload === 'function') {
          await savePayload(JSON.parse(JSON.stringify(params)));
        }

        const data = await client.chat(params);
        if (!data.message?.content) {
          throw new Error('empty response');
        }
        onProgress('done');
        return data.message.content;
      } catch (err) {
        if (process.env.PHOTO_SELECT_VERBOSE) {
          console.error('ollama fetch failure:', err);
        }
        if (attempt >= maxRetries) throw err;
        attempt += 1;
        const wait = 2 ** attempt * 1000;
        console.warn(`ollama error (${err.message}). Retrying in ${wait}ms…`);
        await delay(wait);
      }
    }
  }
}
