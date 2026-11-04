/** A-owned orchestration. Providers are explicit: mocks can never silently fill a live stage. */
import type {
  ReviewInput, ContextResult, ModelAnalysis, AnalysisResult, ReviewResult,
  ReviewConfig, GateContext, CollectContext, ReviewFiles, CalculateRisk,
  DecideGate, ReadFileAtRef, AnalysisStatus,
} from './review/contracts.js';
import { validateReviewConfig } from './review/config.js';

export interface PipelineProviders {
  provider: 'mock' | 'live';
  readFile: ReadFileAtRef;
  context: CollectContext;
  review: ReviewFiles;
  risk: CalculateRisk;
  gate: DecideGate;
}

export function deriveAnalysisStatus(
  input: ReviewInput, context: ContextResult, model: ModelAnalysis,
): AnalysisStatus {
  const supported = input.changedFiles.filter(f => f.supported).map(f => f.path);
  if (!supported.length) return 'NOT_APPLICABLE';
  const analyzed = new Set(model.analyzedFiles.filter(f => supported.includes(f)));
  if (!analyzed.size) return 'FAILED';
  if (analyzed.size !== supported.length
    || [...context.omissions, ...model.omissions].some(o => o.required)) return 'PARTIAL';
  return 'COMPLETE';
}

const emptyModel = (): ModelAnalysis => ({ findings: [], omissions: [], analyzedFiles: [], metrics: {
  model: 'not-called', effectiveParameters: {}, promptVersion: 'not-called',
  durationMs: 0, calls: 0, inputTokens: null, outputTokens: null,
} });

class StageTimeoutError extends Error {}

async function withinDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new StageTimeoutError('Analysis deadline exceeded')), timeoutMs);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function runReviewPipeline(
  input: ReviewInput, config: ReviewConfig, gateContext: GateContext, providers: PipelineProviders,
): Promise<ReviewResult> {
  if (!providers || !['mock', 'live'].includes(providers.provider)
    || ['context', 'review', 'risk', 'gate', 'readFile'].some(key =>
      typeof providers[key as keyof PipelineProviders] !== 'function')) {
    throw new Error('Every pipeline provider must be supplied explicitly');
  }
  validateReviewConfig(config);
  if (!gateContext.configValid) throw new Error('Configuration is not valid');
  if (gateContext.prAuthor.toLowerCase() !== input.author.toLowerCase()) {
    throw new Error('Gate author must match the immutable PR snapshot');
  }
  const startedAt = Date.now();
  const { analysisTimeoutMs, publishReserveMs } = config.budget;
  let context: ContextResult = { snippets: [], omissions: [] };
  const hasScope = input.changedFiles.some(f => f.supported);
  if (hasScope && input.mode === 'context') {
    try {
      context = await withinDeadline(
        providers.context(input, providers.readFile, config.budget), analysisTimeoutMs - publishReserveMs,
      );
    } catch (error) {
      // B distinguishes optional retrieval misses itself. An unhandled stage failure is required.
      context = { snippets: [], omissions: [{ file: null, stage: 'context',
        reason: error instanceof StageTimeoutError ? 'TIMEOUT' : 'FILE_READ_FAILED',
        required: true }] };
    }
  }
  let model = emptyModel();
  const remainingMs = Math.max(0, analysisTimeoutMs - (Date.now() - startedAt));
  if (hasScope && remainingMs > publishReserveMs) {
    try {
      // C subtracts the same publication reserve once, from this remaining whole-run budget.
      model = await withinDeadline(
        providers.review(input, context.snippets, { ...config.budget, analysisTimeoutMs: remainingMs }),
        remainingMs - publishReserveMs,
      );
    } catch (error) {
      model.omissions.push({ file: null, stage: 'model',
        reason: error instanceof StageTimeoutError ? 'TIMEOUT' : 'SERVICE_ERROR', required: true });
    }
  } else if (hasScope) {
    model.omissions.push({ file: null, stage: 'model', reason: 'TIMEOUT', required: true });
  }
  const supportedFiles = input.changedFiles.filter(f => f.supported).map(f => f.path);
  const analysis: AnalysisResult = {
    analysisStatus: deriveAnalysisStatus(input, context, model),
    scope: { supportedFiles,
      analyzedFiles: [...new Set(model.analyzedFiles.filter(f => supportedFiles.includes(f)))],
      excludedFiles: input.changedFiles.filter(f => !f.supported).map(f => f.path) },
    snippets: context.snippets, findings: model.findings,
    omissions: [...context.omissions, ...model.omissions],
    metrics: { ...model.metrics, durationMs: Date.now() - startedAt },
  };
  const risk = providers.risk(input, analysis, config);
  const gate = gateContext.reviewedHeadSha !== input.headSha || gateContext.currentHeadSha !== input.headSha
    ? { state: 'STALE' as const, reasons: ['Snapshot no longer matches the reviewed/current head'],
      requiredApprovals: config.requiredApprovals, validApprovers: [] }
    : providers.gate(analysis, risk, gateContext, config);
  return { ...analysis, schemaVersion: '1', runId: input.runId, repo: input.repo,
    prNumber: input.prNumber, headSha: input.headSha, mode: input.mode,
    provider: providers.provider, risk, gate };
}
