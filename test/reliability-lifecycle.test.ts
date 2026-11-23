/** Six-scenario A/B/C/D/publication acceptance. External HTTP/model responses are scripted.
 * No real network, permissions or human observations are claimed by this suite. */
import { APIConnectionTimeoutError } from 'openai';
import { collectSnapshot } from '../src/review/snapshot';
import { createGitHubPorts, type GitHubPortsOptions } from '../src/review/github';
import { collectContext } from '../src/review/context';
import { reviewFiles, type ModelClient } from '../src/review/model-review';
import { calculateRisk } from '../src/review/risk';
import { decideGate } from '../src/review/gate';
import { runReviewPipeline } from '../src/pipeline';
import { createPublisher } from '../src/review/publication';
import { renderSprintReport, sprintConfig } from '../src/review/sprint2';
import type { ReviewConfig, ReviewResult, ApprovalReview } from '../src/review/contracts';

const HEAD = 'a'.repeat(40), NEXT = 'b'.repeat(40), BASE = 'c'.repeat(40), MERGE = 'd'.repeat(40);
const repo = { owner: 'team', name: 'fixture' };
const root = '/repos/team/fixture', prPath = root + '/pulls/1';
const patch = '@@ -1 +1 @@\n-export const n = 1;\n+export const n = 2;';
type WireReview = { id: number; user: { login: string; type: 'User' | 'Bot' };
  commit_id: string; state: ApprovalReview['state']; submitted_at: string };
const approval = (sha = HEAD, state: WireReview['state'] = 'APPROVED', id = 1): WireReview => ({
  id, user: { login: 'reviewer', type: 'User' }, commit_id: sha, state, submitted_at: '2026-11-21T00:00:00Z',
});

function setup() {
  const state = {
    head: HEAD, reviews: [] as WireReview[], high: false,
    files: [{ filename: 'src/math.js', status: 'modified', additions: 1, deletions: 1, patch: patch as string | null }],
    permission: 'write', modelFault: '' as '' | 'timeout' | 'invalid',
    failComment: false, failStatus: false,
    afterComment: undefined as (() => void) | undefined,
    afterSuccess: undefined as (() => void) | undefined,
  };
  const statuses: { sha: string; state: string }[] = [];
  const comments: string[] = [];
  const requests: string[] = [];
  const fetch: NonNullable<GitHubPortsOptions['fetch']> = async (url, init) => {
    const path = url.slice('https://api.github.com'.length);
    requests.push(path);
    let value: unknown;
    let status = 200;
    if (path === prPath) value = { number: 1, state: 'open', changed_files: state.files.length,
      user: { login: 'author' },
      head: { repo: { name: repo.name, owner: { login: repo.owner } }, sha: state.head, ref: 'fixture' },
      base: { repo: { name: repo.name, owner: { login: repo.owner } }, sha: BASE, ref: 'sprint2-demo' } };
    else if (path.startsWith(root + '/compare/' + BASE + '...')) value = { merge_base_commit: { sha: MERGE } };
    else if (path.startsWith(root + '/compare/' + MERGE + '...')) value = {
      base_commit: { sha: MERGE }, merge_base_commit: { sha: MERGE }, files: state.files };
    else if (path === prPath + '/reviews?per_page=100&page=1') value = state.reviews;
    else if (path === root + '/collaborators/reviewer/permission') value = { permission: state.permission };
    else if (path.startsWith(root + '/contents/')) {
      const source = 'export const n = 2;\n';
      value = { type: 'file', encoding: 'base64', content: Buffer.from(source).toString('base64'), size: Buffer.byteLength(source) };
    } else if (path === root + '/issues/1/comments') {
      if (state.failComment) status = 403;
      else { comments.push(JSON.parse(init.body!).body); value = { id: comments.length }; state.afterComment?.(); }
    } else if (path.startsWith(root + '/statuses/')) {
      if (state.failStatus) status = 403;
      else {
        const posted = JSON.parse(init.body!);
        statuses.push({ sha: path.split('/').pop()!, state: posted.state });
        value = {};
        if (posted.state === 'success') state.afterSuccess?.();
      }
    } else throw new Error('Unscripted request: ' + path);
    return { ok: status === 200, status, headers: { get: () => null }, json: async () => value };
  };
  const ports = createGitHubPorts({ token: 'fixture-only', fetch, targetBranch: 'sprint2-demo', expectedBaseSha: BASE });
  const completeReview = jest.fn().mockImplementation(async () => {
    if (state.modelFault === 'timeout') throw new APIConnectionTimeoutError();
    return { choices: [{ finish_reason: 'stop', message: { content: state.modelFault === 'invalid' ? 'not json' : '{"reviews":[]}' } }],
      usage: { prompt_tokens: 20, completion_tokens: 5 } };
  });
  const client: ModelClient = { effectiveParameters: { model: 'scripted-offline' }, completeReview };
  const config = (): ReviewConfig => ({ ...structuredClone(sprintConfig),
    sensitivePaths: state.high ? ['src/**'] : [],
    budget: { ...sprintConfig.budget, maxRetries: 0, requestTimeoutMs: 50, analysisTimeoutMs: 2000, publishReserveMs: 100 },
  });
  const run = async () => {
    const c = config();
    const snapshot = await collectSnapshot({ repo, prNumber: 1, runId: 'scripted-acceptance', mode: 'context', trigger: 'manual' }, ports.snapshot);
    const result = await runReviewPipeline(snapshot.input, c, await ports.readGateContext(repo, 1, snapshot.input.headSha), {
      provider: 'live', // Publisher contract under a completely scripted transport, NOT live model evidence.
      readFile: snapshot.readFileAtRef, context: collectContext,
      review: (input, snippets, budget) => reviewFiles(client, input, snippets, budget, { countInputTokens: () => 100 }),
      risk: calculateRisk, gate: decideGate,
    });
    const refresh = (r: ReviewResult) => ports.readGateContext(repo, 1, r.headSha).then(ctx => decideGate(r, r.risk, ctx, c));
    const report = renderSprintReport(result, c.maxReportCharacters, false);
    const receipt = await createPublisher(ports.publication, refresh)(result, report);
    return { result, receipt, report };
  };
  return { state, statuses, comments, requests, run, completeReview, config };
}

