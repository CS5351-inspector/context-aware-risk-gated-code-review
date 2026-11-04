/** Fixture consistency checks only; NOT a production diff parser or risk engine. */
import assert from 'assert';
import type { SprintFixture } from './sprint1-fixture';
import { createSnapshotReader } from './sprint1-fixture';

function sourceLines(source: string): string[] {
  if (source === '') return [];
  const result = source.split('\n');
  if (source.endsWith('\n')) result.pop();
  return result;
}

/** Reconstruct head from base; counts alone cannot detect a dishonest diff body. */
export function replayUnifiedDiff(base: string, patch: string, head: string): void {
  const old = sourceLines(base);
  const expected = sourceLines(head);
  const lines = sourceLines(patch);
  assert(lines.shift()?.startsWith('--- '), 'Missing old file header');
  assert(lines.shift()?.startsWith('+++ '), 'Missing new file header');
  let cursor = 0;
  const actual: string[] = [];
  let hunks = 0;
  while (lines.length > 0) {
    const header = lines.shift()!.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/);
    assert(header, 'Invalid hunk header');
    hunks++;
    const oldCount = Number(header[2] ?? 1);
    const newCount = Number(header[4] ?? 1);
    const oldStart = Number(header[1]) - (oldCount === 0 ? 0 : 1);
    const newStart = Number(header[3]) - (newCount === 0 ? 0 : 1);
    assert(oldStart >= cursor && oldStart <= old.length, 'Invalid old hunk offset');
    actual.push(...old.slice(cursor, oldStart));
    cursor = oldStart;
    assert.strictEqual(actual.length, newStart, 'Invalid new hunk offset');
    let removed = 0;
    let added = 0;
    while (lines.length && !lines[0].startsWith('@@')) {
      const line = lines.shift()!;
      assert([' ', '+', '-'].includes(line[0]), 'Invalid diff body');
      if (line[0] !== '+') {
        assert(cursor < old.length, 'Diff exceeds base');
        assert.strictEqual(old[cursor++], line.slice(1), 'Diff contradicts base');
        removed++;
      }
      if (line[0] !== '-') { actual.push(line.slice(1)); added++; }
    }
    assert.strictEqual(removed, oldCount, 'Old hunk count mismatch');
    assert.strictEqual(added, newCount, 'New hunk count mismatch');
  }
  assert(hunks > 0, 'Missing diff hunk');
  actual.push(...old.slice(cursor));
  assert.deepStrictEqual(actual, expected, 'Diff does not produce head');
  // Sprint 1 fixtures intentionally have LF-terminated text; no-newline markers
  // and arbitrary third-party diffs require a production parser, not this helper.
}

export async function verifyFixtureDiffs(fixture: SprintFixture, directory: string): Promise<void> {
  const read = createSnapshotReader(fixture, directory);
  const input = fixture.input;
  assert.strictEqual(input.diff, input.changedFiles.map((file) => file.patch ?? '').join('\n'), 'Combined diff mismatch');
  for (const file of input.changedFiles) {
    if (file.patch === null) {
      assert(fixture.expected.result.omissions.some((o) => o.file === file.path && o.reason === 'MISSING_PATCH' && o.required), 'Missing patch must be disclosed');
      continue;
    }
    const oldPath = file.previousPath ?? file.path;
    const oldSnapshot = fixture.snapshots.find((s) => s.file === oldPath && s.ref === input.diffBaseSha);
    const newSnapshot = fixture.snapshots.find((s) => s.file === file.path && s.ref === input.headSha);
    if (oldSnapshot?.error || newSnapshot?.error) {
      assert(fixture.expected.result.omissions.some((o) => o.file === file.path && o.reason === 'FILE_READ_FAILED' && o.required), 'Failed source read must be disclosed');
      continue;
    }
    assert(file.status === 'added' || oldSnapshot, 'Missing old-side source');
    assert(file.status === 'removed' || newSnapshot, 'Missing head source');
    const base = file.status === 'added' ? '' : await read(oldPath, input.diffBaseSha);
    const head = file.status === 'removed' ? '' : await read(file.path, input.headSha);
    const headers = sourceLines(file.patch);
    assert.strictEqual(headers[0], '--- ' + (file.status === 'added' ? '/dev/null' : 'a/' + oldPath), 'Old header path mismatch');
    assert.strictEqual(headers[1], '+++ ' + (file.status === 'removed' ? '/dev/null' : 'b/' + file.path), 'New header path mismatch');
    replayUnifiedDiff(base, file.patch, head);
  }
}

