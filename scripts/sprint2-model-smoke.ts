import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runReviewPipeline } from '../src/pipeline.js';
import { collectContext } from '../src/review/context.js';
import type { AnalysisStatus, Budget, Mode, OmissionReason, ReviewInput } from '../src/review/contracts.js';
import { decideGate } from '../src/review/gate.js';
import { CHAT_FRAMING_ALLOWANCE, createLiveReview, LIVE_MODEL_SETTINGS, LIVE_TOKENIZER } from '../src/review/live-model.js';
import { PROMPT_VERSION } from '../src/review/model-review.js';
import { calculateRisk } from '../src/review/risk.js';
import { sprintConfig } from '../src/review/sprint2.js';

const fixtureId = 'discount-double-conversion-v1';

// 人工构造的可公开样例。调用方与依赖的契约可以从两个文件中核对。
const sourceBefore = [
  'import { toFraction } from "./units.js";',
  '',
  'export function discountRate(percent: number) {',
  '  return toFraction(percent);',
  '}',
];
const sourceAfter = [...sourceBefore];
sourceAfter[3] = '  return toFraction(percent / 100);';
const units = 'export function toFraction(percent: number) {\n  return percent / 100;\n}\n';

function makeSnapshot(mode: Mode, fileCount: number): { input: ReviewInput; headFiles: Map<string, string> } {
  const paths = Array.from({ length: fileCount }, (_, index) => 'src/discount-' + (index + 1) + '.ts');
  const filesAt = (lines: string[]) =>
    new Map([...paths.map(path => [path, lines.join('\n') + '\n'] as const), ['src/units.ts', units] as const]);
  const digest = (files: Map<string, string>) =>
    createHash('sha1').update(JSON.stringify([...files])).digest('hex');
  const headFiles = filesAt(sourceAfter);
  const baseSha = digest(filesAt(sourceBefore)), headSha = digest(headFiles);
  const patch = [
    '@@ -1,5 +1,5 @@', ...sourceBefore.slice(0, 3).map(line => ' ' + line),
    '-' + sourceBefore[3], '+' + sourceAfter[3], ' ' + sourceBefore[4],
  ].join('\n') + '\n';
  const repo = { owner: 'local-smoke', name: fixtureId };
  const input: ReviewInput = {
    schemaVersion: '1', runId: fixtureId + '-' + mode, repo, sourceRepo: repo,
    prNumber: 1, author: 'synthetic', trigger: 'manual', baseSha, diffBaseSha: baseSha, headSha, mode,
    diff: paths.map(path => '--- a/' + path + '\n+++ b/' + path + '\n' + patch).join(''),
    changedFiles: paths.map(path => ({ path, status: 'modified', patch, supported: true, additions: 1, deletions: 1 })),
  };
  return { input, headFiles };
}

interface Scenario {
  id: string;
  mode: Mode;
  fileCount?: number;
  limits?: Partial<Budget>;
  fault?: 'rate-limit-once' | 'rate-limit' | 'connection-once' | 'timeout' | 'invalid-output';
  expected?: { status: AnalysisStatus; calls: number; omission?: OmissionReason };
}

const fixtureCases: Scenario[] = [
  { id: 'diff-only-ok', mode: 'diff-only', expected: { status: 'COMPLETE', calls: 1 } },
  { id: 'context-ok', mode: 'context', expected: { status: 'COMPLETE', calls: 1 } },
  { id: 'retry-recovers', mode: 'context', fault: 'rate-limit-once', expected: { status: 'COMPLETE', calls: 2 } },
  { id: 'connection-recovers', mode: 'diff-only', fault: 'connection-once', expected: { status: 'COMPLETE', calls: 2 } },
  { id: 'invalid-output', mode: 'diff-only', fault: 'invalid-output',
    expected: { status: 'FAILED', calls: 1, omission: 'INVALID_OUTPUT' } },
  { id: 'timeout', mode: 'diff-only', fault: 'timeout', limits: { requestTimeoutMs: 50, maxRetries: 0 },
    expected: { status: 'FAILED', calls: 1, omission: 'TIMEOUT' } },
  { id: 'call-limit', mode: 'diff-only', fault: 'rate-limit', limits: { maxCalls: 1 },
    expected: { status: 'FAILED', calls: 1, omission: 'CALL_BUDGET' } },
  { id: 'token-limit', mode: 'context', limits: { maxInputTokens: 801 },
    expected: { status: 'FAILED', calls: 0, omission: 'TOKEN_BUDGET' } },
  { id: 'file-limit', mode: 'diff-only', fileCount: 6,
    expected: { status: 'PARTIAL', calls: 5, omission: 'FILE_BUDGET' } },
];

function jsonResponse(value: object, status: number): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

