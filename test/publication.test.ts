import { createPublisher } from '../src/review/publication';
import type { PublicationPort } from '../src/review/publication';
import type { ReviewResult } from '../src/review/contracts';

// Publication consumes only identity/provider/gate fields; analysis belongs to other modules.
const result = (state: ReviewResult['gate']['state'] = 'PASS'): ReviewResult => ({
  repo: { owner: 'team', name: 'repo' }, prNumber: 7, headSha: 'reviewed-head', runId: 'run-1', provider: 'live',
  gate: { state, reasons: [], requiredApprovals: 1, validApprovers: [] },
} as unknown as ReviewResult);
const port = (): jest.Mocked<PublicationPort> => ({
  readCurrentHead: jest.fn().mockResolvedValue('reviewed-head'),
  createComment: jest.fn().mockResolvedValue({ id: 42 }),
  createCommitStatus: jest.fn().mockResolvedValue(undefined),
});

describe('shared publication guard', () => {
  test.each([['PASS', 'success'], ['WAITING', 'pending'], ['ERROR', 'failure']] as const)(
    'publishes %s as %s only on the reviewed commit', async (gate, state) => {
      const p = port();
      expect(await createPublisher(p)(result(gate), 'Review report')).toEqual({
        status: 'PUBLISHED', commentId: 42, commitStatus: state, error: null,
      });
      expect(p.createCommitStatus).toHaveBeenCalledWith({ owner: 'team', name: 'repo' }, 'reviewed-head',
        expect.objectContaining({ state, context: 'inspector/risk-gate' }));
      expect(p.createComment.mock.calls[0][2]).toContain('reviewed commit: `reviewed-head`');
      expect(p.readCurrentHead).toHaveBeenCalledTimes(3);
    }
  );
  test('rejects mock output before any GitHub access', async () => {
    const p = port(); const r = { ...result(), provider: 'mock' as const };
    expect((await createPublisher(p)(r, 'Mock report')).status).toBe('FAILED');
    expect(p.readCurrentHead).not.toHaveBeenCalled();
    expect(p.createComment).not.toHaveBeenCalled();
    expect(p.createCommitStatus).not.toHaveBeenCalled();
  });
  test('stale input never writes', async () => {
    const p = port(); p.readCurrentHead.mockResolvedValue('new-head');
    expect(await createPublisher(p)(result(), 'Report')).toMatchObject({ status: 'STALE', commentId: null, commitStatus: null });
    expect(p.createComment).not.toHaveBeenCalled(); expect(p.createCommitStatus).not.toHaveBeenCalled();
  });
  test('a head change during comment creation prevents status publication', async () => {
    const p = port(); p.readCurrentHead.mockResolvedValueOnce('reviewed-head').mockResolvedValue('new-head');
    expect(await createPublisher(p)(result(), 'Report')).toMatchObject({ status: 'STALE', commentId: 42, commitStatus: null });
    expect(p.createCommitStatus).not.toHaveBeenCalled();
  });
  test('a head change during status creation is stale; success remains pinned to old SHA', async () => {
    const p = port();
    p.readCurrentHead.mockResolvedValueOnce('reviewed-head').mockResolvedValueOnce('reviewed-head').mockResolvedValue('new-head');
    expect(await createPublisher(p)(result(), 'Report')).toMatchObject({ status: 'STALE', commentId: 42, commitStatus: 'success' });
    expect(p.createCommitStatus.mock.calls[0][1]).toBe('reviewed-head');
  });
  test.each([0, 1, 2])('head lookup failure at stage %s never claims publication success', async index => {
    const p = port();
    for (let i = 0; i < index; i++) p.readCurrentHead.mockResolvedValueOnce('reviewed-head');
    p.readCurrentHead.mockRejectedValueOnce(new Error('private token must not be echoed'));
    const receipt = await createPublisher(p)(result(), 'Report');
    expect(receipt.status).toBe('FAILED'); expect(receipt.error).toBe('Failed to read current PR head');
    expect(receipt.commentId).toBe(index > 0 ? 42 : null);
    expect(receipt.commitStatus).toBe(index > 1 ? 'success' : null);
  });
  test('comment failure does not publish a status', async () => {
    const p = port(); p.createComment.mockRejectedValue(new Error('write failure'));
    expect(await createPublisher(p)(result(), 'Report')).toMatchObject({ status: 'FAILED', commentId: null, commitStatus: null });
    expect(p.createCommitStatus).not.toHaveBeenCalled();
  });
  test('status failure retains the accepted report receipt and is not PUBLISHED', async () => {
    const p = port(); p.createCommitStatus.mockRejectedValue(new Error('write failure'));
    expect(await createPublisher(p)(result(), 'Report')).toEqual({
      status: 'FAILED', commentId: 42, commitStatus: null, error: 'Failed to create commit status',
    });
  });
  test('a caller mutation while awaiting cannot redirect a write to the new head', async () => {
    const p = port(); const r = result();
    p.createComment.mockImplementationOnce(async () => { r.headSha = 'new-head'; r.repo.name = 'other'; return { id: 42 }; });
    await createPublisher(p)(r, 'Report');
    expect(p.createCommitStatus).toHaveBeenCalledWith({ owner: 'team', name: 'repo' }, 'reviewed-head', expect.anything());
  });
  test('an already stale gate result is never published', async () => {
    const p = port();
    expect((await createPublisher(p)(result('STALE'), 'Report')).status).toBe('STALE');
    expect(p.readCurrentHead).not.toHaveBeenCalled();
  });
});
