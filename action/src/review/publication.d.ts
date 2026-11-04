/** A owns publication freshness. D supplies the decision; E supplies the report.
 * Ports must create an immutable per-run comment and a status on the supplied SHA.
 * GitHub has no atomic compare-head-and-write operation: rechecks detect races,
 * while immutable comments and SHA-pinned statuses keep old runs off the new head.
 */
import type { PublishResult, Repo } from './contracts.js';
export interface PublicationPort {
    readCurrentHead(repo: Repo, prNumber: number): Promise<string>;
    createComment(repo: Repo, prNumber: number, body: string): Promise<{
        id: number;
    }>;
    createCommitStatus(repo: Repo, sha: string, status: {
        context: 'inspector/risk-gate';
        state: 'success' | 'pending' | 'failure';
        description: string;
    }): Promise<void>;
}
export declare function createPublisher(port: PublicationPort): PublishResult;