// 替换 HTTP 传输时仍执行真正的 SDK，请求数可核对 SDK 有没有额外重试。
function fakeResponse(fault: Scenario['fault'], attempt: number, signal?: AbortSignal | null): Promise<Response> | Response {
  if (fault === 'connection-once' && attempt === 1) throw new TypeError('Controlled connection failure');
  if (fault === 'timeout') {
    assert(signal, 'request must supply a cancellation signal');
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }
  if (fault === 'rate-limit' || (fault === 'rate-limit-once' && attempt === 1)) {
    return jsonResponse({ error: { message: 'Controlled rate limit' } }, 429);
  }
  const content = fault === 'invalid-output' ? 'invalid JSON' : '{"reviews":[]}';
  return jsonResponse({
    model: 'simulated-model',
    choices: [{ finish_reason: 'stop', message: { content } }],
    usage: { prompt_tokens: 240, completion_tokens: 8 },
  }, 200);
}

async function runScenario(scenario: Scenario, live?: { apiKey: string; baseURL: string }) {
  const { input, headFiles } = makeSnapshot(scenario.mode, scenario.fileCount ?? 1);
  const config = { ...sprintConfig, budget: { ...sprintConfig.budget, ...scenario.limits } };
  const fetch = globalThis.fetch;
  const httpStatuses: Array<number | null> = [];
  globalThis.fetch = async (request, init) => {
    const index = httpStatuses.push(null) - 1;
    const response = live ? await fetch(request, init) : await fakeResponse(scenario.fault, index + 1, init?.signal);
    httpStatuses[index] = response.status;
    return response;
  };
  try {
    const result = await runReviewPipeline(input, config, {
      prAuthor: input.author, currentHeadSha: input.headSha, reviewedHeadSha: input.headSha,
      configValid: true, reviews: [],
    }, {
      provider: 'live', context: collectContext, risk: calculateRisk, gate: decideGate,
      readFile: async (file, ref) => {
        if (ref !== input.headSha) throw new Error('Synthetic reader only serves the frozen head');
        const content = headFiles.get(file);
        // 与真实 GitHub 404 等价的缺失信号，让 B 能按规则将 .js import 回退到 .ts。
        if (content === undefined) throw Object.assign(new Error('Synthetic file is missing'), { code: 'ENOENT' });
        return content;
      },
      review: createLiveReview(live?.apiKey ?? 'offline-fixture', live?.baseURL ?? 'https://api.openai.com/v1'),
      reviewHandlesDeadline: true,
    });
    const { metrics, omissions } = result;
    if (scenario.mode === 'context') {
      assert(result.snippets.some(s => s.file === 'src/units.ts' && s.reason === 'direct-definition'),
        'This Context fixture must retrieve the direct definition from its frozen head');
    }
    assert.equal(metrics.calls, httpStatuses.length, 'C attempts must match SDK transport calls');
    assert.equal(metrics.calls, metrics.attempts?.length, 'Each call must have a recorded attempt');
    if (scenario.expected) {
      assert.equal(result.analysisStatus, scenario.expected.status, scenario.id);
      assert.equal(metrics.calls, scenario.expected.calls, scenario.id);
      if (scenario.expected.omission) assert(omissions.some(o => o.reason === scenario.expected?.omission), scenario.id);
    }
    return { scenario: scenario.id, mode: input.mode, baseSha: input.baseSha, headSha: input.headSha, budget: config.budget,
      analysisStatus: result.analysisStatus, coverage: result.scope, omissions, metrics, httpStatuses,
      evidence: result.snippets.map(({ code: _code, ...location }) => location), findings: result.findings };
  } finally {
    globalThis.fetch = fetch;
  }
}

async function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && ['--live', '--config'].includes(args[0])),
    'Usage: npm run smoke:model-budget -- [--live|--config]');
  if (args[0] === '--config') {
    console.log(JSON.stringify({ fixture: fixtureId, ruleVersion: sprintConfig.ruleVersion, promptVersion: PROMPT_VERSION,
      tokenizer: LIVE_TOKENIZER, chatFramingAllowance: CHAT_FRAMING_ALLOWANCE, request: LIVE_MODEL_SETTINGS,
      responseFormat: 'json_object', outputLimitField: 'max_completion_tokens', sdkMaxRetries: 0,
      budget: sprintConfig.budget }, null, 2));
    return;
  }
  const live = args[0] === '--live';
  const apiKey = process.env.OPENAI_API_KEY?.trim(), baseURL = process.env.OPENAI_BASE_URL?.trim();
  if (live && (!apiKey || !baseURL)) throw new Error('Set OPENAI_API_KEY and OPENAI_BASE_URL for the live smoke run.');
  const scenarios: Scenario[] = live
    ? [{ id: 'live-diff-only', mode: 'diff-only' }, { id: 'live-context', mode: 'context' }]
    : fixtureCases;
  const startedAt = new Date().toISOString();
  const runs: Array<Awaited<ReturnType<typeof runScenario>>> = [];
  for (const scenario of scenarios) runs.push(await runScenario(scenario, live ? { apiKey: apiKey!, baseURL: baseURL! } : undefined));
  console.log(JSON.stringify({ fixture: fixtureId, startedAt, node: process.version,
    transport: live ? 'openai-compatible-api' : 'simulated-sdk-fetch', runs }, null, 2));
  if (live && runs.some(run => run.analysisStatus !== 'COMPLETE')) process.exitCode = 1;
}

main().catch(error => {
  console.error('Model smoke failed:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
