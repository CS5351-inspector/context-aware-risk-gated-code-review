import type { ReviewConfig } from './contracts.js';

/** Preflight before any provider/network call. These are valid bounds, not tuned defaults. */
export function validateReviewConfig(config: ReviewConfig): void {
  if (!config || typeof config.ruleVersion !== 'string' || !config.ruleVersion.trim()
    || !Array.isArray(config.sensitivePaths)
    || config.sensitivePaths.some(path => typeof path !== 'string' || !path.trim()) || !config.budget) {
    throw new Error('Invalid review configuration');
  }
  const positive = ['requiredApprovals', 'mediumChangedLines', 'mediumChangedFiles', 'maxReportCharacters'] as const;
  for (const key of positive) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 1) throw new Error(`Invalid review configuration: ${key}`);
  }
  const keys = ['maxFiles', 'localWindowLines', 'maxDefinitionsPerFile', 'maxDefinitionLines',
    'maxInputTokens', 'reservedOutputTokens', 'maxCalls', 'requestTimeoutMs', 'analysisTimeoutMs',
    'publishReserveMs', 'maxRetries'] as const;
  for (const key of keys) {
    const minimum = ['maxRetries', 'publishReserveMs', 'localWindowLines', 'maxDefinitionsPerFile'].includes(key) ? 0 : 1;
    if (!Number.isSafeInteger(config.budget[key]) || config.budget[key] < minimum) {
      throw new Error(`Invalid review budget: ${key}`);
    }
  }
  if (config.budget.publishReserveMs >= config.budget.analysisTimeoutMs
    || config.budget.reservedOutputTokens >= config.budget.maxInputTokens) {
    throw new Error('Invalid review budget reservation');
  }
}
