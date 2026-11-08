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
