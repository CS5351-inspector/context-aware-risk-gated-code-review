/** Explicit offline example. Never imported by the live pipeline. */
import type { ReviewInput, ReviewConfig, GateContext } from './review/contracts.js';
import type { PipelineProviders } from './pipeline.js';

export const mockPRInput: ReviewInput = {
  schemaVersion: '1', runId: 'offline-demo', repo: { owner: 'inspector', name: 'demo' },
  sourceRepo: { owner: 'inspector', name: 'demo' }, prNumber: 1, author: 'author', trigger: 'manual',
  baseSha: 'a'.repeat(40), diffBaseSha: 'b'.repeat(40), headSha: 'c'.repeat(40), mode: 'context',
  diff: '@@ -1 +1 @@\n-old\n+new', changedFiles: [{ path: 'src/demo.ts', status: 'modified',
    additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new', supported: true }],
};
export const mockConfig: ReviewConfig = {
  ruleVersion: 'offline-demo', requiredApprovals: 1, mediumChangedLines: 200, mediumChangedFiles: 10,
  sensitivePaths: [], maxReportCharacters: 10000,
  budget: { maxFiles: 10, localWindowLines: 20, maxDefinitionsPerFile: 2, maxDefinitionLines: 40,
    maxInputTokens: 4000, reservedOutputTokens: 1000, maxCalls: 10, requestTimeoutMs: 500,
    analysisTimeoutMs: 2000, publishReserveMs: 200, maxRetries: 1 },
};
export const mockGateContext: GateContext = { reviewedHeadSha: mockPRInput.headSha,
  currentHeadSha: mockPRInput.headSha, prAuthor: 'author', reviews: [], configValid: true };
export function createMockProviders(): PipelineProviders {
  return {
    provider: 'mock', readFile: async () => 'new',
    context: async () => ({ snippets: [], omissions: [] }),
    review: async input => ({ findings: [], omissions: [],
      analyzedFiles: input.changedFiles.filter(f => f.supported).map(f => f.path),
      metrics: { model: 'mock', effectiveParameters: {}, promptVersion: 'offline-demo',
        durationMs: 0, calls: 0, inputTokens: null, outputTokens: null } }),
    risk: (_input, analysis) => ({ level: analysis.findings.some(f => f.severity === 'high') ? 'HIGH'
      : analysis.analysisStatus === 'COMPLETE' ? 'LOW' : 'UNKNOWN',
      factors: ['Offline demonstration only'], ruleVersion: 'offline-demo' }),
    gate: () => ({ state: 'WAITING', reasons: ['Mock results never authorize a merge'],
      requiredApprovals: 1, validApprovers: [] }),
  };
}
