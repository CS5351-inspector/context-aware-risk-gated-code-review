import type { ChangedFile, Mode, ReadFileAtRef, Repo, ReviewInput, Trigger } from './contracts.js';

export interface SnapshotRequest {
  repo: Repo;
  prNumber: number;
  runId: string;
  trigger: Trigger;
  mode: Mode;
}

/** The adapter validates GitHub's response and supplies all paginated files. */
export interface PullRequestSnapshotMetadata {
  repo: Repo;
  sourceRepo: Repo;
  prNumber: number;
  author: string;
  baseSha: string;
  headSha: string;
  changedFiles: number;
}

export interface SnapshotFile {
  path: string;
  status: string;
  previousPath?: string;
  additions: number;
  deletions: number;
  patch: string | null;
}

export interface SnapshotGitHubPort {
  getPullRequest(repo: Repo, prNumber: number): Promise<PullRequestSnapshotMetadata>;
  listChangedFiles(repo: Repo, prNumber: number): Promise<SnapshotFile[]>;
  getMergeBase(request: { repo: Repo; sourceRepo: Repo; baseSha: string; headSha: string }): Promise<string | null>;
  readFile(repo: Repo, file: string, ref: string): Promise<string>;
}

export interface ReviewSnapshot {
  /** Recursively frozen at runtime, while retaining the shared module contract. */
  input: ReviewInput;
  /** RIGHT/head reads use sourceRepo; LEFT/diff-base reads use the target repo. */
  readFileAtRef: ReadFileAtRef;
}

type SnapshotErrorCode = 'INVALID_INPUT' | 'PR_CHANGED' | 'INCOMPLETE_FILE_LIST' | 'MISSING_MERGE_BASE';

