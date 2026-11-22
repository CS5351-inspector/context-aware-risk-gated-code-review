/** A owns publication freshness. D supplies the decision; E supplies the report.
 * Ports must create an immutable per-run comment and a status on the supplied SHA.
 * GitHub has no atomic compare-head-and-write operation: rechecks detect races,
 * while immutable comments and SHA-pinned statuses keep old runs off the new head.
 */
import type { GateResult, PublicationReceipt, PublishResult, Repo, ReviewResult } from './contracts.js';

export interface PublicationPort {
  readCurrentHead(repo: Repo, prNumber: number): Promise<string>;
  createComment(repo: Repo, prNumber: number, body: string): Promise<{ id: number }>;
  createCommitStatus(repo: Repo, sha: string, status: {
    context: 'inspector/risk-gate';
    state: 'success' | 'pending' | 'failure';
    description: string;
  }): Promise<void>;
}

export function createPublisher(
  port: PublicationPort, refreshGate?: (result: ReviewResult) => Promise<GateResult>,
): PublishResult {
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
    if (refreshGate) receipt.finalGate = { ...result.gate,
      reasons: [...result.gate.reasons], validApprovers: [...result.gate.validApprovers] };
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
      const confirmPass = async (): Promise<PublicationReceipt | undefined> => {
        if (!refreshGate) return;
        operation = 'refresh current reviews and permissions';
        const current = await refreshGate(result);
        receipt.finalGate = { ...current, reasons: [...current.reasons], validApprovers: [...current.validApprovers] };
        if (current.state === 'STALE') return { ...receipt, status: 'STALE' };
        if (current.state === 'PASS') return;
        const state = current.state === 'ERROR' ? 'failure' : 'pending';
        operation = 'restrict commit after gate changed';
        await port.createCommitStatus(repo, headSha, {
          context: 'inspector/risk-gate', state, description: 'Inspector gate changed during publication',
        });
        receipt.commitStatus = state;
        operation = 'report changed gate';
        await port.createComment(repo, prNumber,
          `Inspector run \`${runId}\`: gate updated to **${current.state}** for \`${headSha}\`. ${current.reasons.join(', ')}.`);
        return { ...receipt, status: 'PUBLISHED' };
      };
      if (gateState === 'PASS') {
        const changed = await confirmPass();
        if (changed) return changed;
        operation = 'create commit status';
        await port.createCommitStatus(repo, headSha, {
          context: 'inspector/risk-gate', state: 'success', description: 'Inspector pass for reviewed commit',
        });
        receipt.commitStatus = 'success';
        const changedAfterWrite = await confirmPass();
        if (changedAfterWrite) return changedAfterWrite;
        if (!await fresh()) return { ...receipt, status: 'STALE' };
      }
      return { ...receipt, status: 'PUBLISHED' };
    } catch {
      // Keep accepted partial-write receipts; avoid echoing API errors or source text.
      receipt.error = `Failed to ${operation}`;
      if (refreshGate && receipt.commitStatus === 'success') {
        try {
          await port.createCommitStatus(repo, headSha, {
            context: 'inspector/risk-gate', state: 'failure', description: 'Inspector could not confirm the published gate',
          });
          receipt.commitStatus = 'failure';
        } catch { receipt.error += '; could not retract success'; }
      }
      return receipt;
    }
  };
}
