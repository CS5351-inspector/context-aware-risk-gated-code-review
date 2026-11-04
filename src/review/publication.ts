/** A owns publication freshness. D supplies the decision; E supplies the report.
 * Ports must create an immutable per-run comment and a status on the supplied SHA.
 * GitHub has no atomic compare-head-and-write operation: rechecks detect races,
 * while immutable comments and SHA-pinned statuses keep old runs off the new head.
 */
import type { PublicationReceipt, PublishResult, Repo } from './contracts.js';

export interface PublicationPort {
  readCurrentHead(repo: Repo, prNumber: number): Promise<string>;
  createComment(repo: Repo, prNumber: number, body: string): Promise<{ id: number }>;
  createCommitStatus(repo: Repo, sha: string, status: {
    context: 'inspector/risk-gate';
    state: 'success' | 'pending' | 'failure';
    description: string;
  }): Promise<void>;
}

export function createPublisher(port: PublicationPort): PublishResult {
  return async (result, report) => {
    // Capture scalar values before awaiting: callers cannot retarget a running write.
    const repo = { ...result.repo };
    const { headSha, prNumber, runId, provider } = result;
    const gateState = result.gate.state;
    const receipt: PublicationReceipt = {
      status: 'FAILED', commentId: null, commitStatus: null, error: null,
    };
    if (provider !== 'live') {
      receipt.error = 'Mock results cannot publish a production risk gate';
      return receipt;
    }
    if (!headSha || !Number.isSafeInteger(prNumber) || prNumber < 1 || !report.trim()
      || !repo.owner || !repo.name || !runId) {
      receipt.error = 'Invalid publication input';
      return receipt;
    }
    if (gateState === 'STALE') return { ...receipt, status: 'STALE' };
    if (!['PASS', 'WAITING', 'ERROR'].includes(gateState)) {
      receipt.error = 'Invalid gate state';
      return receipt;
    }
    const state = gateState === 'PASS' ? 'success' : gateState === 'WAITING' ? 'pending' : 'failure';
    const body = `${report}\n\n---\nInspector run: \`${runId}\` · reviewed commit: \`${headSha}\`.\nThis report applies only to that commit.\n`;
    let operation = 'read current PR head';
    try {
      const fresh = async () => {
        operation = 'read current PR head';
        return await port.readCurrentHead(repo, prNumber) === headSha;
      };
      if (!await fresh()) return { ...receipt, status: 'STALE' };
      operation = 'create review report';
      const comment = await port.createComment(repo, prNumber, body);
      if (!Number.isSafeInteger(comment.id) || comment.id < 1) throw new Error('Invalid comment receipt');
      receipt.commentId = comment.id;
      // This is both the post-comment check and the pre-status check.
      if (!await fresh()) return { ...receipt, status: 'STALE' };
      operation = 'create commit status';
      await port.createCommitStatus(repo, headSha, {
        context: 'inspector/risk-gate', state,
        description: `Inspector ${gateState.toLowerCase()} for reviewed commit`,
      });
      receipt.commitStatus = state;
      if (!await fresh()) return { ...receipt, status: 'STALE' };
      return { ...receipt, status: 'PUBLISHED' };
    } catch {
      // Keep accepted partial-write receipts; avoid echoing API errors or source text.
      receipt.error = `Failed to ${operation}`;
      return receipt;
    }
  };
}
