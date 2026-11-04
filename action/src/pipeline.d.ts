/** A-owned orchestration. Providers are explicit: mocks can never silently fill a live stage. */
import type { ReviewInput, ContextResult, ModelAnalysis, ReviewResult, ReviewConfig, GateContext, CollectContext, ReviewFiles, CalculateRisk, DecideGate, ReadFileAtRef, AnalysisStatus } from './review/contracts.js';
export interface PipelineProviders {
    provider: 'mock' | 'live';
    readFile: ReadFileAtRef;
    context: CollectContext;
    review: ReviewFiles;
    risk: CalculateRisk;
    gate: DecideGate;
}
export declare function deriveAnalysisStatus(input: ReviewInput, context: ContextResult, model: ModelAnalysis): AnalysisStatus;
export declare function runReviewPipeline(input: ReviewInput, config: ReviewConfig, gateContext: GateContext, providers: PipelineProviders): Promise<ReviewResult>;
