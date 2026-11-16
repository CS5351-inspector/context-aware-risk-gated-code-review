import { renderSprintReport } from '../../src/review/sprint2';
import type { ReviewResult } from '../../src/review/contracts';

const result: ReviewResult = {
  schemaVersion: '1', provider: 'live', runId: '1-1', repo: { owner: 'team', name: 'repo' },
  prNumber: 1, headSha: 'a'.repeat(40), mode: 'context', analysisStatus: 'PARTIAL',
  scope: { analyzedFiles: ['a.js'], supportedFiles: ['a.js','b.js'], excludedFiles: ['README.md'] },
  risk: { level: 'UNKNOWN', factors: ['ANALYSIS_UNAVAILABLE'], ruleVersion: 'v1' },
  gate: { state: 'PASS', reasons: ['HUMAN_APPROVED'], requiredApprovals: 1, validApprovers: ['member'] },
  snippets: [], findings: [{ id: 'F1', file: 'a.js', side: 'RIGHT', line: null, severity: 'low',
    message: '<img> @team', evidenceIds: [], validation: 'UNLOCATED' }],
  omissions: [{ stage: 'model', file: 'b.js', reason: 'TIMEOUT', required: true }],
  metrics: { promptVersion: 'v', model: 'test', effectiveParameters: {}, durationMs: 5, calls: 2,
    inputTokens: null, outputTokens: null },
};

test('reports human takeover, actual coverage, unknown usage and unlocated findings', () => {
  const text = renderSprintReport(result, 12000, true);
  for (const value of ['Human takeover', '1/2 supported', 'unknown/unknown', 'line unavailable',
    'TIMEOUT', 'no new model calls', 'README.md', '&lt;img&gt;']) expect(text).toContain(value);
  expect(text).not.toContain('@team');
});

test('keeps the outcome and labels the cutoff in a long report', () => {
  const text = renderSprintReport(result, 170, false);
  expect(text.length).toBeLessThanOrEqual(170);
  expect(text).toContain('UNKNOWN risk · PASS · PARTIAL');
  expect(text).toContain('Report shortened');
});
