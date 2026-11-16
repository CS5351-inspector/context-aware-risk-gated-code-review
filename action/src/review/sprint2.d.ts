import type { ReviewConfig, ReviewResult } from './contracts.js';
export declare const sprintConfig: ReviewConfig;
export declare function renderSprintReport(result: ReviewResult, limit: number, cached: boolean): string;
