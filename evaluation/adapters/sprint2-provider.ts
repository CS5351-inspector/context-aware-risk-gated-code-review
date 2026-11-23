/** F integration only: use the merged B collector and C client/tokenizer. */
import { Chat } from '../../src/chat.js';
import { collectContext } from '../../src/review/context.js';
import { createDeepSeekContentCounter } from '../../src/review/deepseek-tokenizer.js';
import { RELAYCORE_BASE_URL, RELAYCORE_MODEL_SETTINGS, DEEPSEEK_TOKENIZER_ID, CHAT_FRAMING_ALLOWANCE } from '../../src/review/live-model.js';
declare const SPRINT2_CONTEXT_VERSION: string;
export { collectContext };
export const metadata = Object.freeze({ kind: 'live', version: 'sprint2-relaycore-v1',
  context_kind: 'actual-retrieval', context_version: SPRINT2_CONTEXT_VERSION,
  tokenizer_id: DEEPSEEK_TOKENIZER_ID,
  token_count_method: 'model-content-tokenizer-plus-64-framing-allowance',
  token_count_is_exact: false });
let counter: ((prompt: string) => number) | undefined;
export function countInputTokens(prompt: string): number {
  counter ??= createDeepSeekContentCounter();
  return counter(prompt) + CHAT_FRAMING_ALLOWANCE;
}
export function createClient(config: any): Chat {
  if (config.model !== RELAYCORE_MODEL_SETTINGS.model || config.base_url !== RELAYCORE_BASE_URL) {
    throw new Error('Frozen RelayCore model and endpoint required');
  }
  const key = process.env.INSPECTOR_MODEL_API_KEY;
  if (!key?.trim()) throw new Error('INSPECTOR_MODEL_API_KEY is not configured; no request was made');
  return new Chat(key.trim(), { ...RELAYCORE_MODEL_SETTINGS, baseURL: RELAYCORE_BASE_URL });
}
