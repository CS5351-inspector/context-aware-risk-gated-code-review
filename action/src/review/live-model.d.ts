/// <reference types="node" />
import type { ReviewFiles } from './contracts.js';
export declare const LIVE_MODEL_SETTINGS: Readonly<{
    readonly model: "gpt-5.4-mini";
    readonly reasoning_effort: "none";
}>;
export declare const LIVE_TOKENIZER = "js-tiktoken@1.0.21/o200k_base+chat-allowance-64";
export declare const CHAT_FRAMING_ALLOWANCE = 64;
export declare const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export declare const DEEPSEEK_MODEL_SETTINGS: Readonly<{
    model: "deepseek-flash";
    thinking: Readonly<{
        readonly type: "disabled";
    }>;
}>;
export declare const RELAYCORE_BASE_URL: string;
export declare const RELAYCORE_MODEL_SETTINGS: Readonly<{
    model: "deepseek-v4.1-flash-1017";
    thinking: Readonly<{
        readonly type: "disabled";
    }>;
}>;
export declare const DEEPSEEK_TOKENIZER_ID: string;
/** 对发出的完整 user 消息分词，额外留出消息封装余量。
 * 源码中的特殊标记按普通文本计数，实际用量仍以 provider 的 usage 为准。 */
export declare function countReviewTokens(prompt: string): number;
export declare function createLiveReview(apiKey: string, baseURL: string, signal?: AbortSignal): ReviewFiles;
