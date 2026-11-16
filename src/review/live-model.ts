import { getEncoding } from 'js-tiktoken';
import { Chat } from '../chat.js';
import type { ReviewFiles } from './contracts.js';
import { reviewFiles } from './model-review.js';

export const LIVE_TOKENIZER = 'js-tiktoken@1.0.21/o200k_base/gpt-4o-mini-2024-07-18';
let encoding: ReturnType<typeof getEncoding> | undefined;

/** Mirror Chat.completeReview's single user message, including chat framing.
 * Source text resembling special tokens must be tokenized as ordinary text.
 * Provider-reported usage remains the source for actual consumption. */
export function countReviewTokens(prompt: string): number {
  encoding ??= getEncoding('o200k_base');
  // OpenAI Cookbook, "How to count tokens with tiktoken": three tokens
  // per message, one for the user role, and three for assistant reply priming.
  return 3 + 1 + encoding.encode(prompt, [], []).length + 3;
}

export function createLiveReview(apiKey: string, signal?: AbortSignal): ReviewFiles {
  if (!apiKey?.trim()) throw new Error('Missing model credential');
  const client = new Chat(apiKey);
  const model = client.effectiveParameters.model;
  if (!['gpt-4o-mini', 'gpt-4o-mini-2024-07-18', 'openai/gpt-4o-mini'].includes(String(model))) {
    throw new Error('No configured tokenizer for the selected review model');
  }
  return (input, snippets, budget) =>
    reviewFiles(client, input, snippets, budget, { countInputTokens: countReviewTokens, signal });
}
