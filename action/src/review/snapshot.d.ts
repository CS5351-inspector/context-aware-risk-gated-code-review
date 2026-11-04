import type { Mode, ReadFileAtRef, Repo, ReviewInput, Trigger } from './contracts.js';
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
    getMergeBase(request: {
        repo: Repo;
        sourceRepo: Repo;
        baseSha: string;
        headSha: string;
    }): Promise<string | null>;
    readFile(repo: Repo, file: string, ref: string): Promise<string>;
}
export interface ReviewSnapshot {
    /** Recursively frozen at runtime, while retaining the shared module contract. */
    input: ReviewInput;
    /** RIGHT/head reads use sourceRepo; LEFT/diff-base reads use the target repo. */
    readFileAtRef: ReadFileAtRef;
}
type SnapshotErrorCode = 'INVALID_INPUT' | 'PR_CHANGED' | 'INCOMPLETE_FILE_LIST' | 'MISSING_MERGE_BASE';
export declare class SnapshotError extends Error {
    readonly code: SnapshotErrorCode;
    constructor(code: SnapshotErrorCode, message: string);
}
/**
 * Collect one version-bound input. PR-file APIs are not atomic, so reject any
 * observed change between the before/after reads. Publication needs its own
 * current-head guard; this function does not claim the PR stays unchanged later.
 */
export declare function collectSnapshot(request: SnapshotRequest, github: SnapshotGitHubPort): Promise<ReviewSnapshot>;
export {};
