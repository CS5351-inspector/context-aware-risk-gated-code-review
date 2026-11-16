import { createPublisher } from '../src/review/publication';
import type { PublicationPort } from '../src/review/publication';
import type { ReviewResult } from '../src/review/contracts';

const HEAD = 'a'.repeat(40);
const NEW_HEAD = 'b'.repeat(40);
// Publication consumes identity/provider/gate fields; analysis belongs to other modules.
const result = (state: ReviewResult['gate']['state'] = 'PASS'): ReviewResult => ({
  repo: { owner: 'team', name: 'repo' }, prNumber: 7, headSha: HEAD, runId: 'run-1', provider: 'live',
  gate: { state, reasons: [], requiredApprovals: 1, validApprovers: [] },
} as unknown as ReviewResult);
const port = (): jest.Mocked<PublicationPort> => ({
  readCurrentHead: jest.fn().mockResolvedValue(HEAD),
  createComment: jest.fn().mockResolvedValue({ id: 42 }),
  createCommitStatus: jest.fn().mockResolvedValue(undefined),
});

const states = (p: jest.Mocked<PublicationPort>) => p.createCommitStatus.mock.calls.map(call => call[2].state);

describe('shared publication guard', () => {
  test.each([['PASS', 'success'], ['WAITING', 'pending'], ['ERROR', 'failure']] as const)(
    'publishes %s as %s only on the reviewed commit', async (gate, state) => {
      const p = port();
      expect(await createPublisher(p)(result(gate), 'Review report')).toEqual({
        status: 'PUBLISHED', commentId: 42, commitStatus: state, error: null,
      });
      expect(p.createCommitStatus).toHaveBeenCalledWith({ owner: 'team', name: 'repo' }, HEAD,
        expect.objectContaining({ state, context: 'inspector/risk-gate' }));
      expect(states(p)).toEqual(gate === 'PASS' ? ['pending', 'success'] : [state]);
      expect(p.createCommitStatus.mock.invocationCallOrder[0]).toBeLessThan(p.createComment.mock.invocationCallOrder[0]);
      expect(p.createComment.mock.calls[0][2]).toContain(HEAD);
      expect(p.readCurrentHead).toHaveBeenCalledTimes(gate === 'PASS' ? 4 : 3);
    }
  );
  test('rejects mock output before any GitHub access', async () => {
    const p = port(); const r = { ...result(), provider: 'mock' as const };
    expect((await createPublisher(p)(r, 'Mock report')).status).toBe('FAILED');
    expect(p.readCurrentHead).not.toHaveBeenCalled();
    expect(p.createComment).not.toHaveBeenCalled();
    expect(p.createCommitStatus).not.toHaveBeenCalled();
  });
  test.each(['main', 'a'.repeat(39), 'g'.repeat(40), ''])('rejects a mutable or invalid commit ref %s', headSha => {
    const p = port();
    return createPublisher(p)({ ...result(), headSha }, 'Report').then(receipt => {
      expect(receipt.status).toBe('FAILED');
      expect(p.readCurrentHead).not.toHaveBeenCalled();
      expect(p.createCommitStatus).not.toHaveBeenCalled();
    });
  });
  test('stale input never writes', async () => {
    const p = port(); p.readCurrentHead.mockResolvedValue(NEW_HEAD);
    expect(await createPublisher(p)(result(), 'Report')).toMatchObject({ status: 'STALE', commentId: null, commitStatus: null });
    expect(p.createComment).not.toHaveBeenCalled(); expect(p.createCommitStatus).not.toHaveBeenCalled();
  });
  test('a head change during initial status write stops with a pending old-head receipt', async () => {
    const p = port(); p.readCurrentHead.mockResolvedValueOnce(HEAD).mockResolvedValue(NEW_HEAD);
    expect(await createPublisher(p)(result(), 'Report')).toMatchObject({ status: 'STALE', commentId: null, commitStatus: 'pending' });
    expect(states(p)).toEqual(['pending']); expect(p.createComment).not.toHaveBeenCalled();
  });
  test('a head change during comment creation prevents a final PASS', async () => {
    const p = port(); p.readCurrentHead.mockResolvedValueOnce(HEAD).mockResolvedValueOnce(HEAD).mockResolvedValue(NEW_HEAD);
    expect(await createPublisher(p)(result(), 'Report')).toMatchObject({ status: 'STALE', commentId: 42, commitStatus: 'pending' });
    expect(states(p)).toEqual(['pending']);
  });
  test('a head change during final status creation is stale; success remains pinned to old SHA', async () => {
    const p = port();
    p.readCurrentHead.mockResolvedValueOnce(HEAD).mockResolvedValueOnce(HEAD).mockResolvedValueOnce(HEAD).mockResolvedValue(NEW_HEAD);
    expect(await createPublisher(p)(result(), 'Report')).toMatchObject({ status: 'STALE', commentId: 42, commitStatus: 'success' });
    expect(p.createCommitStatus.mock.calls.every(call => call[1] === HEAD)).toBe(true);
  });
  test.each([0, 1, 2, 3])('head lookup failure at stage %s never claims publication success', async index => {
    const p = port();
    for (let i = 0; i < index; i++) p.readCurrentHead.mockResolvedValueOnce(HEAD);
    p.readCurrentHead.mockRejectedValueOnce(new Error('private token must not be echoed'));
    const receipt = await createPublisher(p)(result(), 'Report');
    expect(receipt.status).toBe('FAILED'); expect(receipt.error).toBe('Failed to read current PR head');
    expect(receipt.commentId).toBe(index >= 2 ? 42 : null);
    expect(receipt.commitStatus).toBe(index === 0 ? null : index === 3 ? 'success' : 'pending');
  });
  test.each([['PASS', 'pending'], ['WAITING', 'pending'], ['ERROR', 'failure']] as const)(
    'a failed comment for %s replaces an earlier PASS with %s', async (gate, expected) => {
      const p = port(); let latestStatus: string = 'success';
      p.createCommitStatus.mockImplementation(async (_repo, _sha, status) => { latestStatus = status.state; });
      p.createComment.mockRejectedValue(new Error('write failure'));
      expect(await createPublisher(p)(result(gate), 'Report')).toEqual({
        status: 'FAILED', commentId: null, commitStatus: expected, error: 'Failed to create review report',
      });
      expect(latestStatus).toBe(expected);
      expect(states(p)).toEqual([expected]);
    }
  );
  test('initial status failure creates no report and records no confirmed status', async () => {
    const p = port(); p.createCommitStatus.mockRejectedValue(new Error('write failure'));
    expect(await createPublisher(p)(result(), 'Report')).toEqual({
      status: 'FAILED', commentId: null, commitStatus: null, error: 'Failed to create commit status',
    });
    expect(p.createComment).not.toHaveBeenCalled();
  });
  test('final status failure keeps pending and the accepted report receipt', async () => {
    const p = port(); p.createCommitStatus.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('write failure'));
    expect(await createPublisher(p)(result(), 'Report')).toEqual({
      status: 'FAILED', commentId: 42, commitStatus: 'pending', error: 'Failed to create commit status',
    });
  });
  test.each(['WAITING', 'ERROR'] as const)('a %s decision can publish without an optional report', async gate => {
    const p = port();
    expect((await createPublisher(p)(result(gate), '')).status).toBe('PUBLISHED');
    expect(p.createComment).not.toHaveBeenCalled();
    expect(states(p)).toEqual([gate === 'ERROR' ? 'failure' : 'pending']);
  });
  test('a PASS without a report clears earlier success but remains failed/pending', async () => {
    const p = port();
    expect(await createPublisher(p)(result(), '')).toMatchObject({ status: 'FAILED', commentId: null, commitStatus: 'pending' });
    expect(states(p)).toEqual(['pending']);
  });
  test('a caller mutation while awaiting cannot redirect a write to the new head', async () => {
    const p = port(); const r = result();
    p.createComment.mockImplementationOnce(async () => { r.headSha = NEW_HEAD; r.repo.name = 'other'; return { id: 42 }; });
    await createPublisher(p)(r, 'Report');
    expect(p.createCommitStatus.mock.calls.every(call => call[1] === HEAD && call[0].name === 'repo')).toBe(true);
  });
  test('an already stale gate result is never published', async () => {
    const p = port();
    expect((await createPublisher(p)(result('STALE'), 'Report')).status).toBe('STALE');
    expect(p.readCurrentHead).not.toHaveBeenCalled();
  });
});

