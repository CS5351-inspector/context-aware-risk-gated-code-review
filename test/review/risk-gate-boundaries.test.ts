import { calculateRisk } from '../../src/review/risk';
import { decideGate } from '../../src/review/gate';
import { loadFixture, manifest } from '../support/sprint1-fixture';
import type { ApprovalReview, ReviewConfig } from '../../src/review/contracts';

const sample = () => structuredClone(loadFixture(manifest.scenarios.find(entry => entry.id === 'clean-context')!));
const approval = (commitSha: string, patch: Partial<ApprovalReview> = {}): ApprovalReview => ({
  id: 1, login: 'reviewer-b', actorType: 'User', permission: 'write', commitSha,
  state: 'APPROVED', submittedAt: '2026-01-01T00:00:00Z', ...patch,
});

test('analysis cannot hide a supported PR file from the risk calculation', () => {
  const f = sample();
  f.input.changedFiles.push({ ...f.input.changedFiles[0], path: 'src/extra.ts' });
  expect(() => calculateRisk(f.input, f.expected.result, f.config as ReviewConfig)).toThrow();
});
test('excluded scope must agree with the PR rather than introducing another file', () => {
  const f = sample(); f.expected.result.scope.excludedFiles.push('docs/outside.md');
  expect(() => calculateRisk(f.input, f.expected.result, f.config as ReviewConfig)).toThrow();
});
test.each([
  (a: any) => { a.findings = [{ severity: 'critical', validation: 'VERIFIED' }]; },
  (a: any) => { a.findings = [null]; },
  (a: any) => { a.omissions = [{ required: undefined }]; },
  (a: any) => { a.scope.supportedFiles = [null]; a.scope.analyzedFiles = [null]; },
  (a: any) => { a.scope.analyzedFiles.push(a.scope.analyzedFiles[0]); },
  (a: any) => { a.findings = [{ id: 'f', file: 'src/caller.ts', side: 'RIGHT', line: null,
    severity: 'low', validation: 'VERIFIED', message: 'bad location', evidenceIds: [] }]; },
])('malformed analysis is ERROR even with an otherwise qualified approval', change => {
  const f = sample(); change(f.expected.result);
  f.gateContext.reviews = [approval(f.input.headSha)];
  expect(() => calculateRisk(f.input, f.expected.result, f.config as ReviewConfig)).toThrow();
  expect(decideGate(f.expected.result, f.expected.result.risk, f.gateContext, f.config as ReviewConfig).state).toBe('ERROR');
});
test('invalid calendar dates cannot authorize a human override', () => {
  const f = sample(); f.expected.result.analysisStatus = 'FAILED';
  f.gateContext.reviews = [approval(f.input.headSha, { submittedAt: '2026-02-30T00:00:00Z' })];
  const risk = calculateRisk(f.input, f.expected.result, f.config as ReviewConfig);
  expect(decideGate(f.expected.result, risk, f.gateContext, f.config as ReviewConfig).state).toBe('ERROR');
});
test('conflicting actor types for one identity cannot create a human approval', () => {
  const f = sample(); f.expected.result.analysisStatus = 'FAILED';
  f.gateContext.reviews = [approval(f.input.headSha, { actorType: 'Bot' }),
    approval(f.input.headSha, { id: 2, state: 'COMMENTED', submittedAt: '2026-01-01T00:00:01Z' })];
  const risk = calculateRisk(f.input, f.expected.result, f.config as ReviewConfig);
  expect(decideGate(f.expected.result, risk, f.gateContext, f.config as ReviewConfig).state).toBe('ERROR');
});
