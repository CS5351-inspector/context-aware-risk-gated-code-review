import { getEncoding } from 'js-tiktoken';
import { Chat } from '../chat.js';
import type { ReviewFiles } from './contracts.js';
import { createDeepSeekContentCounter, DEEPSEEK_TOKENIZER_REVISION } from './deepseek-tokenizer.js';
import { reviewFiles } from './model-review.js';

// 固定请求模型和推理强度，部署时仅配置 API 地址及与其配对的凭据。
export const LIVE_MODEL_SETTINGS = Object.freeze({ model: 'gpt-5.4-mini', reasoning_effort: 'none' } as const);
export const LIVE_TOKENIZER = 'js-tiktoken@1.0.21/o200k_base+chat-allowance-64';
export const CHAT_FRAMING_ALLOWANCE = 64;
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODEL_SETTINGS = Object.freeze({
  model: 'deepseek-flash',
  thinking: Object.freeze({ type: 'disabled' } as const),
});
const RELAYCORE_ORIGIN = 'https://api.relaycore.cn';
export const RELAYCORE_BASE_URL = RELAYCORE_ORIGIN + '/v1';
// RelayCore 的 DeepSeek 分组提供与仓库分词器快照对应的固定版本。
export const RELAYCORE_MODEL_SETTINGS = Object.freeze({
  ...DEEPSEEK_MODEL_SETTINGS,
  model: 'deepseek-v4.1-flash-1017',
});
export const DEEPSEEK_TOKENIZER_ID =
  '@huggingface/tokenizers@0.2.0/DeepSeek-V4.1-Flash-1017@' + DEEPSEEK_TOKENIZER_REVISION + '+chat-allowance-64';

let encoding: ReturnType<typeof getEncoding> | undefined;

/** 对发出的完整 user 消息分词，额外留出消息封装余量。
 * 源码中的特殊标记按普通文本计数，实际用量仍以 provider 的 usage 为准。 */
export function countReviewTokens(prompt: string): number {
  encoding ??= getEncoding('o200k_base');
  return CHAT_FRAMING_ALLOWANCE + encoding.encode(prompt, [], []).length;
}

function validateEndpoint(baseURL: string): URL {
  let endpoint: URL;
  try { endpoint = new URL(baseURL); } catch { throw new Error('Configure a model HTTPS base URL'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Configure a model HTTPS base URL with no credentials, query or fragment');
  }
  if (endpoint.hostname === 'models.github.ai') throw new Error('GitHub Models inference has retired');
  return endpoint;
}

export function createLiveReview(apiKey: string, baseURL: string, signal?: AbortSignal): ReviewFiles {
  if (!apiKey?.trim()) throw new Error('Missing model credential');
  const endpoint = validateEndpoint(baseURL);
  const deepseekOfficial = endpoint.hostname === 'api.deepseek.com';
  const relayCore = endpoint.hostname === 'api.relaycore.cn';
  const normalizedBase = endpoint.href.replace(/\/+$/, '');
  if (deepseekOfficial && ![DEEPSEEK_BASE_URL, DEEPSEEK_BASE_URL + '/v1'].includes(normalizedBase)) {
    throw new Error('Configure the DeepSeek Chat Completions base URL');
  }
  // 控制台展示站点根地址，OpenAI SDK 需要包含 /v1 的 API 根地址。
  if (relayCore && ![RELAYCORE_ORIGIN, RELAYCORE_BASE_URL].includes(normalizedBase)) {
    throw new Error('Configure the RelayCore Chat Completions base URL');
  }
  const settings = relayCore ? RELAYCORE_MODEL_SETTINGS : deepseekOfficial ? DEEPSEEK_MODEL_SETTINGS : LIVE_MODEL_SETTINGS;
  const countContentTokens = deepseekOfficial || relayCore ? createDeepSeekContentCounter() : undefined;
  const countInputTokens = countContentTokens
    ? (prompt: string) => CHAT_FRAMING_ALLOWANCE + countContentTokens(prompt)
    : countReviewTokens;
  const tokenizerId = countContentTokens ? DEEPSEEK_TOKENIZER_ID : LIVE_TOKENIZER;
  const client = new Chat(apiKey.trim(), { ...settings, baseURL: relayCore ? RELAYCORE_BASE_URL : normalizedBase });
  // 两个模式共用同一个模型、分词器和 A 的取消信号。
  return (input, snippets, budget) =>
    reviewFiles(client, input, snippets, budget, { countInputTokens, tokenizerId, signal });
}