export class SnapshotError extends Error {
  constructor(public readonly code: SnapshotErrorCode, message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

function requireValid(condition: boolean, message: string): asserts condition {
  if (!condition) throw new SnapshotError('INVALID_INPUT', message);
}

function copyRepo(repo: Repo): Repo {
  requireValid(Boolean(repo && typeof repo.owner === 'string' && repo.owner.length > 0 &&
    typeof repo.name === 'string' && repo.name.length > 0), 'Repository identity is missing');
  return Object.freeze({ owner: repo.owner, name: repo.name });
}

function validSha(sha: string): boolean {
  return typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha);
}

function validPath(file: string): boolean {
  return typeof file === 'string' && file.length > 0 && !/[\\\0\r\n]/.test(file) &&
    file.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

function copyMetadata(value: PullRequestSnapshotMetadata): PullRequestSnapshotMetadata {
  requireValid(Boolean(value), 'PR metadata is missing');
  requireValid(Number.isSafeInteger(value.prNumber) && value.prNumber > 0, 'Invalid PR number');
  requireValid(typeof value.author === 'string' && value.author.length > 0, 'PR author is missing');
  requireValid(validSha(value.baseSha) && validSha(value.headSha), 'PR commit SHAs are missing or invalid');
  requireValid(Number.isSafeInteger(value.changedFiles) && value.changedFiles >= 0, 'Invalid changed file count');
  return Object.freeze({
    repo: copyRepo(value.repo), sourceRepo: copyRepo(value.sourceRepo), prNumber: value.prNumber,
    author: value.author, baseSha: value.baseSha, headSha: value.headSha, changedFiles: value.changedFiles,
  });
}

function sameRepo(a: Repo, b: Repo): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.name.toLowerCase() === b.name.toLowerCase();
}

function classifyFile(file: SnapshotFile): ChangedFile {
  requireValid(validPath(file.path), 'Invalid changed file path');
  requireValid(file.previousPath === undefined || validPath(file.previousPath), 'Invalid previous file path');
  requireValid(Number.isSafeInteger(file.additions) && file.additions >= 0 &&
    Number.isSafeInteger(file.deletions) && file.deletions >= 0, 'Invalid changed line counts');
  requireValid(typeof file.status === 'string' && file.status.length > 0, 'Missing change status');
  requireValid(file.patch === null || typeof file.patch === 'string', 'Invalid file patch');
  const knownStatus = ['added', 'modified', 'removed', 'renamed'].includes(file.status);
  const status: ChangedFile['status'] = knownStatus ? file.status as ChangedFile['status'] : 'other';
  const supportedStatus = status === 'added' || status === 'modified';
  const supportedExtension = /\.(ts|js)$/i.test(file.path);
  const supported = supportedStatus && supportedExtension;
  // Missing patches remain supported: the pipeline must report a required omission.
  return Object.freeze({
    path: file.path, status, ...(file.previousPath === undefined ? {} : { previousPath: file.previousPath }),
    additions: file.additions, deletions: file.deletions, patch: file.patch || null, supported,
    ...(!supported ? { exclusionReason: !supportedStatus ? `UNSUPPORTED_CHANGE_STATUS:${file.status}` : 'UNSUPPORTED_EXTENSION' } : {}),
  });
}

function diffPath(prefix: string, file: string): string {
  const value = `${prefix}/${file}`;
  return /[^A-Za-z0-9_./-]/.test(value) ? JSON.stringify(value) : value;
}

function assembleDiff(files: ChangedFile[]): string {
  return files.filter((file) => file.patch !== null).map((file) => {
    const before = diffPath('a', file.previousPath ?? file.path);
    const after = diffPath('b', file.path);
    return `diff --git ${before} ${after}\n--- ${file.status === 'added' ? '/dev/null' : before}\n+++ ${file.status === 'removed' ? '/dev/null' : after}\n${file.patch}\n`;
  }).join('');
}

/**
 * Collect one version-bound input. PR-file APIs are not atomic, so reject any
 * observed change between the before/after reads. Publication needs its own
 * current-head guard; this function does not claim the PR stays unchanged later.
 */
export async function collectSnapshot(request: SnapshotRequest, github: SnapshotGitHubPort): Promise<ReviewSnapshot> {
  const repo = copyRepo(request.repo);
  const { prNumber, runId, trigger, mode } = request;
  requireValid(Number.isSafeInteger(prNumber) && prNumber > 0, 'Invalid PR number');
  requireValid(typeof runId === 'string' && runId.length > 0, 'Run ID is missing');
  requireValid(mode === 'diff-only' || mode === 'context', 'Invalid review mode');
  const before = copyMetadata(await github.getPullRequest(repo, prNumber));
  requireValid(sameRepo(repo, before.repo) && prNumber === before.prNumber, 'PR metadata does not match the requested PR');
  const changedFiles = (await github.listChangedFiles(repo, prNumber)).map(classifyFile);
  if (changedFiles.length !== before.changedFiles || new Set(changedFiles.map((file) => file.path)).size !== changedFiles.length) {
    throw new SnapshotError('INCOMPLETE_FILE_LIST', 'PR files are incomplete or contain duplicate paths');
  }
  const diffBaseSha = await github.getMergeBase({ repo, sourceRepo: before.sourceRepo, baseSha: before.baseSha, headSha: before.headSha });
  if (!diffBaseSha || !validSha(diffBaseSha)) {
    throw new SnapshotError('MISSING_MERGE_BASE', 'A merge-base commit is required; baseSha is not a safe substitute');
  }
  const after = copyMetadata(await github.getPullRequest(repo, prNumber));
  if (!sameRepo(before.repo, after.repo) || !sameRepo(before.sourceRepo, after.sourceRepo) ||
      before.prNumber !== after.prNumber || before.author !== after.author || before.baseSha !== after.baseSha ||
      before.headSha !== after.headSha || before.changedFiles !== after.changedFiles) {
    throw new SnapshotError('PR_CHANGED', 'PR identity, base or head changed during input collection; collect a new snapshot');
  }
  const input: ReviewInput = {
    schemaVersion: '1', runId, repo, sourceRepo: before.sourceRepo, prNumber, author: before.author,
    trigger, baseSha: before.baseSha, diffBaseSha, headSha: before.headSha, mode,
    diff: assembleDiff(changedFiles), changedFiles,
  };
  Object.freeze(input.changedFiles);
  Object.freeze(input);
  const readFile = github.readFile.bind(github);
  const readFileAtRef: ReadFileAtRef = async (file, ref) => {
    requireValid(validPath(file), 'Invalid file path');
    requireValid(ref === input.headSha || ref === input.diffBaseSha, 'File reads must use the captured headSha or diffBaseSha');
    return readFile(ref === input.headSha ? input.sourceRepo : input.repo, file, ref);
  };
  return Object.freeze({ input, readFileAtRef });
}
