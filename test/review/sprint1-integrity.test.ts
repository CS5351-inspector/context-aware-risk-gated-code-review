import { manifest, loadFixture, fixtureDirectory } from '../support/sprint1-fixture';
import { replayUnifiedDiff, verifyFixtureDiffs, verifyGateFixture } from '../support/sprint1-integrity';
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
