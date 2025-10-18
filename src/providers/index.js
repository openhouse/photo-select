export { default as OpenAIProvider } from './openai.js';
export { default as OllamaProvider } from './ollama.js';
export { default as OpenAIBatchProvider } from './openai-batch.js';

const FACTORIES = {
  async openai() {
    const m = await import('./openai.js');
    return new m.default();
  },
  async 'openai-batch'() {
    const m = await import('./openai-batch.js');
    return new m.default();
  },
  async ollama() {
    const m = await import('./ollama.js');
    return new m.default();
  },
};

export async function getProvider(name = 'openai') {
  const factory = FACTORIES[name];
  if (!factory) {
    throw new Error(`Unknown provider ${name}`);
  }
  return factory();
}
