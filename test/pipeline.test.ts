import { runReviewPipeline } from '../src/pipeline';
import { createMockProviders, mockConfig, mockGateContext, mockPRInput } from '../src/mocks';
import { reviewFiles } from '../src/review/model-review';

const input = () => structuredClone(mockPRInput);
const run = (i = input(), p = createMockProviders()) => runReviewPipeline(i, mockConfig, mockGateContext, p);

test('requires every provider rather than silently using mocks', async () => {
  await expect(runReviewPipeline(input(), mockConfig, mockGateContext, undefined as any)).rejects.toThrow('explicitly');
});
test('explicit offline run is marked mock and cannot claim approval', async () => {
  const result = await run();
  expect(result.provider).toBe('mock');
  expect(result.analysisStatus).toBe('COMPLETE');
  expect(result.gate.state).toBe('WAITING');
});
test('diff-only skips B; real C module accepts the shared contract', async () => {
  const i = input(); i.mode = 'diff-only';
  const p = createMockProviders(); p.context = jest.fn();
  const completeReview = jest.fn(async () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"reviews":[]}' } }] }));
  p.review = (snapshot, snippets, budget) => reviewFiles({ effectiveParameters: { model: 'offline' }, completeReview },
    snapshot, snippets, budget, { countInputTokens: () => 10 });
  const result = await run(i, p);
  expect(p.context).not.toHaveBeenCalled();
  expect(completeReview).toHaveBeenCalledTimes(1);
  expect(result.analysisStatus).toBe('COMPLETE');
  expect(result.scope.analyzedFiles).toEqual(['src/demo.ts']);
});
test('excluded files are disclosed without downgrading completed supported analysis', async () => {
  const i = input(); i.changedFiles.push({ path: 'README.md', status: 'modified', additions: 1,
    deletions: 1, patch: null, supported: false, exclusionReason: 'Unsupported extension' });
  const result = await run(i);
  expect(result.analysisStatus).toBe('COMPLETE');
  expect(result.scope.excludedFiles).toEqual(['README.md']);
});
test('empty scope calls no model and is NOT_APPLICABLE', async () => {
  const i = input(); i.changedFiles[0].supported = false;
  const p = createMockProviders(); p.review = jest.fn();
  expect((await run(i, p)).analysisStatus).toBe('NOT_APPLICABLE');
  expect(p.review).not.toHaveBeenCalled();
});
test('required context omission makes partial, optional truncation does not', async () => {
  const p = createMockProviders();
  p.context = async () => ({ snippets: [], omissions: [{ file: 'src/demo.ts', stage: 'context', reason: 'CONTEXT_BUDGET', required: false }] });
  expect((await run(input(), p)).analysisStatus).toBe('COMPLETE');
  p.context = async () => ({ snippets: [], omissions: [{ file: 'src/demo.ts', stage: 'context', reason: 'FILE_READ_FAILED', required: true }] });
  expect((await run(input(), p)).analysisStatus).toBe('PARTIAL');
});
test('missing analysis cannot become COMPLETE even when provider forgot its omission', async () => {
  const p = createMockProviders(); const review = p.review;
  p.review = async (...args) => ({ ...await review(...args), analyzedFiles: ['outside-scope.ts'] });
  expect((await run(input(), p)).analysisStatus).toBe('FAILED');
});
test('model exception produces FAILED and required omission', async () => {
  const p = createMockProviders(); p.review = async () => { throw new Error('offline error'); };
  const result = await run(input(), p);
  expect(result.analysisStatus).toBe('FAILED');
  expect(result.omissions).toContainEqual({ file: null, stage: 'model', reason: 'SERVICE_ERROR', required: true });
});
test('known high finding survives partial analysis', async () => {
  const p = createMockProviders(); const review = p.review;
  p.review = async (...args) => ({ ...await review(...args), findings: [{ id: 'high', file: 'src/demo.ts',
    side: 'RIGHT', line: null, severity: 'high', message: 'retained', evidenceIds: [], validation: 'UNLOCATED' }],
    omissions: [{ file: null, stage: 'model', reason: 'INVALID_OUTPUT', required: true }] });
  const result = await run(input(), p);
  expect(result.analysisStatus).toBe('PARTIAL'); expect(result.risk.level).toBe('HIGH');
});
test('stale gate input never calls D to authorize current head', async () => {
  const p = createMockProviders(); p.gate = jest.fn();
  const result = await runReviewPipeline(input(), mockConfig, { ...mockGateContext, currentHeadSha: 'd'.repeat(40) }, p);
  expect(result.gate.state).toBe('STALE'); expect(p.gate).not.toHaveBeenCalled();
});
test('context time is deducted from C budget while preserving publication reserve', async () => {
  const p = createMockProviders(); const review = p.review;
  const now = jest.spyOn(Date, 'now').mockReturnValueOnce(1000).mockReturnValueOnce(1100).mockReturnValue(1100);
  p.review = jest.fn(review);
  try { await run(input(), p); } finally { now.mockRestore(); }
  expect(p.review).toHaveBeenCalledWith(expect.anything(), [], expect.objectContaining({ analysisTimeoutMs: 1900, publishReserveMs: 200 }));
});

test('wrong author is rejected before providers can accept author approval', async () => {
  const p = createMockProviders(); p.context = jest.fn();
  await expect(runReviewPipeline(input(), mockConfig, { ...mockGateContext, prAuthor: 'another-user' }, p)).rejects.toThrow('author');
  expect(p.context).not.toHaveBeenCalled();
});
test.each([
  { ...mockConfig, requiredApprovals: 0 },
  { ...mockConfig, budget: { ...mockConfig.budget, maxCalls: NaN } },
  { ...mockConfig, budget: { ...mockConfig.budget, reservedOutputTokens: mockConfig.budget.maxInputTokens } },
])('invalid config rejects before any provider side effect', async config => {
  const p = createMockProviders(); p.context = jest.fn();
  await expect(runReviewPipeline(input(), config, mockGateContext, p)).rejects.toThrow('Invalid');
  expect(p.context).not.toHaveBeenCalled();
});
test('configValid=false cannot be overridden by stale or approved gate state', async () => {
  const p = createMockProviders(); p.gate = jest.fn();
  await expect(runReviewPipeline(input(), mockConfig, { ...mockGateContext, configValid: false }, p)).rejects.toThrow('not valid');
  expect(p.gate).not.toHaveBeenCalled();
});
test('an unresponsive model provider cannot consume the publication reserve', async () => {
  const p = createMockProviders(); p.review = () => new Promise(() => {});
  const config = { ...mockConfig, budget: { ...mockConfig.budget, analysisTimeoutMs: 30, publishReserveMs: 10 } };
  const result = await runReviewPipeline(input(), config, mockGateContext, p);
  expect(result.analysisStatus).toBe('FAILED');
  expect(result.omissions.some(o => o.reason === 'TIMEOUT' && o.required)).toBe(true);
});
