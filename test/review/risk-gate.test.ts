import { calculateRisk } from '../../src/review/risk';
import { decideGate } from '../../src/review/gate';
import { runReviewPipeline } from '../../src/pipeline';
import { createMockProviders } from '../../src/mocks';
import { loadFixture, manifest } from '../support/sprint1-fixture';
import type { AnalysisResult, ApprovalReview, ReviewConfig } from '../../src/review/contracts';

const fixture = (id = 'clean-context') => loadFixture(manifest.scenarios.find(entry => entry.id === id)!);
const config = () => structuredClone(fixture().config) as ReviewConfig;
const analysis = (): AnalysisResult => structuredClone(fixture().expected.result);
const context = () => structuredClone(fixture().gateContext);
const high = () => structuredClone(fixture('context-bug').expected.result);
const review = (patch: Partial<ApprovalReview> = {}): ApprovalReview => ({
  id: 1, login: 'reviewer-b', actorType: 'User', permission: 'write',
  commitSha: context().reviewedHeadSha, state: 'APPROVED', submittedAt: '2026-11-09T00:00:01Z', ...patch,
});
const gate = (reviews: ApprovalReview[] = [], a = high(), c = config()) =>
  decideGate(a, calculateRisk(fixture().input, a, c), { ...context(), reviews }, c);

// D 单元边界：这里使用约定的分析结果作为输入，不伪称重新运行了 B/C。
describe('shared 55 scenarios at D boundary', () => {
  test.each(manifest.scenarios.map(entry => [entry.id, entry] as const))('%s', (_id, entry) => {
    const f = loadFixture(entry);
    const c = f.config as ReviewConfig;
    if (!f.expected.configValid) {
      expect(() => calculateRisk(f.input, f.expected.result, c)).toThrow();
      expect(decideGate(f.expected.result, f.expected.result.risk, f.gateContext, c)).toEqual(f.expected.result.gate);
      return;
    }
    const risk = calculateRisk(f.input, f.expected.result, c);
    expect(risk.level).toBe(f.expected.result.risk.level);
    expect(risk.ruleVersion).toBe(c.ruleVersion);
    expect(risk.factors).toEqual(expect.arrayContaining(f.expected.result.risk.factors));
    // DecideGate 没有仓库字段，fork 策略在拥有 ReviewInput 的 A 流水线执行。
    if (f.id !== 'fork-pr') expect(decideGate(f.expected.result, risk, f.gateContext, c)).toEqual(f.expected.result.gate);
  });
});

