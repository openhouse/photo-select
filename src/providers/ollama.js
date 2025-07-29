import { buildMessages } from '../chatClient.js';
import { delay } from '../config.js';

const BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
// Allow callers to override the request format, defaulting to JSON for
// consistent parsing. Set PHOTO_SELECT_OLLAMA_FORMAT to "" to omit the param.
const OLLAMA_FORMAT =
  process.env.PHOTO_SELECT_OLLAMA_FORMAT === ''
    ? null
    : process.env.PHOTO_SELECT_OLLAMA_FORMAT || 'json';

export default class OllamaProvider {
  async chat({ prompt, images, model, curators = [], maxRetries = 3, onProgress = () => {} }) {
    let attempt = 0;
    while (true) {
      try {
        onProgress('encoding');
        const { messages } = await buildMessages(prompt, images, curators);
        onProgress('request');
        const params = { model, messages, stream: false };
        if (OLLAMA_FORMAT) {
          params.format = OLLAMA_FORMAT;
        }
        const res = await fetch(`${BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        });
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
        if (attempt >= maxRetries) throw err;
        attempt += 1;
        const wait = 2 ** attempt * 1000;
        console.warn(`ollama error (${err.message}). Retrying in ${wait}ms…`);
        await delay(wait);
      }
    }
  }
}
