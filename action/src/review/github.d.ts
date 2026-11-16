/// <reference types="node" />
import type { GateContext, Repo } from './contracts.js';
import type { PublicationPort } from './publication.js';
import type { SnapshotGitHubPort } from './snapshot.js';
export declare class GitHubHttpError extends Error {
    readonly status: number;
    constructor(status: number);
}
/** Narrow native Node fetch contract so the Action needs no browser DOM types. */
type GitHubFetch = (url: string, init: {
    method: 'GET' | 'POST';
    redirect: 'error';
    signal?: AbortSignal;
    headers: Record<string, string>;
    body?: string;
}) => Promise<{
    ok: boolean;
    status: number;
    headers: {
        get(name: string): string | null;
    };
    json(): Promise<unknown>;
}>;
export interface GitHubPortsOptions {
    token: string;
    signal?: AbortSignal;
    fetch?: GitHubFetch;
    runUrl?: string;
    targetBranch?: string;
    expectedBaseSha?: string;
}
export declare function createGitHubPorts(options: GitHubPortsOptions): {
    snapshot: SnapshotGitHubPort;
    publication: PublicationPort;
    readGateContext: (repo: Repo, number: number, reviewedHeadSha: string) => Promise<GateContext>;
    getTarget: (repo: Repo, number: number) => Promise<{
        baseRef: string;
        headRef: string;
        headSha: string;
        baseSha: string;
        sourceRepo: Repo;
        open: boolean;
    }>;
};
export {};
