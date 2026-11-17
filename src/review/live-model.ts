import { getEncoding } from 'js-tiktoken';
import { Chat } from '../chat.js';
import type { ReviewFiles } from './contracts.js';
import { reviewFiles } from './model-review.js';

// 固定请求模型和推理强度，部署时仅配置 API 地址及与其配对的凭据。
export const LIVE_MODEL_SETTINGS = Object.freeze({ model: 'gpt-5.4-mini', reasoning_effort: 'none' } as const);
export const LIVE_TOKENIZER = 'js-tiktoken@1.0.21/o200k_base+chat-allowance-64';
export const CHAT_FRAMING_ALLOWANCE = 64;

let encoding: ReturnType<typeof getEncoding> | undefined;

/** 对发出的完整 user 消息分词，额外留出消息封装余量。
 * 源码中的特殊标记按普通文本计数，实际用量仍以 provider 的 usage 为准。 */
export function countReviewTokens(prompt: string): number {
  encoding ??= getEncoding('o200k_base');
  return CHAT_FRAMING_ALLOWANCE + encoding.encode(prompt, [], []).length;
}

function validateEndpoint(baseURL: string): string {
  let endpoint: URL;
  try { endpoint = new URL(baseURL); } catch { throw new Error('Configure a model HTTPS base URL'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Configure a model HTTPS base URL with no credentials, query or fragment');
  }
  if (endpoint.hostname === 'models.github.ai') throw new Error('GitHub Models inference has retired');
  return endpoint.href.replace(/\/+$/, '');
}

export function createLiveReview(apiKey: string, baseURL: string, signal?: AbortSignal): ReviewFiles {
  if (!apiKey?.trim()) throw new Error('Missing model credential');
  const client = new Chat(apiKey.trim(), { ...LIVE_MODEL_SETTINGS, baseURL: validateEndpoint(baseURL) });
  // 两种模式通过同一个 client，且共用模型对应的计数器和 A 传进来的取消信号。
  return (input, snippets, budget) =>
    reviewFiles(client, input, snippets, budget, { countInputTokens: countReviewTokens, tokenizerId: LIVE_TOKENIZER, signal });
}
