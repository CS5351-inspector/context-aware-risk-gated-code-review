/**
 * Integrity tests for the proposed contracts/fixtures, NOT an implementation
 * test for the future risk/gate/context/report/pipeline modules.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  manifest, loadFixture, fixtureDirectory, createSnapshotReader, createScriptedModel,
} from '../support/sprint1-fixture';
import { verifyFixtureDiffs, verifyGateFixture } from '../support/sprint1-integrity';
import type { ReviewResult, CalculateRisk, DecideGate, CollectContext, RenderReport } from '../../src/review/contracts';

const cases = manifest.scenarios.map((entry) => ({ entry, fixture: loadFixture(entry) }));
const get = (id: string) => {
  const item = cases.find((value) => value.fixture.id === id);
  if (!item) throw new Error(`Missing fixture ${id}`);
  return item;
};

describe('Sprint 1 fixture catalogue (not production acceptance)', () => {
  test('has unique scenario IDs, both dataset splits and every role', () => {
    const ids = cases.map(({ fixture }) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(40);
    expect(new Set(cases.map(({ fixture }) => fixture.split))).toEqual(new Set(['development', 'reserved']));
    expect(new Set(cases.flatMap(({ fixture }) => fixture.owners))).toEqual(new Set(['a', 'b', 'c', 'd', 'e', 'f']));
  });

  test.each(cases.map(({ entry, fixture }) => [fixture.id, entry, fixture] as const))(
    '%s: JSON, source snapshots and expected outcome are internally consistent',
    async (_id, entry, fixture) => {
      expect(fixture.id).toBe(entry.id);
      expect(fixture.split).toBe(entry.split);
      expect(fixture.owners).toEqual(entry.owners);
      await verifyFixtureDiffs(fixture, fixtureDirectory(entry));
      verifyGateFixture(fixture);
      const input = fixture.input;
      const result: ReviewResult = fixture.expected.result;
      expect(input.schemaVersion).toBe('1');
      expect(result.schemaVersion).toBe('1');
      expect(result.runId).toBe(input.runId);
      expect(result.headSha).toBe(input.headSha);
      expect(result.repo).toEqual(input.repo);
      expect(result.mode).toBe(input.mode);
      expect(result.provider).toBe('mock');
      for (const sha of [input.baseSha, input.diffBaseSha, input.headSha]) expect(sha).toMatch(/^[a-f0-9]{40}$/);
      expect(new Set(input.changedFiles.map((file) => file.path)).size).toBe(input.changedFiles.length);
      const supported = input.changedFiles.filter((file) => file.supported).map((file) => file.path);
      const excluded = input.changedFiles.filter((file) => !file.supported).map((file) => file.path);
      expect(result.scope.supportedFiles).toEqual(supported);
      expect(result.scope.excludedFiles).toEqual(excluded);
      for (const path of result.scope.analyzedFiles) expect(supported).toContain(path);
      for (const file of input.changedFiles) {
        if (!file.supported) expect(file.exclusionReason).toBeTruthy();
        if (file.patch !== null) {
          const lines = file.patch.split('\n');
          expect(file.additions).toBe(lines.filter((line) => line.startsWith('+') && !line.startsWith('+++')).length);
          expect(file.deletions).toBe(lines.filter((line) => line.startsWith('-') && !line.startsWith('---')).length);
        }
      }
      const read = createSnapshotReader(fixture, fixtureDirectory(entry));
      for (const snapshot of fixture.snapshots) {
        if (snapshot.error) await expect(read(snapshot.file, snapshot.ref)).rejects.toThrow(snapshot.error);
        else expect(await read(snapshot.file, snapshot.ref)).toBe(readFileSync(resolve(fixtureDirectory(entry), snapshot.contentFile!), 'utf8'));
      }
      expect(result.snippets).toEqual(fixture.expected.context.snippets);
      expect(new Set(result.snippets.map((snippet) => snippet.id)).size).toBe(result.snippets.length);
      for (const snippet of result.snippets) {
        expect(snippet.ref).toBe(input.headSha);
        expect(snippet.startLine).toBeGreaterThanOrEqual(1);
        expect(snippet.endLine).toBeGreaterThanOrEqual(snippet.startLine);
        const source = await read(snippet.file, snippet.ref);
        const lines = source.replace(/\n$/, '').split('\n');
        expect(snippet.endLine).toBeLessThanOrEqual(lines.length);
        expect(lines.slice(snippet.startLine - 1, snippet.endLine).join('\n')).toBe(snippet.code);
      }
      for (const finding of result.findings) {
        expect(['low', 'medium', 'high']).toContain(finding.severity);
        expect(finding.message.length).toBeGreaterThan(0);
        if (finding.validation === 'VERIFIED') {
          expect(input.changedFiles.map((file) => file.path)).toContain(finding.file);
          expect(finding.line).not.toBeNull();
          const source = await read(finding.file, finding.side === 'RIGHT' ? input.headSha : input.diffBaseSha);
          expect(finding.line!).toBeGreaterThanOrEqual(1);
          expect(finding.line!).toBeLessThanOrEqual(source.trimEnd().split('\n').length);
          for (const id of finding.evidenceIds) expect(result.snippets.map((snippet) => snippet.id)).toContain(id);
        }
      }
      if (input.mode === 'diff-only') expect(result.snippets).toEqual([]);
      if (result.analysisStatus === 'COMPLETE') {
        expect(result.scope.analyzedFiles).toEqual(supported);
        expect(supported.length).toBeGreaterThan(0);
        expect(result.omissions.some((omission) => omission.required)).toBe(false);
      }
      if (result.analysisStatus === 'NOT_APPLICABLE') expect(supported).toEqual([]);
      if (result.analysisStatus === 'FAILED') expect(result.scope.analyzedFiles).toEqual([]);
      if (result.analysisStatus === 'PARTIAL') {
        expect(result.scope.analyzedFiles.length).toBeGreaterThan(0);
        expect(result.omissions.some((omission) => omission.required)).toBe(true);
      }
      expect(result.metrics.calls).toBe(fixture.modelAttempts.length);
      expect(result.metrics.durationMs).toBe(fixture.modelAttempts.reduce((total, attempt) => total + attempt.elapsedMs, 0));
      expect(result.metrics.inputTokens).toBeNull();
      expect(fixture.expected.shouldCallModel).toBe(fixture.modelAttempts.length > 0);
      if (fixture.expected.publication.status === 'PUBLISHED') {
        expect(fixture.expected.publication.commitStatus).toBe(
          { PASS: 'success', WAITING: 'pending', ERROR: 'failure', STALE: null }[result.gate.state]
        );
      } else expect(fixture.expected.publication.commitStatus).toBeNull();
      expect(fixture.expected.report.contains).toEqual(expect.arrayContaining(['MOCK', input.headSha, result.analysisStatus, result.risk.level, result.gate.state]));
    }
  );
});

describe('Local adapters enforce scripted input boundaries', () => {
  test('wrong SHA and unknown path fail instead of silently reading latest code', async () => {
    const { entry, fixture } = get('context-bug');
    const read = createSnapshotReader(fixture, fixtureDirectory(entry));
    await expect(read('src/caller.ts', '0'.repeat(40))).rejects.toThrow('UNSCRIPTED_READ');
    await expect(read('src/missing.ts', fixture.input.headSha)).rejects.toThrow('UNSCRIPTED_READ');
    expect(await read('src/caller.ts', fixture.input.diffBaseSha)).not.toContain('return !isAllowed');
    expect(await read('src/caller.ts', fixture.input.headSha)).toContain('return !isAllowed');
  });
  test('snapshot path traversal is rejected', async () => {
    const { entry, fixture } = get('clean-context');
    const tampered = JSON.parse(JSON.stringify(fixture)) as typeof fixture;
    tampered.snapshots[1].contentFile = '../scenario.json';
    await expect(createSnapshotReader(tampered, fixtureDirectory(entry))('src/caller.ts', fixture.input.headSha)).rejects.toThrow('escapes');
  });
  test('raw provider output is independent from the expected oracle', async () => {
    const { fixture } = get('context-bug');
    const tampered = JSON.parse(JSON.stringify(fixture)) as typeof fixture;
    tampered.expected.result.findings = [];
    tampered.expected.result.risk.level = 'LOW';
    const model = createScriptedModel(tampered);
    const response = await model.complete('src/caller.ts');
    expect(JSON.parse(response.content!).findings[0].severity).toBe('high');
    expect(model.calls).toBe(1);
    await expect(model.complete('src/caller.ts')).rejects.toThrow('UNSCRIPTED_CALL');
  });
  test('429 consumes an attempt, success can follow, instances are isolated', async () => {
    const { fixture } = get('rate-limit-recovered');
    const first = createScriptedModel(fixture);
    const second = createScriptedModel(fixture);
    await expect(first.complete('src/caller.ts')).rejects.toThrow('rate-limit');
    await expect(first.complete('src/caller.ts')).resolves.toMatchObject({ outcome: 'response' });
    expect(first.calls).toBe(2);
    expect(second.calls).toBe(0);
    await expect(first.complete('src/caller.ts')).rejects.toThrow('UNSCRIPTED_CALL');
  });
  test('an unexpected file does not consume the next scripted attempt', async () => {
    const model = createScriptedModel(get('clean-context').fixture);
    await expect(model.complete('src/typo.ts')).rejects.toThrow('UNSCRIPTED_CALL');
    expect(model.calls).toBe(0);
  });
});

// Compile-time examples: these functions consume fixture expectations only.
// They illustrate the ports and are deliberately not exported production engines.
test('shared module signatures can be consumed independently by team members', async () => {
  const { fixture } = get('context-bug');
  const collect: CollectContext = async () => fixture.expected.context;
  const risk: CalculateRisk = () => fixture.expected.result.risk;
  const gate: DecideGate = () => fixture.expected.result.gate;
  const report: RenderReport = (result) => `${result.provider.toUpperCase()} ${result.risk.level}`;
  expect((await collect(fixture.input, async () => '', (fixture.config as { budget: Parameters<CollectContext>[2] }).budget)).snippets).toHaveLength(2);
  expect(typeof risk).toBe('function');
  expect(typeof gate).toBe('function');
  expect(report(fixture.expected.result)).toBe('MOCK HIGH');
});
