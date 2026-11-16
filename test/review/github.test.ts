import { createGitHubPorts, GitHubHttpError, type GitHubPortsOptions } from '../../src/review/github.js';
import { collectSnapshot } from '../../src/review/snapshot.js';

const repo = { owner: 'group', name: 'project' };
const repoJson = { name: 'project', owner: { login: 'group' } };
const base = '/repos/group/project', pull = `${base}/pulls/5`;
const head = 'a'.repeat(40), target = 'b'.repeat(40), merge = 'c'.repeat(40);
const pr = { number: 5, state: 'open', changed_files: 2, user: { login: 'author' },
  head: { repo: repoJson, sha: head, ref: 'feature' }, base: { repo: repoJson, sha: target, ref: 'sprint2-demo' } };
const alpha = { filename: 'lib/a.js', additions: 3, deletions: 1, status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' };
const beta = { filename: 'lib/b.ts', previous_filename: 'lib/old.ts', additions: 0, deletions: 0, status: 'renamed' };
const review = { id: 9, user: { login: 'reviewer', type: 'User' }, state: 'APPROVED',
  commit_id: head, submitted_at: '2026-11-16T09:00:00Z', author_association: 'OWNER' };
const listed = (what: string, page = 1) => `${pull}/${what}?per_page=100&page=${page}`;
type FetchMock = NonNullable<GitHubPortsOptions['fetch']>;
type Reply = { value?: unknown; status?: number; link?: string };
function server(routes: Record<string, Reply | (() => Reply)>, options: Partial<GitHubPortsOptions> = {}) {
  const calls: { path: string; init: Parameters<FetchMock>[1] }[] = [];
  const send: FetchMock = async (url, init) => {
    expect(url.startsWith('https://api.github.com/')).toBe(true);
    const path = url.slice('https://api.github.com'.length);
    calls.push({ path, init });
    const handler = routes[path];
    if (!handler) throw new Error(`Unexpected route ${path}`);
    const { value, link, status = 200 } = typeof handler === 'function' ? handler() : handler;
    return { ok: status < 300, status, headers: { get: name => name === 'link' ? link ?? null : null },
      json: async () => value };
  };
  return { ...createGitHubPorts({ token: 'test', fetch: send, ...options }), calls };
}

it('paginates actual changed files and binds merge-base and content to immutable commit IDs', async () => {
  const comparison = `${base}/compare/${target}...${head}?per_page=1`;
  const fileUrl = `${base}/contents/lib/a%20%23%3F.js?ref=${head}`;
  const { snapshot, getTarget, calls } = server({
    [pull]: { value: pr }, [listed('files')]: { value: [alpha], link: '<https://example.invalid/not-used>; rel="next"' },
    [listed('files', 2)]: { value: [beta] }, [comparison]: { value: { merge_base_commit: { sha: merge } } },
    [fileUrl]: { value: { type: 'file', size: 3, encoding: 'base64', content: Buffer.from('aß').toString('base64') } },
  });
  await expect(getTarget(repo, 5)).resolves.toEqual({ open: true, baseRef: 'sprint2-demo', headRef: 'feature', headSha: head, baseSha: target, sourceRepo: repo });
  const { input, readFileAtRef } = await collectSnapshot({ repo, prNumber: 5, runId: 'run', mode: 'context', trigger: 'manual' }, snapshot);
  expect(input.diffBaseSha).toBe(merge);
  expect(input.changedFiles).toMatchObject([{ supported: true }, { supported: false, previousPath: 'lib/old.ts' }]);
  await expect(readFileAtRef('lib/a #?.js', head)).resolves.toBe('aß');
  await expect(snapshot.readFile(repo, 'file.js', 'main')).rejects.toThrow('SHA');
  await expect(snapshot.readFile(repo, '../file.js', head)).rejects.toThrow('segment');
  expect(calls.filter(call => call.path === listed('files', 2))).toHaveLength(1);
});

it('keeps HTTP 404 available and rejects missing or truncated file data', async () => {
  const fileUrl = `${base}/contents/a.ts?ref=${head}`;
  const missing = server({ [fileUrl]: { status: 404 } });
  await expect(missing.snapshot.readFile(repo, 'a.ts', head)).rejects.toMatchObject({ status: 404 });
  const truncated = server({ [fileUrl]: { value: { type: 'file', encoding: 'base64', content: 'YQ==', size: 9 } } });
  await expect(truncated.snapshot.readFile(repo, 'a.ts', head)).rejects.toThrow('Incomplete');
});

it('resolves a dismissed duplicate by review ID and checks present permission once per user per decision', async () => {
  let role = 'maintain';
  const approved = { ...review, id: 11 };
  const changed = { ...review, state: 'DISMISSED' };
  const permissions = `${base}/collaborators/reviewer/permission`;
  const ghost = { ...review, id: 18, user: { login: 'reader', type: 'User' } };
  const { readGateContext, calls } = server({
    [pull]: { value: pr },
    [listed('reviews')]: { value: [review, ghost, { state: 'PENDING' }], link: '<ignored>; rel="next"' },
    [listed('reviews', 2)]: { value: [changed, approved, { ...review, id: 15, user: { login: 'app[bot]', type: 'Bot' } }] },
    [`${pull}/reviews/9`]: { value: changed }, [permissions]: () => ({ value: { permission: role === 'maintain' ? 'write' : role, role_name: role } }),
    [`${base}/collaborators/reader/permission`]: { value: { permission: 'none' } },
  });
  const first = await readGateContext(repo, 5, head);
  expect(first).toMatchObject({ prAuthor: 'author', currentHeadSha: head, reviewedHeadSha: head,
    reviews: [{ id: 9, state: 'DISMISSED', permission: 'maintain' }, { id: 11, state: 'APPROVED', permission: 'maintain' }] });
  expect(calls.filter(c => c.path === permissions)).toHaveLength(1);
  role = 'read';
  expect((await readGateContext(repo, 5, head)).reviews.every(r => r.permission === 'read')).toBe(true);
});

it('propagates a missing permission or an unrecognized review rather than dropping a possible blocking vote', async () => {
  const legal = { [pull]: { value: pr }, [listed('reviews')]: { value: [review] } };
  const denied = server({ ...legal, [`${base}/collaborators/reviewer/permission`]: { status: 403 } });
  await expect(denied.readGateContext(repo, 5, head)).rejects.toBeInstanceOf(GitHubHttpError);
  const invalid = server({ ...legal, [listed('reviews')]: { value: [{ ...review, state: 'UNKNOWN' }] } });
  await expect(invalid.readGateContext(repo, 5, head)).rejects.toThrow('state');
});

it('writes comments and statuses on explicit destinations and propagates publication errors and the deadline signal', async () => {
  const statusPath = `${base}/statuses/${head}`, commentPath = `${base}/issues/5/comments`;
  const signal = new AbortController().signal;
  const { publication, calls } = server({ [statusPath]: { value: {} }, [commentPath]: { status: 403 } },
    { signal, runUrl: 'https://github.com/group/project/actions/runs/1' });
  await publication.createCommitStatus(repo, head, { context: 'inspector/risk-gate', description: 'Checking', state: 'pending' });
  expect(calls[0].init).toMatchObject({ method: 'POST', signal, redirect: 'error' });
  expect(JSON.parse(calls[0].init.body!)).toEqual({ context: 'inspector/risk-gate', description: 'Checking',
    state: 'pending', target_url: 'https://github.com/group/project/actions/runs/1' });
  await expect(publication.createComment(repo, 5, 'feedback')).rejects.toMatchObject({ status: 403 });
  await expect(publication.createCommitStatus(repo, 'main', { context: 'inspector/risk-gate', state: 'success', description: 'x' })).rejects.toThrow();
});

it.each([
  { ...pr, state: 'closed' }, { ...pr, base: { ...pr.base, ref: 'main' } },
  { ...pr, head: { ...pr.head, repo: { name: 'project', owner: { login: 'external' } } } },
])('rejects a closed, retargeted or fork PR during gate/publication rechecks', async changedPr => {
  const { publication, readGateContext } = server({ [pull]: { value: changedPr }, [listed('reviews')]: { value: [] } },
    { targetBranch: 'sprint2-demo' });
  await expect(publication.readCurrentHead(repo, 5)).rejects.toThrow();
  await expect(readGateContext(repo, 5, head)).rejects.toThrow();
});
