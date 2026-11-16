/// <reference types="node" />
import type { ReviewFiles } from './contracts.js';
export declare const LIVE_TOKENIZER = "js-tiktoken@1.0.21/o200k_base/gpt-4o-mini-2024-07-18";
/** Mirror Chat.completeReview's single user message, including chat framing.
 * Source text resembling special tokens must be tokenized as ordinary text.
 * Provider-reported usage remains the source for actual consumption. */
export declare function countReviewTokens(prompt: string): number;
export declare function createLiveReview(apiKey: string, signal?: AbortSignal): ReviewFiles;
