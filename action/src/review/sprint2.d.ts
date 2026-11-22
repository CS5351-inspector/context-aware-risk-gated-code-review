import type { PublicationReceipt, ReviewConfig, ReviewResult } from './contracts.js';
export declare const sprintConfig: ReviewConfig;
export declare function renderSprintReport(result: ReviewResult, limit: number, cached: boolean): string;
/** A fallback for the Actions summary/receipt when GitHub did not accept the normal report. */
export declare function renderSprintPublicationFailure(result: ReviewResult, receipt: PublicationReceipt): string;
