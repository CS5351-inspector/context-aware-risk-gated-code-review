import { collectSnapshot } from '../src/review/snapshot';
import type { SnapshotGitHubPort, SnapshotFile } from '../src/review/snapshot';

const base = 'a'.repeat(40), head = 'b'.repeat(40), merge = 'c'.repeat(40);
const repo = { owner: 'team', name: 'project' };
const request = { repo, prNumber: 1, runId: 'pinned', trigger: 'manual' as const, mode: 'context' as const };
const file: SnapshotFile = { path: 'src/a.js', status: 'modified', additions: 1, deletions: 1,
  patch: '@@ -1 +1 @@\n-old\n+reviewed' };

test('production-capable adapters collect the diff from immutable SHAs, never mutable PR files', async () => {
  const listChangedFilesAtRef = jest.fn().mockResolvedValue([file]);
  const listChangedFiles = jest.fn().mockResolvedValue([{ ...file, patch: '@@ -1 +1 @@\n-old\n+unrelated' }]);
  const port: SnapshotGitHubPort & { listChangedFilesAtRef: typeof listChangedFilesAtRef } = {
    getPullRequest: async () => ({ repo, sourceRepo: repo, prNumber: 1, author: 'author', baseSha: base, headSha: head, changedFiles: 1 }),
    getMergeBase: async () => merge, readFile: async () => 'reviewed',
    listChangedFiles, listChangedFilesAtRef,
  };
  const snapshot = await collectSnapshot(request, port);
  expect(listChangedFilesAtRef).toHaveBeenCalledWith(repo, merge, head);
  expect(listChangedFiles).not.toHaveBeenCalled();
  expect(snapshot.input.diff).toContain('+reviewed');
  expect(snapshot.input.diff).not.toContain('unrelated');
});

test('missing merge-base prevents an immutable comparison', async () => {
  const listChangedFilesAtRef = jest.fn();
  const port: SnapshotGitHubPort & { listChangedFilesAtRef: typeof listChangedFilesAtRef } = {
    getPullRequest: async () => ({ repo, sourceRepo: repo, prNumber: 1, author: 'author', baseSha: base, headSha: head, changedFiles: 1 }),
    getMergeBase: async () => null, readFile: async () => '', listChangedFiles: jest.fn(), listChangedFilesAtRef,
  };
  await expect(collectSnapshot(request, port)).rejects.toMatchObject({ code: 'MISSING_MERGE_BASE' });
  expect(listChangedFilesAtRef).not.toHaveBeenCalled();
});
