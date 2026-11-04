import { collectSnapshot, PullRequestSnapshotMetadata, SnapshotFile, SnapshotGitHubPort, SnapshotRequest } from '../src/review/snapshot.js';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const MERGE_BASE = 'c'.repeat(40);
const NEW_COMMIT = 'd'.repeat(40);

function setup() {
  const request: SnapshotRequest = {
    repo: { owner: 'team', name: 'reviewer' }, prNumber: 12, runId: 'run-1',
    trigger: 'pull_request.synchronize', mode: 'context',
  };
  const metadata: PullRequestSnapshotMetadata = {
    repo: { ...request.repo }, sourceRepo: { owner: 'contributor', name: 'fork' },
    prNumber: 12, author: 'contributor', baseSha: BASE, headSha: HEAD, changedFiles: 1,
  };
  const files: SnapshotFile[] = [{
    path: 'src/review.ts', status: 'modified', additions: 1, deletions: 1,
    patch: '@@ -1 +1 @@\n-old\n+new',
  }];
  const getPullRequest = jest.fn().mockImplementation(async () => structuredClone(metadata));
  const listChangedFiles = jest.fn().mockResolvedValue(files);
  const getMergeBase = jest.fn().mockResolvedValue(MERGE_BASE);
  const readFile = jest.fn().mockResolvedValue('captured file contents');
  const github: SnapshotGitHubPort = { getPullRequest, listChangedFiles, getMergeBase, readFile };
  return { request, metadata, files, github, getPullRequest, listChangedFiles, getMergeBase, readFile };
}

