import { renderSprintPublicationFailure, renderSprintReport } from '../../src/review/sprint2';
import type { PublicationReceipt, ReviewResult } from '../../src/review/contracts';

const result: ReviewResult = {
  schemaVersion: '1', provider: 'live', runId: '1-1', repo: { owner: 'team', name: 'repo' },
  prNumber: 1, headSha: 'a'.repeat(40), mode: 'context', analysisStatus: 'PARTIAL',
  scope: { analyzedFiles: ['a.js'], supportedFiles: ['a.js', 'b.js'], excludedFiles: ['README.md'] },
  risk: { level: 'UNKNOWN', factors: ['ANALYSIS_UNAVAILABLE'], ruleVersion: 'v1' },
  gate: { state: 'PASS', reasons: ['HUMAN_APPROVED'], requiredApprovals: 1, validApprovers: ['member'] },
  snippets: [], findings: [{ id: 'F1', file: 'a.js', side: 'RIGHT', line: null, severity: 'low',
    message: '<img> @team', evidenceIds: [], validation: 'UNLOCATED' }],
  omissions: [{ stage: 'model', file: 'b.js', reason: 'TIMEOUT', required: true }],
  metrics: { promptVersion: 'v', model: 'test', effectiveParameters: {}, durationMs: 5, calls: 2,
    inputTokens: null, outputTokens: null },
};

const clone = (): ReviewResult => structuredClone(result);

test('reports human takeover, actual coverage, unknown usage and unlocated findings', () => {
  const text = renderSprintReport(clone(), 12000, true);
  for (const value of ['Human takeover', '1/2 supported', 'unknown/unknown', 'line unavailable',
    'TIMEOUT', 'no new model calls', 'README.md', '&lt;img&gt;', 'What was checked',
    'What was skipped and why', 'Why the run stopped', 'Not analyzed: b.js']) expect(text).toContain(value);
  expect(text).not.toContain('@team');
});

test('a normal report links findings to evidence at an immutable ref and records resources', () => {
  const normal = clone();
  normal.analysisStatus = 'COMPLETE';
  normal.scope = { analyzedFiles: ['a.js'], supportedFiles: ['a.js'], excludedFiles: [] };
  normal.risk = { level: 'LOW', factors: ['SMALL_CHANGE'], ruleVersion: 'v1' };
  normal.gate = { state: 'PASS', reasons: ['LOW_RISK'], requiredApprovals: 1, validApprovers: [] };
  normal.findings = [{ id: 'F1', file: 'a.js', side: 'RIGHT', line: 3, severity: 'low',
    message: 'Check the boundary', evidenceIds: ['E1'], validation: 'VERIFIED' }];
  normal.omissions = [];
  normal.snippets = [{ id: 'E1', file: 'lib.js', ref: 'b'.repeat(40), startLine: 8, endLine: 10,
    code: 'return value;', reason: 'direct-definition' }];
  normal.metrics = { ...normal.metrics, durationMs: 1234, calls: 1, inputTokens: 100, outputTokens: 20,
    tokenizerId: 'test-tokenizer', effectiveParameters: { temperature: 0 } };
  const text = renderSprintReport(normal, 12000, false);
  for (const value of ['LOW risk · PASS · COMPLETE', 'No skipped files or omissions',
    'no stopping condition', 'E1: lib.js, lines 8–10', `ref \`${'b'.repeat(40)}\``,
    'Duration: 1234 ms', 'Calls including retries: 1', '100/20', 'test-tokenizer',
    'temperature', 'queue and dependency-installation time']) expect(text).toContain(value);
  expect(text).not.toContain('Report shortened');
});

test('a failed analysis is explicit even when no findings were returned', () => {
  const failed = clone();
  failed.analysisStatus = 'FAILED';
  failed.scope.analyzedFiles = [];
  failed.findings = [];
  failed.risk = { level: 'UNKNOWN', factors: ['ANALYSIS_UNAVAILABLE'], ruleVersion: 'v1' };
  failed.gate = { state: 'ERROR', reasons: ['ANALYSIS_FAILED'], requiredApprovals: 1, validApprovers: [] };
  const text = renderSprintReport(failed, 12000, false);
  expect(text).toContain('No findings were returned, but analysis is FAILED; this is not a clean result.');
  expect(text).toContain('Required work was not completed: TIMEOUT');
  expect(text).toContain('Incomplete analysis is not a safe pass');
});

test('a stale report directs the reviewer to the current head instead of a generic error', () => {
  const stale = clone();
  stale.gate.state = 'STALE';
  expect(renderSprintReport(stale, 12000, false)).toContain('Start a new review for the current head');
});

test('keeps identity, outcome and next action ahead of detail in a long report', () => {
  const text = renderSprintReport(clone(), 170, false);
  expect(text.length).toBeLessThanOrEqual(170);
  expect(text).toContain('UNKNOWN risk · PASS · PARTIAL');
  expect(text).toContain(`SHA: \`${'a'.repeat(40)}\``);
  expect(text).toContain('Next: Check required status before merging.');
  expect(text).toContain('Report shortened');
  expect(text).not.toContain('### Findings');
});

test('a shortened report retains coverage, stop reason and finding counts when space permits', () => {
  const busy = clone();
  busy.findings = Array.from({ length: 30 }, (_, index) => ({ ...busy.findings[0],
    id: `F${index}`, message: `finding ${index} ${'detail '.repeat(30)}` }));
  const text = renderSprintReport(busy, 1200, false);
  expect(text.length).toBeLessThanOrEqual(1200);
  expect(text).toContain('Coverage: 1/2 supported files analyzed');
  expect(text).toContain('Stopped: Required work was not completed: TIMEOUT');
  expect(text).toContain('Findings: 30 (0 high/0 medium/30 low)');
  expect(text).toContain('Report shortened');
});

test.each([1, 10, 40, 80, 170, 400])('every positive limit is respected: %s', limit => {
  const text = renderSprintReport(clone(), limit, false);
  expect(text.length).toBeLessThanOrEqual(limit);
  if (limit >= 17) expect(text).toContain('shortened');
});

test.each([0, -1, 1.5, Number.NaN])('rejects an invalid report limit: %s', limit => {
  expect(() => renderSprintReport(clone(), limit, false)).toThrow('positive integer');
});

test('publication failure fallback preserves the run, accepted writes and recovery action', () => {
  const receipt: PublicationReceipt = { status: 'FAILED', commentId: null, commitStatus: 'pending',
    error: 'Failed to create review report' };
  const text = renderSprintPublicationFailure(clone(), receipt);
  for (const value of ['report publication failed', `Reviewed SHA: \`${'a'.repeat(40)}\``,
    'Run: `1-1`', 'Last confirmed commit status: pending', 'Comment: not confirmed',
    'Failed to create review report', 'correct GitHub permissions or API configuration',
    'does not change the analysis or gate decision']) expect(text).toContain(value);
});
