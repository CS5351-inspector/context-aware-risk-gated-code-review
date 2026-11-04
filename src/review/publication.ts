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
    if (!/^[a-f0-9]{40}$/i.test(headSha) || !Number.isSafeInteger(prNumber) || prNumber < 1
      || !repo.owner || !repo.name || !runId) {
      receipt.error = 'Invalid publication input';
      return receipt;
    }
    if (gateState === 'STALE') return { ...receipt, status: 'STALE' };
    if (!['PASS', 'WAITING', 'ERROR'].includes(gateState)) {
      receipt.error = 'Invalid gate state';
      return receipt;
    }
    const initialState = gateState === 'ERROR' ? 'failure' : 'pending';
    const body = `${report}\n\n---\nInspector run: \`${runId}\` · reviewed commit: \`${headSha}\`.\nThis report applies only to that commit.\n`;
    let operation = 'read current PR head';
    try {
      const fresh = async () => {
        operation = 'read current PR head';
        return await port.readCurrentHead(repo, prNumber) === headSha;
      };
      if (!await fresh()) return { ...receipt, status: 'STALE' };
      // Clear an earlier PASS before attempting a report. A failed comment must
      // never leave that earlier success active for a new restrictive decision.
      operation = 'create commit status';
      await port.createCommitStatus(repo, headSha, {
        context: 'inspector/risk-gate', state: initialState,
        description: gateState === 'PASS' ? 'Inspector publication in progress' : `Inspector ${gateState.toLowerCase()} for reviewed commit`,
      });
      receipt.commitStatus = initialState;
      if (!await fresh()) return { ...receipt, status: 'STALE' };
      if (report.trim()) {
        operation = 'create review report';
        const comment = await port.createComment(repo, prNumber, body);
        if (!Number.isSafeInteger(comment.id) || comment.id < 1) throw new Error('Invalid comment receipt');
        receipt.commentId = comment.id;
        if (!await fresh()) return { ...receipt, status: 'STALE' };
      } else if (gateState === 'PASS') {
        receipt.error = 'A passing gate requires a published report';
        return receipt;
      }
      if (gateState === 'PASS') {
        operation = 'create commit status';
        await port.createCommitStatus(repo, headSha, {
          context: 'inspector/risk-gate', state: 'success', description: 'Inspector pass for reviewed commit',
        });
        receipt.commitStatus = 'success';
        if (!await fresh()) return { ...receipt, status: 'STALE' };
      }
      return { ...receipt, status: 'PUBLISHED' };
    } catch {
      // Keep accepted partial-write receipts; avoid echoing API errors or source text.
      receipt.error = `Failed to ${operation}`;
      return receipt;
    }
  };
}