test.each([199, 200, 201])('change-size line boundary %i includes additions and deletions', lines => {
  const i = structuredClone(fixture().input);
  i.changedFiles[0].additions = lines - 1; i.changedFiles[0].deletions = 1;
  expect(calculateRisk(i, analysis(), config()).level).toBe(lines >= 200 ? 'MEDIUM' : 'LOW');
});
test.each([2, 3, 4])('all changed files contribute to file boundary %i', count => {
  const i = structuredClone(fixture().input);
  i.changedFiles = Array.from({ length: count }, (_, n) => ({
    ...i.changedFiles[0], path: 'docs/' + n + '.md', supported: false, additions: 0, deletions: 0,
  }));
  const a = analysis(); a.analysisStatus = 'NOT_APPLICABLE';
  a.scope = { supportedFiles: [], analyzedFiles: [], excludedFiles: i.changedFiles.map(file => file.path) };
  expect(calculateRisk(i, a, config()).level).toBe(count >= 3 ? 'MEDIUM' : 'LOW');
});
test.each(['old', 'new'])('renaming a sensitive path checks the %s path', side => {
  const i = structuredClone(fixture().input);
  i.changedFiles[0] = { ...i.changedFiles[0], status: 'renamed', supported: false,
    path: side === 'new' ? 'policy/guard/rule.ts' : 'docs/rule.ts',
    previousPath: side === 'old' ? 'policy/guard/rule.ts' : 'docs/rule.ts' };
  const a = analysis(); a.analysisStatus = 'NOT_APPLICABLE';
  a.scope = { supportedFiles: [], analyzedFiles: [], excludedFiles: [i.changedFiles[0].path] };
  const c = config(); c.sensitivePaths = ['policy/guard/**'];
  expect(calculateRisk(i, a, c).level).toBe('HIGH');
});
test('unlocated high survives FAILED and a required omission', () => {
  const a = high(); a.analysisStatus = 'FAILED'; a.findings[0].validation = 'UNLOCATED';
  expect(calculateRisk(fixture().input, a, config()).level).toBe('HIGH');
});
test.each([
  (a: AnalysisResult) => { a.omissions.push({ file: null, stage: 'model', reason: 'TIMEOUT', required: true }); },
  (a: AnalysisResult) => { a.scope.analyzedFiles = []; },
  (a: AnalysisResult) => { a.findings.push({ ...high().findings[0], severity: 'low', validation: 'UNVERIFIED' }); },
])('a misleading COMPLETE does not auto-pass', change => {
  const a = analysis(); change(a);
  expect(calculateRisk(fixture().input, a, config()).level).toBe('UNKNOWN');
  // 即使调用方传了 LOW，覆盖防线也仍要求人工接管。
  expect(decideGate(a, { level: 'LOW', factors: [], ruleVersion: config().ruleVersion }, context(), config()).state).toBe('WAITING');
});
test.each([-1, NaN, Infinity, 0.5])('invalid change count %s cannot produce a risk decision', additions => {
  const i = structuredClone(fixture().input); i.changedFiles[0].additions = additions;
  expect(() => calculateRisk(i, analysis(), config())).toThrow();
});
test('functions leave all caller objects unchanged', () => {
  const f = fixture('high-approved'); const before = JSON.stringify(f);
  const r = calculateRisk(f.input, f.expected.result, f.config as ReviewConfig);
  decideGate(f.expected.result, r, f.gateContext, f.config as ReviewConfig);
  expect(JSON.stringify(f)).toBe(before);
});
test('config and version errors cannot be overridden with approvals', () => {
  const a = high(); const c = config();
  expect(decideGate(a, a.risk, { ...context(), reviews: [review()], configValid: false }, c).state).toBe('ERROR');
  expect(decideGate(a, { ...a.risk, ruleVersion: 'old' }, { ...context(), reviews: [review()] }, c).state).toBe('ERROR');
});
test('stale and malformed SHA cannot be overridden', () => {
  const a = high(); const c = config();
  expect(decideGate(a, a.risk, { ...context(), currentHeadSha: 'd'.repeat(40), reviews: [review()] }, c).state).toBe('STALE');
  expect(decideGate(a, a.risk, { ...context(), reviewedHeadSha: '' }, c).state).toBe('ERROR');
});
test('LOW risk cannot be paired with retained high', () => {
  expect(decideGate(high(), { level: 'LOW', factors: [], ruleVersion: config().ruleVersion }, context(), config()).state).toBe('ERROR');
});
test.each(['read', 'triage'] as const)('%s permission is not an approval', permission => {
  expect(gate([review({ permission })]).state).toBe('WAITING');
});
test.each(['write', 'maintain', 'admin'] as const)('%s permission is eligible', permission => {
  expect(gate([review({ permission })]).state).toBe('PASS');
});
test('case-insensitive identity prevents author approval and duplicate people', () => {
  expect(gate([review({ login: context().prAuthor.toUpperCase() })]).state).toBe('WAITING');
  const c = config(); c.requiredApprovals = 2;
  expect(gate([review(), review({ id: 2, login: 'REVIEWER-B' })], high(), c).validApprovers).toEqual(['reviewer-b']);
  expect(gate([review(), review({ id: 2, login: 'REVIEWER-B' })], high(), c).state).toBe('WAITING');
});
test('timezone offsets sort by instant, not text; COMMENTED preserves approval', () => {
  const reviews = [review({ id: 2, state: 'DISMISSED', submittedAt: '2026-11-09T08:00:00+08:00' }),
    review({ submittedAt: '2026-11-09T00:00:01Z' }),
    review({ id: 3, state: 'COMMENTED', submittedAt: '2026-11-09T00:00:02Z' })];
  expect(gate(reviews).state).toBe('PASS');
  expect(gate([...reviews].reverse()).state).toBe('PASS');
});
test('timestamp ties use review ID, and latest dismissal invalidates approval', () => {
  expect(gate([review(), review({ id: 2, state: 'DISMISSED' })]).state).toBe('WAITING');
});
test('same ID duplicate is idempotent but conflicting snapshots are ERROR', () => {
  expect(gate([review(), review()]).state).toBe('PASS');
  expect(gate([review(), review({ state: 'DISMISSED' })]).state).toBe('ERROR');
});
test.each([
  { id: 0 }, { submittedAt: 'bad' }, { submittedAt: '2026-11-09T00:00:01' },
  { permission: 'owner' as any }, { commitSha: '' }, { login: '' },
])('malformed history does not pass: %j', patch => {
  expect(gate([review(patch)]).state).toBe('ERROR');
});
test('latest observed permission loss prevents retaining an old approval', () => {
  expect(gate([review(), review({ id: 2, permission: 'read', state: 'COMMENTED',
    submittedAt: '2026-11-09T00:00:02Z' })]).state).toBe('WAITING');
});
test('qualified changes request blocks even a clean LOW review and other approvals', () => {
  const a = analysis(); const c = config();
  const ctx = { ...context(), reviews: [review(), review({ id: 2, login: 'reviewer-c',
    state: 'CHANGES_REQUESTED', commitSha: 'a'.repeat(40) })] };
  expect(decideGate(a, calculateRisk(fixture().input, a, c), ctx, c).reasons).toEqual(['CHANGES_REQUESTED']);
  ctx.reviews.push(review({ id: 3, login: 'reviewer-c', state: 'DISMISSED',
    submittedAt: '2026-11-09T00:00:03Z' }));
  expect(decideGate(a, calculateRisk(fixture().input, a, c), ctx, c).state).toBe('PASS');
});
test('author, bot and read-only changes requests cannot block an eligible human', () => {
  for (const patch of [{ login: context().prAuthor }, { actorType: 'Bot' as const }, { permission: 'read' as const }]) {
    expect(gate([review(), review({ id: 2, login: 'reviewer-c', state: 'CHANGES_REQUESTED', ...patch })]).state).toBe('PASS');
  }
});
test('the production pipeline explicitly injects D and preserves HIGH after human approval', async () => {
  const f = fixture('high-approved'); const p = createMockProviders();
  p.risk = calculateRisk; p.gate = decideGate;
  p.context = async () => f.expected.context;
  p.review = async () => ({ ...f.expected.result, analyzedFiles: f.expected.result.scope.analyzedFiles });
  const r = await runReviewPipeline(f.input, f.config as ReviewConfig, f.gateContext, p);
  expect(r.risk.level).toBe('HIGH'); expect(r.gate.state).toBe('PASS'); expect(r.provider).toBe('mock');
});
test('forks stop at A input boundary before model or file calls', async () => {
  const f = fixture('fork-pr'); const p = createMockProviders();
  p.risk = calculateRisk; p.gate = decideGate;
  p.context = jest.fn(); p.readFile = jest.fn(); p.review = jest.fn();
  const r = await runReviewPipeline(f.input, f.config as ReviewConfig, f.gateContext, p);
  expect(r.gate).toEqual(f.expected.result.gate);
  expect(r.analysisStatus).toBe('FAILED');
  expect(p.context).not.toHaveBeenCalled(); expect(p.readFile).not.toHaveBeenCalled(); expect(p.review).not.toHaveBeenCalled();
});

test('GitHub bot login syntax is valid history but never counts as human approval', () => {
  expect(gate([review({ login: 'github-actions[bot]', actorType: 'Bot' })]).state).toBe('WAITING');
});

test('a mislabeled bot login cannot count as human approval', () => {
  expect(gate([review({ login: 'github-actions[bot]', actorType: 'User' })]).state).toBe('WAITING');
});
