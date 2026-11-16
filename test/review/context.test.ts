import { resolve } from 'node:path';
import { manifest, loadFixture, fixtureDirectory, createSnapshotReader } from '../support/sprint1-fixture';
import { collectContext } from '../../src/review/context';
import type { Budget } from '../../src/review/contracts';

// B 的上下文 oracle 只覆盖其负责的 context 模式样例；其余 context 样例由 C/D/E 决定。
const contextCases = manifest.scenarios
  .map((entry) => ({ entry, fixture: loadFixture(entry) }))
  .filter(({ fixture }) => fixture.owners.includes('b') && fixture.input.mode === 'context');

describe('B context module matches the shared context oracle', () => {
  test.each(contextCases.map(({ entry, fixture }) => [fixture.id, entry, fixture] as const))(
    '%s',
    async (_id, entry, fixture) => {
      const read = createSnapshotReader(fixture, fixtureDirectory(entry));
      const budget = (fixture.config as { budget: Budget }).budget;
      await expect(collectContext(fixture.input, read, budget)).resolves.toEqual(fixture.expected.context);
    }
  );
});

const sample = contextCases.find(({ fixture }) => fixture.id === 'context-bug')!.fixture;
const baseBudget = (sample.config as { budget: Budget }).budget;

function inputForFiles(paths: string[], patch = '@@ -1 +1 @@\n-before\n+after') {
  return {
    ...sample.input,
    changedFiles: paths.map(path => ({ ...sample.input.changedFiles[0], path, patch, supported: true })),
  };
}

function pinnedReader(files: Record<string, string>, ref = sample.input.headSha) {
  return jest.fn(async (file: string, sha: string) => {
    if (sha !== ref) throw new Error('Unexpected ref');
    if (!Object.prototype.hasOwnProperty.call(files, file)) throw Object.assign(new Error(file), { code: 'ENOENT' });
    return files[file];
  });
}

test.each(['review.js', 'review.ts'])('an explicit .js import in %s prefers the real .js file', async file => {
  const read = pinnedReader({
    [file]: "import { value } from './q.js';",
    'q.js': 'export const value = 12;',
    'q.ts': 'export const value = 14;',
  });
  const result = await collectContext(inputForFiles([file]), read, baseBudget);
  expect(result.snippets.filter(s => s.reason === 'direct-definition')).toEqual([
    expect.objectContaining({ file: 'q.js', code: 'export const value = 12;' }),
  ]);
  expect(read.mock.calls.map(([path]) => path)).toEqual([file, 'q.js']);
  expect(result.omissions).toEqual([]);
});

test('a forbidden explicit module cannot be replaced by a similarly named file', async () => {
  const read = jest.fn(async (file: string) => {
    if (file === 'entry.ts') return "import { f } from './q.js';";
    if (file === 'q.js') throw Object.assign(new Error('Denied'), { status: 403 });
    return 'export const f = 12;';
  });
  const result = await collectContext(inputForFiles(['entry.ts']), read, baseBudget);
  expect(read.mock.calls.flat()).toEqual(['entry.ts', sample.input.headSha, 'q.js', sample.input.headSha]);
  expect(result.omissions).toEqual([{ file: 'q.js', stage: 'context', reason: 'OPTIONAL_CONTEXT_UNAVAILABLE', required: false }]);
});

test('file and lookup limits count failed attempts and duplicate imports consume no extra reads', async () => {
  const read = pinnedReader({
    'entry.js': [
      "const {f: first} = require('./missing');", "const {f: second} = require('./missing');",
      "const {g} = require('./later.js');",
    ].join('\n'),
    'later.js': 'exports.g = 42;',
    'next.js': 'const next = true;',
  });
  const result = await collectContext(inputForFiles(['entry.js', 'next.js']), read,
    { ...baseBudget, maxFiles: 1, maxDefinitionsPerFile: 1 });
  expect(read.mock.calls).toEqual([['entry.js', sample.input.headSha], ['missing.js', sample.input.headSha]]);
  expect(result.omissions).toEqual([
    { file: 'missing.js', stage: 'context', reason: 'OPTIONAL_CONTEXT_UNAVAILABLE', required: false },
    { file: 'entry.js', stage: 'context', reason: 'CONTEXT_BUDGET', required: false },
    { file: 'next.js', stage: 'context', reason: 'FILE_BUDGET', required: true },
  ]);
});

test('two changed files share one exact-SHA lookup, and overlapping evidence is emitted once', async () => {
  const source = "const {get} = require('./dep');";
  const read = pinnedReader({ 'a.js': source, 'b.js': source, 'dep.js': 'exports.get = () => 1;' });
  const result = await collectContext(inputForFiles(['a.js', 'b.js']), read, baseBudget);
  expect(result.snippets.filter(s => s.reason === 'direct-definition')).toHaveLength(1);
  expect(read.mock.calls.map(([path]) => path)).toEqual(['a.js', 'dep.js', 'b.js']);
});

test('reads stay in the repository and cannot be introduced by a comment', async () => {
  const read = pinnedReader({
    'src/a.js': "const { f } = require('../../outside.js');\n/* const { g } = require('./hidden.js'); */",
  });
  const result = await collectContext(inputForFiles(['src/a.js']), read, baseBudget);
  expect(read.mock.calls.map(([path]) => path)).toEqual(['src/a.js']);
  expect(result.snippets.filter(s => s.reason === 'direct-definition')).toEqual([]);
});

test('an oversized local hunk yields bounded source lines and a visible omission', async () => {
  const source = Array.from({ length: 350 }, (_v, i) => 'const x' + i + ' = 1;').join('\n');
  const result = await collectContext(inputForFiles(['many.js'], '@@ -1 +1,350 @@'), pinnedReader({ 'many.js': source }), baseBudget);
  expect(result.snippets).toHaveLength(1);
  expect(result.snippets[0]).toMatchObject({ startLine: 1, endLine: 256 });
  expect(result.omissions).toContainEqual({ file: 'many.js', stage: 'context', reason: 'CONTEXT_BUDGET', required: false });
});

// Source loader used by F's actual experiment. The retriever sees only snapshot paths and texts.
const { load, inputFor } = require('../../evaluation/lib/data.cjs');
const dataset = resolve(__dirname, '../../evaluation');
const cases = load(dataset);
test.each([
  ['DEV-001', 'policy.js', 'const GRANTED = 0;'],
  ['DEV-003', 'scheduler.js', 'exports.after'],
  ['DEV-011', 'cache.js', 'exports.lookup'],
  ['DEV-013', 'range.js', 'exports.takeRange'],
])('%s reads a real CommonJS export from the frozen snapshot', async (id, target, code) => {
  const data = inputFor(dataset, cases.find((item: { case: { case_id: string } }) => item.case.case_id === id));
  const input = { ...inputForFiles(data.changedFiles, data.diff), headSha: data.headSha };
  const read = pinnedReader(data.files, data.headSha);
  const result = await collectContext(input, read, { ...baseBudget, maxFiles: 1, maxDefinitionsPerFile: 3 });
  expect(result.omissions).toEqual([]);
  expect(result.snippets).toContainEqual(expect.objectContaining({
    file: target, reason: 'direct-definition', ref: data.headSha, code: expect.stringContaining(code),
  }));
  expect(read.mock.calls).toEqual([['review.js', data.headSha], [target, data.headSha]]);
});
