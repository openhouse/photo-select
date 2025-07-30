import { buildMessages, MAX_RESPONSE_TOKENS } from '../chatClient.js';
import { delay } from '../config.js';

const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const DEFAULT_TIMEOUT = 20 * 60 * 1000;
const TIMEOUT_MS =
  Number.parseInt(process.env.OLLAMA_HTTP_TIMEOUT, 10) ||
  Number.parseInt(process.env.PHOTO_SELECT_TIMEOUT_MS, 10) ||
  DEFAULT_TIMEOUT;
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
  async chat({ prompt, images, model, curators = [], maxRetries = 3, onProgress = () => {} }) {
    let attempt = 0;
    while (true) {
      try {
        onProgress('encoding');
        const { messages } = await buildMessages(prompt, images, curators);
        // Extract base64 strings from OpenAI-style content parts and
        // attach them to the original user message rather than flattening
        // everything into a single block.
        const [system, user] = messages;
        const textParts = [];
        const imageData = [];
        if (Array.isArray(user.content)) {
          for (const part of user.content) {
            if (part.type === 'text') textParts.push(part.text);
            if (part.type === 'image_url' && part.image_url?.url) {
              const url = part.image_url.url;
              const match = url.match(/^data:image\/\w+;base64,(.*)$/);
              imageData.push(match ? match[1] : url);
            }
          }
        } else {
          textParts.push(String(user.content));
        }
        user.content = textParts.join('\n');
        if (imageData.length) user.images = imageData;
        const finalMessages = [system, user];
        onProgress('request');

        const params = {
          model,
          messages: finalMessages,
          stream: false,
          num_predict: OLLAMA_NUM_PREDICT,
        };

        // Ollama vision models fail if `format:"json"` is combined with images.
        // Only request JSON mode when no image data is present so text-only
        // conversations still benefit from structured output.
        if (OLLAMA_FORMAT && imageData.length === 0) {
          params.format = OLLAMA_FORMAT;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
        const res = await fetch(`${BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
          signal: controller.signal,
          timeout: TIMEOUT_MS,
        });
        clearTimeout(timer);
        if (res.status === 503) throw new Error('service unavailable');
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.error) {
          const msg = data.error || `HTTP ${res.status}`;
          throw new Error(msg);
        }
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
