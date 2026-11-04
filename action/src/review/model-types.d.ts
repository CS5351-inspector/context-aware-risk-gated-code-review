/** C's minimal projections of the shared schema; no duplicate domain definitions. */
import type { Budget, ChangedFile, Omission as SharedOmission, ReviewInput } from './contracts.js';
export type { Mode, Side, Severity, ContextSnippet, Finding, ModelAnalysis } from './contracts.js';
export type ModelInput = Pick<ReviewInput, 'headSha' | 'diffBaseSha' | 'mode'> & {
    changedFiles: Array<Pick<ChangedFile, 'path' | 'status' | 'patch' | 'supported'>>;
};
export type ModelBudget = Pick<Budget, 'maxFiles' | 'maxCalls' | 'maxRetries' | 'requestTimeoutMs' | 'analysisTimeoutMs' | 'publishReserveMs' | 'maxInputTokens' | 'reservedOutputTokens'>;
export type Omission = SharedOmission & {
    stage: 'model';
};
