export { default as OpenAIProvider } from './openai.js';
export { default as OllamaProvider } from './ollama.js';

export async function getProvider(name = 'openai') {
  if (name === 'openai') {
    const m = await import('./openai.js');
    return new m.default();
  }
  if (name === 'ollama') {
    const m = await import('./ollama.js');
    return new m.default();
  }
  throw new Error(`Unknown provider ${name}`);
}
