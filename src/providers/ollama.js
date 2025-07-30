import { buildMessages, MAX_RESPONSE_TOKENS } from '../chatClient.js';
import { delay } from '../config.js';
import { Ollama } from 'ollama';

const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const client = new Ollama({ host: BASE_URL });
// Allow callers to override the request format, defaulting to JSON for
// consistent parsing. Set PHOTO_SELECT_OLLAMA_FORMAT to "" to omit the param.
const OLLAMA_FORMAT =
  process.env.PHOTO_SELECT_OLLAMA_FORMAT === ''
    ? null
    : process.env.PHOTO_SELECT_OLLAMA_FORMAT || 'json';
// default to a long response similar to OpenAI's 4096 token cap
const OLLAMA_NUM_PREDICT = Number.parseInt(
  process.env.PHOTO_SELECT_OLLAMA_NUM_PREDICT,
  10
) || MAX_RESPONSE_TOKENS;

export default class OllamaProvider {
  async chat({
    prompt,
    images,
    model,
    curators = [],
    maxRetries = 3,
    onProgress = () => {},
    savePayload,
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

        // Ollama vision models fail if `format:"json"` is combined with images.
        // Only request JSON mode when no image data is present so text-only
        // conversations still benefit from structured output.
        if (OLLAMA_FORMAT && imagePaths.length === 0) {
          params.format = OLLAMA_FORMAT;
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
