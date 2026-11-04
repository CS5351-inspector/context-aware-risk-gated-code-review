/** Explicit offline example. Never imported by the live pipeline. */
import type { ReviewInput, ReviewConfig, GateContext } from './review/contracts.js';
import type { PipelineProviders } from './pipeline.js';
export declare const mockPRInput: ReviewInput;
export declare const mockConfig: ReviewConfig;
export declare const mockGateContext: GateContext;
export declare function createMockProviders(): PipelineProviders;
