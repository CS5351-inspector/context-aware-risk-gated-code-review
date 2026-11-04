import { manifest, loadFixture, fixtureDirectory } from '../support/sprint1-fixture';
import { replayUnifiedDiff, verifyFixtureDiffs, verifyGateFixture, verifyEvidenceFixture } from '../support/sprint1-integrity';
import type { GateContext, DecideGate } from '../../src/review/contracts';

const sample = (id: string) => {
  const entry = manifest.scenarios.find((entry) => entry.id === id)!;
  return { fixture: loadFixture(entry), directory: fixtureDirectory(entry) };
};

describe('Reject tampered fixture expectations (not production Gate tests)', () => {
  test('a diff with unchanged counts but a false body is rejected', async () => {
    const { fixture, directory } = sample('context-bug');
    fixture.input.changedFiles[0].patch = fixture.input.changedFiles[0].patch!.replace('+  return !isAllowed(role);', '+  return true;');
    fixture.input.diff = fixture.input.changedFiles[0].patch!;
    await expect(verifyFixtureDiffs(fixture, directory)).rejects.toThrow('Diff does not produce head');
  });
  test('a wrong hunk count is rejected', async () => {
    const { fixture, directory } = sample('context-bug');
    fixture.input.changedFiles[0].patch = fixture.input.changedFiles[0].patch!.replace('@@ -1,5 +1,5 @@', '@@ -1,6 +1,5 @@');
    fixture.input.diff = fixture.input.changedFiles[0].patch!;
    await expect(verifyFixtureDiffs(fixture, directory)).rejects.toThrow('Old hunk count mismatch');
  });
  test('missing gate author/head metadata is rejected', () => {
    const { fixture } = sample('high-approved');
    fixture.gateContext = { ...fixture.gateContext, prAuthor: '', reviewedHeadSha: '' };
    expect(() => verifyGateFixture(fixture)).toThrow('Gate author mismatch');
  });
  test('stale success is rejected', () => {
    const { fixture } = sample('stale-run');
    fixture.expected.result.gate.state = 'PASS';
    expect(() => verifyGateFixture(fixture)).toThrow('Stale head must not pass');
  });
  test('HIGH success without human approval is rejected', () => {
    const { fixture } = sample('context-bug');
    fixture.expected.result.gate.state = 'PASS';
    expect(() => verifyGateFixture(fixture)).toThrow('Missing human approval');
  });
  test('author approval and duplicate approvals are rejected', () => {
    const { fixture } = sample('high-approved');
    fixture.expected.result.gate.validApprovers = [fixture.input.author];
    expect(() => verifyGateFixture(fixture)).toThrow('Author cannot approve');
    fixture.expected.result.gate.validApprovers = ['reviewer-b', 'reviewer-b'];
    expect(() => verifyGateFixture(fixture)).toThrow('Duplicate approvers');
  });
  test('withdrawn approval cannot be relabelled as valid', () => {
    const { fixture } = sample('approval-dismissed');
    fixture.expected.result.gate.validApprovers = ['reviewer-b'];
    expect(() => verifyGateFixture(fixture)).toThrow('Invalid effective approver');
  });
  test('an oracle cannot lower the configured human approval threshold', () => {
    const { fixture } = sample('approval-duplicate');
    fixture.expected.result.gate.state = 'PASS';
    fixture.expected.result.gate.requiredApprovals = 1;
    expect(() => verifyGateFixture(fixture)).toThrow('Approval threshold mismatch');
  });
  test('login casing cannot count a reviewer twice or allow author self-approval', () => {
    const { fixture } = sample('approval-two-people');
    fixture.expected.result.gate.validApprovers = ['reviewer-b', 'REVIEWER-B'];
    expect(() => verifyGateFixture(fixture)).toThrow('Duplicate approvers');
    fixture.expected.result.gate.validApprovers = [fixture.input.author.toUpperCase()];
    expect(() => verifyGateFixture(fixture)).toThrow('Author cannot approve');
  });
  test('case changes and timestamp offsets do not hide a later changes request', () => {
    const { fixture } = sample('high-approved');
    fixture.gateContext.reviews.push({
      ...fixture.gateContext.reviews[0], id: 2, login: 'REVIEWER-B',
      state: 'CHANGES_REQUESTED', submittedAt: '2026-11-02T20:00:02-04:00',
    });
    expect(() => verifyGateFixture(fixture)).toThrow('Invalid effective approver');
  });
  test('dangling evidence and lower risk for a retained high finding are rejected', async () => {
    const { fixture, directory } = sample('invalid-evidence');
    fixture.expected.result.findings[0].evidenceIds = ['C404'];
    await expect(verifyEvidenceFixture(fixture, directory)).rejects.toThrow('Dangling evidence reference');
    fixture.expected.result.findings[0].evidenceIds = [];
    fixture.expected.result.risk.level = 'UNKNOWN';
    await expect(verifyEvidenceFixture(fixture, directory)).rejects.toThrow('Retained high finding must remain HIGH');
  });
  test('LEFT evidence uses diffBaseSha and cannot be borrowed from headSha', async () => {
    const { fixture, directory } = sample('distinct-diff-base');
    const snippet = fixture.expected.result.snippets[0];
    snippet.ref = fixture.input.diffBaseSha;
    snippet.code = snippet.code.replace('Boolean(isAllowed(role))', 'isAllowed(role)');
    fixture.expected.result.findings = [{
      id: 'F-left', file: 'src/caller.ts', side: 'LEFT', line: 4,
      severity: 'medium', message: 'Check removed behavior', evidenceIds: [snippet.id], validation: 'VERIFIED',
    }];
    await expect(verifyEvidenceFixture(fixture, directory)).resolves.toBeUndefined();
    snippet.ref = fixture.input.headSha;
    snippet.code = snippet.code.replace('return isAllowed(role);', 'return Boolean(isAllowed(role));');
    await expect(verifyEvidenceFixture(fixture, directory)).rejects.toThrow('Evidence side/ref mismatch');
  });
  test('failure fixture cannot drop its missing-patch disclosure', async () => {
    const { fixture, directory } = sample('missing-patch');
    fixture.expected.result.omissions = [];
    await expect(verifyFixtureDiffs(fixture, directory)).rejects.toThrow('Missing patch must be disclosed');
  });
  test('zero-length insertion/deletion hunk offsets are handled', () => {
    replayUnifiedDiff('', '--- /dev/null\n+++ b/a.js\n@@ -0,0 +1 @@\n+hello\n', 'hello\n');
    replayUnifiedDiff('hello\n', '--- a/a.js\n+++ /dev/null\n@@ -1 +0,0 @@\n-hello\n', '');
    expect(() => replayUnifiedDiff('hello\n', '--- a/a.js\n+++ b/a.js\n@@ -1 +2 @@\n-hello\n+world\n', 'world\n')).toThrow('Invalid new hunk offset');
  });
  test('gate implementation signature can explicitly see author and both heads', () => {
    const context: GateContext = sample('high-approved').fixture.gateContext;
    const inspect: DecideGate = (_analysis, _risk, gateInput, _config) => ({
      state: gateInput.reviewedHeadSha === gateInput.currentHeadSha ? 'WAITING' : 'STALE',
      reasons: [gateInput.prAuthor], requiredApprovals: 1, validApprovers: [],
    });
    const { fixture } = sample('high-approved');
    expect(inspect(fixture.expected.result, fixture.expected.result.risk, context, fixture.config as Parameters<DecideGate>[3]).reasons).toEqual(['author-a']);
  });
});
