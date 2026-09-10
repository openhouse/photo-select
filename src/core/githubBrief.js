import {Tiktoken} from 'js-tiktoken/lite';
import o200kBase from 'js-tiktoken/ranks/o200k_base';
import {knowledgeError} from './knowledgeLive.js';
// Application input budget, not a promise that later image/tool results will fit.
// Leaves 100,000 tokens in Terra's documented 1,050,000-token window.
const BRIEF_TOKEN_BUDGET=950_000;
let tokenizer;
export function validateGithubBrief(brief='') {
  tokenizer??=new Tiktoken(o200kBase);
  const tokens=tokenizer.encode(JSON.stringify(brief),[],[]).length;
  if(tokens>BRIEF_TOKEN_BUDGET)throw knowledgeError(`GitHub context is too large: ${tokens.toLocaleString('en-US')} locally counted text tokens; the brief limit is ${BRIEF_TOKEN_BUDGET.toLocaleString('en-US')}. Use a shorter --context file or --knowledge-brief with GitHub links. No curation was submitted; the source context has not been changed.`);
  return {textTokens:tokens,encoding:'o200k_base',briefTokenBudget:BRIEF_TOKEN_BUDGET};
}
