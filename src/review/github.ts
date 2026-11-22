import { TextDecoder } from 'node:util';
import type { ApprovalReview, GateContext, Permission, Repo } from './contracts.js';
import type { PublicationPort } from './publication.js';
import type { PullRequestSnapshotMetadata, SnapshotGitHubPort, SnapshotFile } from './snapshot.js';

export class GitHubHttpError extends Error {
  constructor(public readonly status: number) {
    super(`GitHub API returned HTTP ${status}`);
    this.name = 'GitHubHttpError';
  }
}

/** Narrow native Node fetch contract so the Action needs no browser DOM types. */
type GitHubFetch = (url: string, init: {
  method: 'GET' | 'POST'; redirect: 'error'; signal?: AbortSignal; headers: Record<string, string>; body?: string;
}) => Promise<{
  ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>;
}>;

export interface GitHubPortsOptions {
  token: string;
  signal?: AbortSignal;
  fetch?: GitHubFetch;
  runUrl?: string;
  targetBranch?: string;
  expectedBaseSha?: string;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid GitHub object');
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Missing GitHub string');
  return value;
}

function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw new Error('Invalid GitHub number');
  return value;
}

function sha(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{40}$/i.test(value)) throw new Error('Invalid commit SHA');
  return value.toLowerCase();
}

function repoFields(value: unknown): Repo {
  const fields = object(value);
  return { owner: string(object(fields.owner).login), name: string(fields.name) };
}

function segment(value: string): string {
  if (!value || value === '.' || value === '..' || /[\\/\0\r\n]/.test(value)) throw new Error('Invalid GitHub path segment');
  return encodeURIComponent(value);
}

function base(repo: Repo): string {
  return `/repos/${segment(repo.owner)}/${segment(repo.name)}`;
}

function pull(repo: Repo, number: number): string {
  return `${base(repo)}/pulls/${integer(number, 1)}`;
}

function reviewFields(value: Record<string, unknown>): Omit<ApprovalReview, 'permission'> {
  const user = object(value.user);
  const state = value.state;
  if (state !== 'APPROVED' && state !== 'DISMISSED' && state !== 'CHANGES_REQUESTED' && state !== 'COMMENTED') {
    throw new Error('Unexpected submitted review state');
  }
  if (user.type !== 'User' && user.type !== 'Bot') throw new Error('Unknown GitHub reviewer type');
  return {
    id: integer(value.id, 1), login: string(user.login), actorType: user.type,
    commitSha: sha(value.commit_id), state, submittedAt: string(value.submitted_at),
  };
}

type ReviewFields = ReturnType<typeof reviewFields>;

function sameReview(a: ReviewFields, b: ReviewFields) {
  return a.login.toLowerCase() === b.login.toLowerCase() && a.actorType === b.actorType &&
    a.commitSha === b.commitSha && a.state === b.state && a.submittedAt === b.submittedAt;
}

