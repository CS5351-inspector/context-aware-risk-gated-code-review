/** Evaluation-only Bailian transport; B retrieval and C reliability/parsing stay production code. */
import { OpenAI } from 'openai';
import { collectContext } from '../../src/review/context.js';
import { createDeepSeekContentCounter } from '../../src/review/deepseek-tokenizer.js';
import { DEEPSEEK_TOKENIZER_ID, CHAT_FRAMING_ALLOWANCE } from '../../src/review/live-model.js';
import { sprintConfig } from '../../src/review/sprint2.js';
import { PROMPT_VERSION } from '../../src/review/model-review.js';
import type { ModelClient } from '../../src/review/model-review.js';
import { MODEL, EFFECTIVE_PARAMETERS, validateBaseURL } from './bailian-config.cjs';
declare const BAILIAN_CONTEXT_VERSION: string;
export { collectContext, sprintConfig, PROMPT_VERSION };
export const metadata = Object.freeze({kind:'live',version:'bailian-deepseek-1017-v1',
  context_kind:'actual-retrieval',context_version:BAILIAN_CONTEXT_VERSION,
  tokenizer_id:DEEPSEEK_TOKENIZER_ID,
  token_count_method:'model-content-tokenizer-plus-64-framing-allowance', token_count_is_exact:false});
let counter: ((prompt:string)=>number) | undefined;
export function countInputTokens(prompt:string):number {
  counter ??= createDeepSeekContentCounter();
  return counter(prompt)+CHAT_FRAMING_ALLOWANCE;
}
export class BailianModelClient implements ModelClient {
  readonly effectiveParameters = EFFECTIVE_PARAMETERS;
  private readonly sdk:OpenAI;
  // Optional fetch is an offline transport seam; production factory supplies no override.
  constructor(key:string, baseURL:string, fetch?: typeof globalThis.fetch) {
    const endpoint=validateBaseURL(baseURL);
    if (!key?.trim()) throw new Error('DASHSCOPE_API_KEY is not configured; no request was made');
    this.sdk=new OpenAI({apiKey:key.trim(),baseURL:endpoint.baseURL,maxRetries:0,timeout:30000,
      ...(fetch ? {fetch} : {})});
  }
  async completeReview(prompt:string, options:Parameters<ModelClient['completeReview']>[1]):Promise<unknown> {
    if (options.maxRetries !== 0 || options.maxOutputTokens !== 800 ||
        !Number.isFinite(options.timeout) || options.timeout <= 0 || options.timeout > 30000) {
      throw new Error('Frozen Bailian request budget required');
    }
    // enable_thinking is a top-level Alibaba extension, not RelayCore thinking.type.
    // Return the complete provider envelope including returned model/reasoning/usage.
    const body={model:MODEL,enable_thinking:false,response_format:{type:'json_object' as const},
      max_tokens:800,messages:[{role:'user' as const,content:prompt}]};
    return this.sdk.chat.completions.create(body,{
      signal:options.signal,timeout:options.timeout,maxRetries:0,
    });
  }
}
export function createClient(config:any):ModelClient {
  const endpoint=validateBaseURL(config?.base_url);
  if (config.model !== MODEL) throw new Error('Exact Bailian DeepSeek snapshot model required');
  if (config.budget?.maxRetries !== 1 || config.budget?.requestTimeoutMs !== 30000 ||
      config.budget?.reservedOutputTokens !== 800) throw new Error('Frozen Bailian Sprint 2 budget required');
  // Endpoint/model/budget validation must happen before accessing the credential.
  return new BailianModelClient(process.env.DASHSCOPE_API_KEY ?? '',endpoint.baseURL);
}