describe('immutable PR input collection', () => {
  test('pins fork head and actual merge base separately from target base', async () => {
    const s = setup();
    const { input, readFileAtRef } = await collectSnapshot(s.request, s.github);
    expect(s.getPullRequest).toHaveBeenCalledTimes(2);
    expect(s.getMergeBase).toHaveBeenCalledWith({
      repo: s.request.repo, sourceRepo: s.metadata.sourceRepo, baseSha: BASE, headSha: HEAD,
    });
    expect(input).toMatchObject({ baseSha: BASE, headSha: HEAD, diffBaseSha: MERGE_BASE, author: 'contributor' });
    expect(input.diff).toBe('diff --git a/src/review.ts b/src/review.ts\n--- a/src/review.ts\n+++ b/src/review.ts\n@@ -1 +1 @@\n-old\n+new\n');
    await readFileAtRef('src/review.ts', HEAD);
    await readFileAtRef('src/old.ts', MERGE_BASE);
    expect(s.readFile.mock.calls).toEqual([
      [s.metadata.sourceRepo, 'src/review.ts', HEAD],
      [s.request.repo, 'src/old.ts', MERGE_BASE],
    ]);
  });

  test('does not allow branch names or target base to replace the captured refs', async () => {
    const s = setup();
    const { readFileAtRef } = await collectSnapshot(s.request, s.github);
    for (const ref of ['main', BASE, NEW_COMMIT]) {
      await expect(readFileAtRef('src/review.ts', ref)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    await expect(readFileAtRef('../secret', HEAD)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(s.readFile).not.toHaveBeenCalled();
  });

  test('clones adapter/caller objects and freezes every exposed input object', async () => {
    const s = setup();
    const snapshot = await collectSnapshot(s.request, s.github);
    s.files[0].patch = 'changed after collection';
    s.files.push({ ...s.files[0], path: 'new.js' });
    s.metadata.sourceRepo.owner = 'different-contributor';
    s.request.repo.owner = 'different-team';
    expect(snapshot.input.changedFiles).toHaveLength(1);
    expect(snapshot.input.changedFiles[0].patch).toContain('+new');
    expect(snapshot.input.repo.owner).toBe('team');
    expect(snapshot.input.sourceRepo.owner).toBe('contributor');
    for (const value of [snapshot, snapshot.input, snapshot.input.repo, snapshot.input.sourceRepo,
      snapshot.input.changedFiles, snapshot.input.changedFiles[0]]) expect(Object.isFrozen(value)).toBe(true);
    await snapshot.readFileAtRef('src/review.ts', HEAD);
    expect(s.readFile).toHaveBeenCalledWith({ owner: 'contributor', name: 'fork' }, 'src/review.ts', HEAD);
  });

  test('retains absent patches as supported work requiring later omission reporting', async () => {
    const s = setup();
    s.files[0].patch = null;
    const { input } = await collectSnapshot(s.request, s.github);
    expect(input.changedFiles[0]).toMatchObject({ supported: true, patch: null });
    expect(input.changedFiles[0].exclusionReason).toBeUndefined();
    expect(input.diff).toBe('');
  });

  test('declares exclusions and preserves counts for unsupported change kinds/extensions', async () => {
    const s = setup();
    s.files.splice(0, 1,
      { path: 'new.js', status: 'added', additions: 1, deletions: 0, patch: '@@ -0,0 +1 @@\n+new' },
      { path: 'readme.md', status: 'modified', additions: 1, deletions: 2, patch: null },
      { path: 'old.ts', status: 'removed', additions: 0, deletions: 2, patch: null },
      { path: 'new.ts', previousPath: 'old-name.ts', status: 'renamed', additions: 0, deletions: 0, patch: null },
      { path: 'copy.ts', status: 'copied', additions: 1, deletions: 0, patch: null },
    );
    s.metadata.changedFiles = s.files.length;
    const { input } = await collectSnapshot(s.request, s.github);
    expect(input.changedFiles.map((file) => file.supported)).toEqual([true, false, false, false, false]);
    expect(input.changedFiles.map((file) => file.exclusionReason)).toEqual([
      undefined, 'UNSUPPORTED_EXTENSION', 'UNSUPPORTED_CHANGE_STATUS:removed',
      'UNSUPPORTED_CHANGE_STATUS:renamed', 'UNSUPPORTED_CHANGE_STATUS:copied',
    ]);
    expect(input.changedFiles[1]).toMatchObject({ additions: 1, deletions: 2 });
    expect(input.changedFiles[4].status).toBe('other');
    expect(input.diff).toContain('--- /dev/null\n+++ b/new.js');
  });

  test.each(['headSha', 'baseSha'] as const)('rejects a moving %s', async (field) => {
    const s = setup();
    s.getPullRequest.mockResolvedValueOnce(s.metadata).mockResolvedValueOnce({ ...s.metadata, [field]: NEW_COMMIT });
    await expect(collectSnapshot(s.request, s.github)).rejects.toMatchObject({ code: 'PR_CHANGED' });
  });

  test('rejects a changed source repository even when commit SHAs match', async () => {
    const s = setup();
    s.getPullRequest.mockResolvedValueOnce(s.metadata).mockResolvedValueOnce({
      ...s.metadata, sourceRepo: { owner: 'someone-else', name: 'fork' },
    });
    await expect(collectSnapshot(s.request, s.github)).rejects.toMatchObject({ code: 'PR_CHANGED' });
  });

  test('copies the first metadata before awaiting adapters that may reuse its object', async () => {
    const s = setup();
    s.getPullRequest.mockResolvedValue(s.metadata);
    s.getMergeBase.mockImplementation(async () => {
      s.metadata.headSha = NEW_COMMIT;
      return MERGE_BASE;
    });
    await expect(collectSnapshot(s.request, s.github)).rejects.toMatchObject({ code: 'PR_CHANGED' });
  });

  test.each([null, '', 'main'])('rejects missing/invalid merge base %p', async (ref) => {
    const s = setup();
    s.getMergeBase.mockResolvedValue(ref);
    await expect(collectSnapshot(s.request, s.github)).rejects.toMatchObject({ code: 'MISSING_MERGE_BASE' });
  });

  test('rejects a truncated paginated file list', async () => {
    const s = setup();
    s.metadata.changedFiles = 2;
    await expect(collectSnapshot(s.request, s.github)).rejects.toMatchObject({ code: 'INCOMPLETE_FILE_LIST' });
    expect(s.getMergeBase).not.toHaveBeenCalled();
  });

  test('rejects duplicated pages even when their total count matches', async () => {
    const s = setup();
    s.files.push({ ...s.files[0] });
    s.metadata.changedFiles = 2;
    await expect(collectSnapshot(s.request, s.github)).rejects.toMatchObject({ code: 'INCOMPLETE_FILE_LIST' });
  });

  test('rejects invalid line counts instead of treating them as zero risk', async () => {
    const s = setup();
    s.files[0].deletions = -1;
    await expect(collectSnapshot(s.request, s.github)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  test('does not substitute metadata from another PR', async () => {
    const s = setup();
    s.metadata.prNumber = 13;
    await expect(collectSnapshot(s.request, s.github)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(s.listChangedFiles).not.toHaveBeenCalled();
  });

  test('propagates collection errors; a failed API call produces no usable input', async () => {
    const s = setup();
    s.listChangedFiles.mockRejectedValue(new Error('GitHub unavailable'));
    await expect(collectSnapshot(s.request, s.github)).rejects.toThrow('GitHub unavailable');
  });
});