describe('same-commit approval changes during live publication', () => {
  const waiting = { ...result('WAITING').gate, reasons: ['APPROVAL_REQUIRED'] };

  test('revocation during report creation prevents success on the unchanged HEAD', async () => {
    const p = port();
    let approved = true;
    p.createComment.mockImplementationOnce(async () => {
      approved = false;
      return { id: 42 };
    });
    const publish = createPublisher(p, async () => approved ? result().gate : waiting);
    const receipt = await publish(result(), 'Initially approved');
    expect(receipt).toMatchObject({ status: 'PUBLISHED', commitStatus: 'pending' });
    expect(states(p)).not.toContain('success');
    expect(p.createComment).toHaveBeenLastCalledWith(result().repo, 7, expect.stringContaining('APPROVAL_REQUIRED'));
  });

  test('revocation during the success write restores pending on the same SHA', async () => {
    const p = port();
    let approved = true;
    p.createCommitStatus.mockImplementation(async (_repo, _sha, status) => {
      if (status.state === 'success') approved = false;
    });
    const publish = createPublisher(p, async () => approved ? result().gate : waiting);
    const receipt = await publish(result(), 'Initially approved');
    expect(receipt).toMatchObject({ status: 'PUBLISHED', commitStatus: 'pending' });
    expect(states(p)).toEqual(['pending', 'success', 'pending']);
    expect(p.createCommitStatus.mock.calls.every(([, sha]) => sha === HEAD)).toBe(true);
    expect(p.createComment).toHaveBeenLastCalledWith(result().repo, 7, expect.stringContaining('WAITING'));
  });

  test('a failed permission recheck after success retracts the published status', async () => {
    const p = port();
    const refresh = jest.fn().mockResolvedValueOnce(result().gate).mockRejectedValueOnce(new Error('API failure'));
    const receipt = await createPublisher(p, refresh)(result(), 'Initially approved');
    expect(receipt).toMatchObject({ status: 'FAILED', commitStatus: 'failure', commentId: 42 });
    expect(receipt.error).toContain('refresh');
    expect(states(p)).toEqual(['pending', 'success', 'failure']);
    expect(p.createCommitStatus).toHaveBeenLastCalledWith(result().repo, HEAD,
      expect.objectContaining({ context: 'inspector/risk-gate', state: 'failure' }));
  });

  test('if GitHub also rejects retraction the receipt preserves the outstanding success', async () => {
    const p = port();
    const refresh = jest.fn().mockResolvedValueOnce(result().gate).mockRejectedValueOnce(new Error('API failure'));
    p.createCommitStatus.mockImplementation(async (_repo, _sha, status) => {
      if (status.state === 'failure') throw new Error('Unable to write');
    });
    const receipt = await createPublisher(p, refresh)(result(), 'Initially approved');
    expect(receipt).toMatchObject({ status: 'FAILED', commitStatus: 'success', commentId: 42 });
    expect(receipt.error).toContain('could not retract');
  });
});