test.each(['LOW', 'MEDIUM'])('R1 %s complete analysis publishes a SHA-bound success', async level => {
  const s = setup();
  if (level === 'MEDIUM') s.state.files = Array.from({ length: 4 }, (_, n) => ({ ...s.state.files[0], filename: 'src/f' + n + '.js' }));
  const { result, receipt, report } = await s.run();
  expect(result.analysisStatus).toBe('COMPLETE');
  expect(result.risk.level).toBe(level);
  expect(receipt).toMatchObject({ status: 'PUBLISHED', commitStatus: 'success', finalGate: { state: 'PASS' } });
  expect(report).toContain(HEAD);
  expect(result.snippets.every(item => item.ref === HEAD)).toBe(true);
  expect(s.statuses.every(item => item.sha === HEAD)).toBe(true);
  expect(s.requests.some(path => path.includes('/pulls/1/files'))).toBe(false);
});

test('R2-R4 approval, new head, fresh approval and dismissal use the actual adapter and pure D', async () => {
  const s = setup(); s.state.high = true;
  expect((await s.run()).receipt.commitStatus).toBe('pending');
  s.state.reviews = [approval()];
  const approved = await s.run();
  expect(approved.result.risk.level).toBe('HIGH');
  expect(approved.receipt.commitStatus).toBe('success');
  s.state.head = NEXT;
  expect((await s.run()).receipt.commitStatus).toBe('pending');
  s.state.reviews.push(approval(NEXT, 'APPROVED', 2));
  expect((await s.run()).receipt.commitStatus).toBe('success');
  s.state.reviews[1].state = 'DISMISSED';
  expect((await s.run()).receipt.commitStatus).toBe('pending');
});

test('R4 a qualified changes request blocks a clean LOW result', async () => {
  const s = setup(); s.state.reviews = [approval(HEAD, 'CHANGES_REQUESTED')];
  const r = await s.run();
  expect(r.result.risk.level).toBe('LOW');
  expect(r.receipt).toMatchObject({ commitStatus: 'pending', finalGate: { state: 'WAITING' } });
});

test.each(['read', 'triage', 'none'])('R2 %s permission cannot release HIGH', async permission => {
  const s = setup(); s.state.high = true; s.state.permission = permission; s.state.reviews = [approval()];
  expect((await s.run()).receipt.commitStatus).toBe('pending');
});

test.each(['timeout', 'invalid', 'missing'])('R5 %s cannot become an automatic clean success', async fault => {
  const s = setup();
  if (fault === 'missing') s.state.files[0].patch = null;
  else s.state.modelFault = fault as 'timeout' | 'invalid';
  const r = await s.run();
  expect(r.result.analysisStatus).toBe('FAILED');
  expect(r.result.risk.level).toBe('UNKNOWN');
  expect(r.receipt.commitStatus).toBe('pending');
  expect(r.result.omissions.some(item => item.required)).toBe(true);
  if (fault === 'missing') expect(s.completeReview).not.toHaveBeenCalled();
  s.state.reviews = [approval()];
  const takeover = await s.run();
  expect(takeover.receipt.commitStatus).toBe('success');
  expect(takeover.result.analysisStatus).toBe('FAILED');
  expect(takeover.report).toContain('Human takeover');
});

test('R6 head changes during report publication never create success for the new SHA', async () => {
  const s = setup(); s.state.afterComment = () => { s.state.head = NEXT; };
  const r = await s.run();
  expect(r.receipt.status).toBe('STALE');
  expect(s.statuses).toEqual([{ sha: HEAD, state: 'pending' }]);
});

test('R4/R6 same-head withdrawal during a success write is reflected in the final receipt', async () => {
  const s = setup(); s.state.high = true; s.state.reviews = [approval()];
  s.state.afterSuccess = () => { s.state.reviews[0].state = 'DISMISSED'; };
  const r = await s.run();
  expect(r.result.gate.state).toBe('PASS'); // historical report-time decision
  expect(r.receipt).toMatchObject({ status: 'PUBLISHED', commitStatus: 'pending',
    finalGate: { state: 'WAITING', reasons: ['APPROVAL_REQUIRED'] } });
  expect(s.statuses.map(item => item.state)).toEqual(['pending', 'success', 'pending']);
  expect(s.comments[s.comments.length - 1]).toContain('WAITING');
});

test.each(['comment', 'status'])('R6 rejected %s write is traceable and never claims publication', async operation => {
  const s = setup();
  if (operation === 'comment') s.state.failComment = true;
  else s.state.failStatus = true;
  const r = await s.run();
  expect(r.receipt.status).toBe('FAILED');
  expect(r.receipt.error).toContain(operation === 'comment' ? 'report' : 'status');
  expect(s.statuses.some(item => item.state === 'success')).toBe(false);
});
