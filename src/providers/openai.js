import { chatCompletion } from '../chatClient.js';

export default class OpenAIProvider {
  async chat(opts) {
    return chatCompletion(opts);
  }
}