export function createGitHubPorts(options: GitHubPortsOptions) {
  if (!options.token) throw new Error('GitHub token is missing');
  const send = options.fetch ?? (globalThis as typeof globalThis & { fetch: GitHubFetch }).fetch;
  async function request(path: string, body?: object) {
    const response = await send(`https://api.github.com${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: options.signal,
      headers: {
        Accept: 'application/vnd.github+json', Authorization: `Bearer ${options.token}`,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'CS5351-Inspector',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new GitHubHttpError(response.status);
    return response;
  }
  async function json(path: string, body?: object) {
    return object(await (await request(path, body)).json());
  }
  async function pages(path: string) {
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; ; page++) {
      const response = await request(`${path}?per_page=100&page=${page}`);
      const batch: unknown = await response.json();
      if (!Array.isArray(batch)) throw new Error('Expected a GitHub list');
      for (const item of batch) rows.push(object(item));
      // Build the next request locally so credentials never follow a URL from a response.
      if (!/;\s*rel="next"/i.test(response.headers.get('link') ?? '')) return rows;
      if (!batch.length) throw new Error('Empty GitHub page with a next page');
    }
  }

  async function metadata(repo: Repo, number: number) {
    const pr = await json(pull(repo, number));
    const head = object(pr.head), target = object(pr.base);
    const snapshot: PullRequestSnapshotMetadata = {
      repo: repoFields(target.repo), sourceRepo: repoFields(head.repo), prNumber: integer(pr.number, 1),
      author: string(object(pr.user).login), baseSha: sha(target.sha), headSha: sha(head.sha),
      changedFiles: integer(pr.changed_files),
    };
    if (snapshot.prNumber !== number || snapshot.repo.owner.toLowerCase() !== repo.owner.toLowerCase() ||
        snapshot.repo.name.toLowerCase() !== repo.name.toLowerCase()) throw new Error('GitHub returned a different PR');
    if (pr.state !== 'open' && pr.state !== 'closed') throw new Error('Invalid GitHub PR state');
    return { snapshot, baseRef: string(target.ref), headRef: string(head.ref), open: pr.state === 'open' };
  }
  async function getTarget(repo: Repo, number: number) {
    const { snapshot, baseRef, headRef, open } = await metadata(repo, number);
    const { baseSha, headSha, sourceRepo } = snapshot;
    return { baseRef, headRef, headSha, baseSha, sourceRepo, open };
  }

  function requireEligible(repo: Repo, details: Awaited<ReturnType<typeof metadata>>) {
    if (!details.open) throw new Error('PR closed before gate evaluation or publication');
    if (options.expectedBaseSha && details.snapshot.baseSha !== options.expectedBaseSha) throw new Error('PR base changed');
    const { sourceRepo } = details.snapshot;
    if (options.targetBranch && (details.baseRef !== options.targetBranch ||
        sourceRepo.owner.toLowerCase() !== repo.owner.toLowerCase() || sourceRepo.name.toLowerCase() !== repo.name.toLowerCase())) {
      throw new Error('PR no longer targets the configured same-repository demonstration branch');
    }
  }

  const fileFields = (file: Record<string, unknown>): SnapshotFile => ({
    path: string(file.filename), status: string(file.status),
    ...(file.previous_filename === undefined ? {} : { previousPath: string(file.previous_filename) }),
    additions: integer(file.additions), deletions: integer(file.deletions),
    patch: file.patch == null || file.patch === '' ? null : string(file.patch),
  });

  const snapshot: SnapshotGitHubPort = {
    getPullRequest: async (repo, number) => (await metadata(repo, number)).snapshot,
    async listChangedFiles(repo, number) {
      const files = await pages(`${pull(repo, number)}/files`);
      return files.map(fileFields);
    },
    async listChangedFilesAtRef(repo, diffBaseSha, headSha) {
      const frozenBase = sha(diffBaseSha), frozenHead = sha(headSha);
      const comparison = await json(`${base(repo)}/compare/${frozenBase}...${frozenHead}?per_page=1`);
      if (sha(object(comparison.base_commit).sha) !== frozenBase
        || sha(object(comparison.merge_base_commit).sha) !== frozenBase) {
        throw new Error('Comparison does not start at the captured merge base');
      }
      // Compare API exposes at most 300 files. At the cap truncation is ambiguous.
      if (!Array.isArray(comparison.files) || comparison.files.length >= 300) {
        throw new Error('Immutable comparison file list unavailable or potentially truncated');
      }
      return comparison.files.map(item => fileFields(object(item)));
    },
    async getMergeBase({ repo, baseSha, headSha }) {
      const comparison = await json(`${base(repo)}/compare/${sha(baseSha)}...${sha(headSha)}?per_page=1`);
      return sha(object(comparison.merge_base_commit).sha);
    },
    async readFile(repo, file, ref) {
      const result = await json(`${base(repo)}/contents/${file.split('/').map(segment).join('/')}?ref=${sha(ref)}`);
      // Refuse oversized/object-only responses, directories and unverified partial contents.
      if (result.type !== 'file' || result.encoding !== 'base64' || typeof result.content !== 'string') {
        throw new Error('File contents unavailable from GitHub');
      }
      const bytes = Buffer.from(result.content, 'base64');
      if (bytes.length !== integer(result.size)) throw new Error('Incomplete GitHub file contents');
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    },
  };

  async function readGateContext(repo: Repo, number: number, reviewedHeadSha: string): Promise<GateContext> {
    const reviewPath = `${pull(repo, number)}/reviews`;
    const history = new Map<number, ReviewFields>();
    const conflicts = new Set<number>();
    for (const item of await pages(reviewPath)) {
      if (item.state === 'PENDING') continue; // An unsubmitted draft has no voting effect.
      const review = reviewFields(item), previous = history.get(review.id);
      if (previous && !sameReview(previous, review)) conflicts.add(review.id);
      history.set(review.id, review);
    }
    // A review can be dismissed while pagination is in progress. Resolve duplicate snapshots by ID.
    for (const id of conflicts) {
      const current = reviewFields(await json(`${reviewPath}/${id}`));
      if (current.id !== id) throw new Error('GitHub returned a different review');
      history.set(id, current);
    }
    const permissions = new Map<string, Permission | 'none'>();
    const reviews: ApprovalReview[] = [];
    for (const review of history.values()) {
      if (review.actorType === 'Bot' || review.login.toLowerCase().endsWith('[bot]')) continue;
      const key = review.login.toLowerCase();
      if (!permissions.has(key)) {
        const result = await json(`${base(repo)}/collaborators/${segment(review.login)}/permission`);
        const permission = result.permission; // GitHub maps maintain/triage to their write/read base levels.
        if (permission !== 'none' && permission !== 'read' && permission !== 'write' && permission !== 'admin' &&
            permission !== 'triage' && permission !== 'maintain') throw new Error('Unknown GitHub permission');
        const role = result.role_name;
        permissions.set(key, role === 'maintain' && permission === 'write' ? 'maintain'
          : role === 'triage' && permission === 'read' ? 'triage' : permission);
      }
      const permission = permissions.get(key)!;
      if (permission !== 'none') reviews.push({ ...review, permission });
    }
    const details = await metadata(repo, number);
    requireEligible(repo, details);
    const pr = details.snapshot;
    return { prAuthor: pr.author, reviewedHeadSha: sha(reviewedHeadSha), currentHeadSha: pr.headSha, reviews, configValid: true };
  }

  const publication: PublicationPort = {
    async readCurrentHead(repo, number) {
      const details = await metadata(repo, number);
      requireEligible(repo, details);
      return details.snapshot.headSha;
    },
    async createComment(repo, number, body) {
      const reply = await json(`${base(repo)}/issues/${integer(number, 1)}/comments`, { body });
      return { id: integer(reply.id, 1) };
    },
    async createCommitStatus(repo, ref, status) {
      await json(`${base(repo)}/statuses/${sha(ref)}`, {
        ...status, ...(options.runUrl ? { target_url: options.runUrl } : {}),
      });
    },
  };
  return { snapshot, publication, readGateContext, getTarget };
}
