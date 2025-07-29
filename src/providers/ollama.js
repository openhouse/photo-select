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
        // Ollama's chat endpoint expects string content and a separate
        // `images` array. Flatten any multipart content and extract the
        // base64 images from the OpenAI-style structure produced by
        // `buildMessages`.
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
        // Ollama vision models often ignore the `system` role. Embed the prompt
        // instructions directly in a single user message so both OpenAI and
        // Ollama honour the JSON schema.
        const flatMessages = [
          {
            role: 'user',
            content: [
              system.content.trim(),
              '',
              textParts.join('\n'),
            ].join('\n'),
          },
        ];
        onProgress('request');
        const params = { model, messages: flatMessages, images: imageData, stream: false };

        // Ollama vision models fail if `format:"json"` is combined with images.
        // Only request JSON mode when no image data is present so text-only
        // conversations still benefit from structured output.
        if (OLLAMA_FORMAT && imageData.length === 0) {
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
