import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { runReviewPipeline } from './pipeline.js';
import { collectSnapshot } from './review/snapshot.js';
import { collectContext } from './review/context.js';
import { createLiveReview } from './review/live-model.js';
import { calculateRisk } from './review/risk.js';
import { decideGate } from './review/gate.js';
import { createPublisher } from './review/publication.js';
import { createGitHubPorts } from './review/github.js';
import { renderSprintReport, sprintConfig } from './review/sprint2.js';
import { validateReviewConfig } from './review/config.js';
import type { Mode, ReviewResult } from './review/contracts.js';

async function main() {
  const started = Date.now();
  const env = process.env;
  const [owner, name] = (env.GITHUB_REPOSITORY || '').split('/');
  const repo = { owner, name };
  const number = Number(env.INSPECTOR_PR);
  const head = env.INSPECTOR_HEAD || '', base = env.INSPECTOR_BASE || '';
  const mode = env.INSPECTOR_MODE as Mode;
  const trigger = env.INSPECTOR_EVENT === 'pull_request_review' ? 'reconcile.pull_request_review'
    : env.INSPECTOR_EVENT === 'pull_request' ? 'reconcile.pull_request' : 'manual';
  const runId = `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const token = env.GITHUB_TOKEN;
  const modelEndpoint = env.INSPECTOR_MODEL_BASE_URL?.trim() ?? '';
  if (!token || !owner || !name || !Number.isSafeInteger(number) || number < 1 ||
      ![head, base, env.INSPECTOR_REVISION].every(s => /^[a-f0-9]{40}$/.test(s || '')) ||
      !['context', 'diff-only'].includes(mode)) throw new Error('Invalid trusted workflow input');
  const { budget } = sprintConfig;
  const analysis = new AbortController(), feedback = new AbortController();
  const timer = (controller: AbortController, ms: number) =>
    setTimeout(() => controller.abort(), Math.max(0, started + ms - Date.now()));
  const stopAnalysis = timer(analysis, budget.analysisTimeoutMs - budget.publishReserveMs);
  const stopAll = timer(feedback, budget.analysisTimeoutMs);
  const options = { token, targetBranch: 'sprint2-demo', expectedBaseSha: base,
    runUrl: `https://github.com/${owner}/${name}/actions/runs/${env.GITHUB_RUN_ID}` };
  const read = createGitHubPorts({ ...options, signal: analysis.signal });
  const write = createGitHubPorts({ ...options, signal: feedback.signal });
  const productionGate = mode === 'context';
  let eligible = false;
  const record: Record<string, unknown> = { runId, pr: number, base, head, mode,
    trigger, revision: env.INSPECTOR_REVISION, config: sprintConfig, startedAt: new Date(started).toISOString() };
  const cachePath = '.inspector-cache/analysis.json';
  // 服务地址变更后，历史分析不能当作新服务生成的结果继续使用。
  const modelService = createHash('sha256').update(modelEndpoint).digest('hex');
  const key = [owner, name, number, base, head, env.INSPECTOR_REVISION, mode, modelService].join('/');
  try {
    const target = await read.getTarget(repo, number);
    if (!target.open || target.baseRef !== options.targetBranch || target.headSha !== head || target.baseSha !== base ||
        target.sourceRepo.owner.toLowerCase() !== owner.toLowerCase() || target.sourceRepo.name.toLowerCase() !== name.toLowerCase()) {
      record.outcome = 'STALE_OR_INELIGIBLE'; return;
    }
    eligible = true;
    if (productionGate) await write.publication.createCommitStatus(repo, head, {
      context: 'inspector/risk-gate', state: 'pending', description: 'Reconciling the reviewed commit and current approvals',
    });
    validateReviewConfig(sprintConfig);
    const snapshot = await collectSnapshot({ repo, prNumber: number, runId, trigger, mode }, read.snapshot);
    if (snapshot.input.headSha !== head || snapshot.input.baseSha !== base) {
      record.outcome = 'STALE'; return;
    }
    const initialContext = await read.readGateContext(repo, number, head);
    if (initialContext.currentHeadSha !== head) { record.outcome = 'STALE'; return; }
    let result: ReviewResult;
    const cached = fs.existsSync(cachePath);
    if (!cached && env.INSPECTOR_EVENT === 'pull_request_review') {
      throw new Error('Reviewed analysis unavailable. Dispatch a full Context run for this PR.');
    }
    if (cached) {
      const stored = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (stored.key !== key || stored.result?.headSha !== head || stored.result?.mode !== mode ||
          stored.result.provider !== 'live') throw new Error('Analysis cache identity mismatch');
      result = { ...stored.result, runId };
      result.risk = calculateRisk(snapshot.input, result, sprintConfig);
    } else {
      result = await runReviewPipeline(snapshot.input, sprintConfig, initialContext, {
        provider: 'live', readFile: snapshot.readFileAtRef, context: collectContext,
        review: createLiveReview(env.INSPECTOR_MODEL_API_KEY ?? '', modelEndpoint, analysis.signal),
        reviewHandlesDeadline: true, risk: calculateRisk, gate: decideGate,
      }, started);
    }
    const currentGate = async (r: ReviewResult) => decideGate(r, r.risk,
      await write.readGateContext(repo, number, head), sprintConfig);
    result.gate = await currentGate(result);
    Object.assign(record, { analysis: result.analysisStatus, risk: result.risk, gateAtReport: result.gate,
      coverage: result.scope, omissions: result.omissions, findings: result.findings,
      evidence: result.snippets.map(({code: _code, ...location}) => location),
      metrics: result.metrics, reusedAnalysis: cached, newModelCalls: cached ? 0 : result.metrics.calls });
    const report = renderSprintReport(result, sprintConfig.maxReportCharacters, cached);
    if (productionGate) {
      const receipt = await createPublisher(write.publication, currentGate)(result, report);
      record.publication = receipt; record.outcome = receipt.status;
      if (receipt.status === 'FAILED') throw new Error(receipt.error ?? 'Publication failed');
    } else {
      record.outcome = 'COMPARISON_ONLY';
      if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, report + '\n');
    }
    if (!cached && result.gate.state !== 'STALE') {
      fs.mkdirSync('.inspector-cache', { recursive: true });
      const { gate: _oldDecision, ...analysisOnly } = result;
      fs.writeFileSync(cachePath, JSON.stringify({ key, result: analysisOnly }), { mode: 0o600 });
    }
  } catch (error) {
    record.outcome = 'FAILED';
    record.error = error instanceof Error ? error.message : 'Review failed';
    if (eligible && productionGate) {
      try {
        await write.publication.createCommitStatus(repo, head, {
          context: 'inspector/risk-gate', state: 'failure', description: 'Inspector failed; inspect the linked Actions receipt',
        });
      } catch { record.feedbackError = 'Could not publish the failure status'; }
    }
    throw error;
  } finally {
    clearTimeout(stopAnalysis); clearTimeout(stopAll);
    record.applicationDurationMs = Date.now() - started;
    fs.writeFileSync('inspector-receipt.json', JSON.stringify(record, null, 2) + '\n');
    console.log('Inspector outcome:', record.outcome, 'SHA:', head, 'application ms:', record.applicationDurationMs);
  }
}

main().catch(error => {
  console.error('Inspector:', error instanceof Error ? error.message : 'Run failed');
  process.exitCode = 1;
});