/** Check an oracle's necessary invariants; this deliberately does not compute Gate. */
export function verifyGateFixture(fixture: SprintFixture): void {
  const { input, gateContext, expected } = fixture;
  const identity = (login: string) => login.toLowerCase();
  assert.strictEqual(identity(gateContext.prAuthor), identity(input.author), 'Gate author mismatch');
  assert.strictEqual(gateContext.reviewedHeadSha, input.headSha, 'Reviewed head mismatch');
  const { gate, risk, analysisStatus } = expected.result;
  assert.strictEqual(new Set(gate.validApprovers.map(identity)).size, gate.validApprovers.length, 'Duplicate approvers');
  if (gateContext.configValid) {
    const required = (fixture.config as { requiredApprovals: unknown }).requiredApprovals;
    assert(typeof required === 'number' && Number.isInteger(required) && required >= 1, 'Invalid approval threshold');
    assert.strictEqual(gate.requiredApprovals, required, 'Approval threshold mismatch');
  }
  const permission = new Set(['write', 'maintain', 'admin']);
  const effectiveReview = (login: string) => gateContext.reviews
    .filter((review) => identity(review.login) === identity(login) && review.state !== 'COMMENTED')
    .slice().sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || a.id - b.id).pop();
  for (const login of gate.validApprovers) {
    assert.notStrictEqual(identity(login), identity(input.author), 'Author cannot approve');
    const effective = effectiveReview(login);
    assert(effective, 'Missing approval history');
    assert(effective.state === 'APPROVED' && effective.actorType === 'User' && permission.has(effective.permission) && effective.commitSha === input.headSha, 'Invalid effective approver');
  }
  if (!gateContext.configValid) assert.strictEqual(gate.state, 'ERROR', 'Invalid config must not pass');
  else if (gateContext.currentHeadSha !== input.headSha) assert.strictEqual(gate.state, 'STALE', 'Stale head must not pass');
  if (gate.state === 'PASS') {
    assert(gateContext.configValid && gateContext.currentHeadSha === input.headSha, 'PASS requires current valid input');
    if (risk.level === 'HIGH' || risk.level === 'UNKNOWN' || analysisStatus !== 'COMPLETE') {
      assert(gate.validApprovers.length >= gate.requiredApprovals && gate.requiredApprovals >= 1, 'Missing human approval');
    }
    const users = new Set(gateContext.reviews.filter((review) => review.actorType === 'User' && permission.has(review.permission) && identity(review.login) !== identity(input.author)).map((review) => identity(review.login)));
    for (const login of users) {
      const decision = effectiveReview(login);
      assert(decision?.state !== 'CHANGES_REQUESTED', 'Unresolved changes request');
    }
  }
}

/** Evidence must remain tied to the reviewed snapshot even in a handwritten oracle. */
export async function verifyEvidenceFixture(fixture: SprintFixture, directory: string): Promise<void> {
  const { input, expected } = fixture;
  const { snippets, findings } = expected.result;
  const read = createSnapshotReader(fixture, directory);
  assert.strictEqual(new Set(snippets.map((snippet) => snippet.id)).size, snippets.length, 'Duplicate evidence ID');
  for (const snippet of snippets) {
    assert([input.headSha, input.diffBaseSha].includes(snippet.ref), 'Evidence uses unrelated snapshot');
    assert(Number.isInteger(snippet.startLine) && Number.isInteger(snippet.endLine) && snippet.startLine >= 1 && snippet.endLine >= snippet.startLine, 'Invalid evidence range');
    const lines = sourceLines(await read(snippet.file, snippet.ref));
    assert(snippet.endLine <= lines.length, 'Evidence exceeds snapshot');
    assert.strictEqual(lines.slice(snippet.startLine - 1, snippet.endLine).join('\n'), snippet.code, 'Evidence contradicts snapshot');
  }
  for (const finding of findings) {
    const changed = input.changedFiles.find((file) => file.path === finding.file);
    assert(changed, 'Finding refers to a file outside this PR');
    assert(['LEFT', 'RIGHT'].includes(finding.side), 'Invalid finding side');
    const ref = finding.side === 'LEFT' ? input.diffBaseSha : input.headSha;
    for (const id of finding.evidenceIds) {
      const snippet = snippets.find((item) => item.id === id);
      assert(snippet, 'Dangling evidence reference');
      assert.strictEqual(snippet.ref, ref, 'Evidence side/ref mismatch');
    }
    if (finding.validation === 'VERIFIED') {
      const file = finding.side === 'LEFT' ? changed.previousPath ?? finding.file : finding.file;
      const lines = sourceLines(await read(file, ref));
      assert(finding.line !== null && Number.isInteger(finding.line) && finding.line >= 1 && finding.line <= lines.length, 'Invalid verified finding location');
    }
  }
  if (findings.some((finding) => finding.severity === 'high')) {
    assert.strictEqual(expected.result.risk.level, 'HIGH', 'Retained high finding must remain HIGH');
  }
}
