/** C 的离线边界测试：模拟服务行为，不调用真实模型，不用自造答案证明准确率。 */
import { Chat } from '../src/chat';
import { convertFindings, patchLines } from '../src/review/findings';
import { buildModelPrompt, deriveModelStatus, reviewFiles } from '../src/review/model-review';
import type { ModelClient } from '../src/review/model-review';
import type { ContextSnippet, ModelBudget, ModelInput } from '../src/review/model-types';

jest.mock('openai', () => {
  const mockCreate = jest.fn();
  return { OpenAI: jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockCreate } } })), mockCreate };
});
const { mockCreate } = require('openai');
const patch = '@@ -1,2 +1,2 @@\n const x = 1;\n-old();\n+newCall();';
const input = (): ModelInput => ({ headSha: 'head-1', diffBaseSha: 'merge-base-1', mode: 'context',
  changedFiles: [{ path: 'src/a.ts', status: 'modified', patch, supported: true }] });
const budget = (): ModelBudget => ({ maxFiles: 5, maxCalls: 4, maxRetries: 1, requestTimeoutMs: 1000,
  analysisTimeoutMs: 5000, publishReserveMs: 100, maxInputTokens: 4000, reservedOutputTokens: 200 });
const snippet = (): ContextSnippet => ({ id: 'ctx-1', file: 'src/b.ts', ref: 'head-1',
  startLine: 10, endLine: 10, code: 'export function newCall() {}', reason: 'direct-definition' });
const raw = () => ({ lgtm: false, review_comment: 'Check behavior.', file: 'src/a.ts', side: 'RIGHT',
  line: 2, severity: 'high', evidenceIds: ['ctx-1'] });
const completion = (reviews: unknown[] = []) => ({ choices: [{ finish_reason: 'stop', message: {
  content: JSON.stringify({ reviews }),
} }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
const client = (): ModelClient & { completeReview: jest.Mock } => ({ effectiveParameters: { model: 'mock', temperature: 0 },
  completeReview: jest.fn().mockResolvedValue(completion()) });
const runtime = { countInputTokens: () => 100 };

describe('Finding conversion and provenance', () => {
  test('converts a validated high finding without changing severity', () => {
    expect(convertFindings(completion([raw()]), input(), 'src/a.ts', patch, [snippet()]).findings[0])
      .toMatchObject({ side: 'RIGHT', line: 2, severity: 'high', evidenceIds: ['ctx-1'], validation: 'VERIFIED' });
  });
  test('LEFT evidence uses diffBaseSha, independent of target branch tip', () => {
    const result = convertFindings(completion([{ ...raw(), side: 'LEFT' }]), input(), 'src/a.ts', patch,
      [{ ...snippet(), ref: 'merge-base-1' }]);
    expect(result.findings[0].validation).toBe('VERIFIED');
  });
  test.each(['invented', 'ctx-old'])('removes invalid evidence %s and preserves the high finding', id => {
    const result = convertFindings(completion([{ ...raw(), evidenceIds: [id] }]), input(), 'src/a.ts', patch,
      [{ ...snippet(), id: 'ctx-old', ref: 'old-head' }]);
    expect(result.findings[0]).toMatchObject({ severity: 'high', evidenceIds: [], validation: 'UNVERIFIED' });
    expect(result.omissions[0]).toMatchObject({ reason: 'INVALID_EVIDENCE', required: true });
  });
  test('a wrong-side ref cannot become a valid citation', () => {
    const result = convertFindings(completion([{ ...raw(), side: 'LEFT' }]), input(), 'src/a.ts', patch, [snippet()]);
    expect(result.findings[0].evidenceIds).toEqual([]);
  });
  test('bad line falls back to body, without inventing a coordinate', () => {
    const result = convertFindings(completion([{ ...raw(), line: 999 }]), input(), 'src/a.ts', patch, [snippet()]);
    expect(result.findings[0]).toMatchObject({ line: null, validation: 'UNVERIFIED' });
    expect(result.omissions[0].required).toBe(true);
  });
  test('explicit null line is disclosed but valid body finding is usable', () => {
    const result = convertFindings(completion([{ ...raw(), line: null }]), input(), 'src/a.ts', patch, [snippet()]);
    expect(result.findings[0].validation).toBe('UNLOCATED');
    expect(result.omissions[0]).toMatchObject({ reason: 'UNLOCATED_FINDING', required: false });
  });
  test('legacy comments remain visible and explicitly unverified', () => {
    const result = convertFindings(completion([{ lgtm: false, review_comment: 'Legacy issue' }]), input(), 'src/a.ts', patch, []);
    expect(result.findings[0]).toMatchObject({ line: null, severity: 'medium', validation: 'UNVERIFIED' });
  });
  test.each([
    { file: 'other.ts' }, { side: 'right' }, { line: '2' }, { line: -1 }, { severity: 'critical' },
    { evidenceIds: [42] }, { evidenceIds: null }, { evidenceIds: [''] }, { side: ['RIGHT'] }, { severity: ['high'] },
  ])('rejects malformed extra fields %j', change => {
    expect(() => convertFindings(completion([{ ...raw(), ...change }]), input(), 'src/a.ts', patch, [snippet()]))
      .toThrow('invalid finding fields');
  });
  test.each([true, false])('retains a valid high finding when another entry is malformed (invalid first: %s)', invalidFirst => {
    const invalid = { ...raw(), side: 'bad' };
    const reviews = invalidFirst ? [invalid, raw()] : [raw(), invalid];
    const result = convertFindings(completion(reviews), input(), 'src/a.ts', patch, [snippet()]);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({ severity: 'high', validation: 'VERIFIED' });
    expect(result.omissions).toContainEqual({ file: 'src/a.ts', stage: 'model', reason: 'INVALID_OUTPUT', required: true });
  });
  test('diff parser tracks deletion, addition and context independently', () => {
    const lines = patchLines('@@ -10,2 +20,2 @@\n-old\n+new\n common');
    expect([...lines.LEFT]).toEqual([10, 11]); expect([...lines.RIGHT]).toEqual([20, 21]);
  });
  test.each(['@@ -1,2 +1,2 @@\n+x', '@@ -1 +1 @@\n-x\n+y\n+z', 'binary data'])('rejects incomplete diff %s', text => {
    expect(() => patchLines(text)).toThrow();
  });
});

describe('controlled modes, coverage and resource limits', () => {
  test('modes share prompt body and parameters; only context payload differs', async () => {
    const a = client(), b = client();
    await reviewFiles(a, { ...input(), mode: 'diff-only' }, [snippet()], budget(), runtime);
    await reviewFiles(b, input(), [snippet()], budget(), runtime);
    const p1 = a.completeReview.mock.calls[0][0], p2 = b.completeReview.mock.calls[0][0];
    expect(p1.slice(0, p1.lastIndexOf('\n'))).toBe(p2.slice(0, p2.lastIndexOf('\n')));
    expect(JSON.parse(p1.split('\n').pop()).context).toEqual([]);
    expect(JSON.parse(p2.split('\n').pop()).context).toEqual([snippet()]);
    expect(a.completeReview.mock.calls[0][1]).toMatchObject({ maxRetries: 0, maxOutputTokens: 200 });
  });
  test('explicit empty reviews means successful analysis, with real usage', async () => {
    const result = await reviewFiles(client(), input(), [], budget(), runtime);
    expect(deriveModelStatus(input(), result)).toBe('COMPLETE');
    expect(result.metrics).toMatchObject({ calls: 1, inputTokens: 20, outputTokens: 5 });
  });
  test.each([{ choices: [] }, { choices: [{ finish_reason: 'length', message: { content: '{"reviews":[]}' } }] },
    { choices: [{ finish_reason: 'stop', message: { content: '' } }] }])('invalid responses fail without retry %j', response => {
    const c = client(); c.completeReview.mockResolvedValue(response);
    return reviewFiles(c, input(), [], budget(), runtime).then(result => {
      expect(deriveModelStatus(input(), result)).toBe('FAILED'); expect(result.metrics.calls).toBe(1);
    });
  });
  test('one failed file produces PARTIAL and retains findings from the successful file', async () => {
    const c = client(); c.completeReview.mockResolvedValueOnce(completion([raw()])).mockRejectedValueOnce({ status: 401 });
    const i = input(); i.changedFiles.push({ ...i.changedFiles[0], path: 'src/b.ts' });
    const result = await reviewFiles(c, i, [snippet()], budget(), runtime);
    expect(deriveModelStatus(i, result)).toBe('PARTIAL'); expect(result.findings[0].severity).toBe('high');
    expect(result.metrics.inputTokens).toBeNull();
  });
  test('mixed response cannot hide a valid high finding or count as complete', async () => {
    const c = client(); c.completeReview.mockResolvedValue(completion([null, raw()]));
    const result = await reviewFiles(c, input(), [snippet()], budget(), runtime);
    expect(deriveModelStatus(input(), result)).toBe('PARTIAL');
    expect(result.findings[0].severity).toBe('high');
  });
  test('required context omission affects final status but optional trimming does not', async () => {
    const result = await reviewFiles(client(), input(), [], budget(), runtime);
    expect(deriveModelStatus(input(), result, [{ required: true }])).toBe('PARTIAL');
    expect(deriveModelStatus(input(), result, [{ required: false }])).toBe('COMPLETE');
  });
  test('missing patch is required failure and makes no model call', async () => {
    const i = input(); i.changedFiles[0].patch = null;
    const result = await reviewFiles(client(), i, [], budget(), runtime);
    expect(result.omissions[0].reason).toBe('MISSING_PATCH'); expect(result.metrics.calls).toBe(0);
  });
  test.each(['duplicate', 'ref', 'span'])('rejects invalid snippet metadata: %s', kind => {
    const snippets = kind === 'duplicate' ? [snippet(), snippet()]
      : [{ ...snippet(), ...(kind === 'ref' ? { ref: 'stale' } : { endLine: 11 }) }];
    return reviewFiles(client(), input(), snippets, budget(), runtime).then(result => {
      expect(result.metrics.calls).toBe(0); expect(result.omissions[0].reason).toBe('INVALID_EVIDENCE');
    });
  });
    // 模拟边界输入绕过编译期类型检查，观察错误是否进入覆盖记录。
  test.each([
    { name: 'non-array list', value: null },
    { name: 'null item', value: [null] },
    { name: 'numeric ID', value: [{ ...snippet(), id: 123 }] },
    { name: 'numeric file', value: [{ ...snippet(), file: 123 }] },
    { name: 'numeric reason', value: [{ ...snippet(), reason: 123 }] },
  ])('records invalid evidence for a $name before calling the model', async ({ value }) => {
    const incoming = JSON.parse(JSON.stringify(value));
    const result = await reviewFiles(client(), input(), incoming, budget(), runtime);

    expect(result.metrics.calls).toBe(0);
    expect(result.omissions).toEqual([
      { file: 'src/a.ts', stage: 'model', reason: 'INVALID_EVIDENCE', required: true },
    ]);
    expect(deriveModelStatus(input(), result)).toBe('FAILED');
  });
  
  test('token limit covers full prompt and reserves output; no request above limit', async () => {
    const countInputTokens = jest.fn().mockReturnValue(3900);
    const result = await reviewFiles(client(), input(), [], budget(), { countInputTokens });
    expect(countInputTokens.mock.calls[0][0]).toBe(buildModelPrompt('src/a.ts', patch, []));
    expect(result.omissions[0].reason).toBe('TOKEN_BUDGET'); expect(result.metrics.calls).toBe(0);
  });
  test('maxFiles and maxCalls apply to the entire PR', async () => {
    const i = input(); i.changedFiles.push({ ...i.changedFiles[0], path: 'src/b.ts' });
    const a = await reviewFiles(client(), i, [], { ...budget(), maxCalls: 1 }, runtime);
    const b = await reviewFiles(client(), i, [], { ...budget(), maxFiles: 1 }, runtime);
    expect(a.omissions[0].reason).toBe('CALL_BUDGET'); expect(b.omissions[0].reason).toBe('FILE_BUDGET');
  });
  test('unknown usage stays null rather than invented zero', async () => {
    const c = client(); c.completeReview.mockResolvedValue({ choices: completion().choices });
    const result = await reviewFiles(c, input(), [], budget(), runtime);
    expect(result.metrics.inputTokens).toBeNull(); expect(result.metrics.outputTokens).toBeNull();
  });
  test('A may pass already-spent PR time; reserve prevents any new call', async () => {
    const result = await reviewFiles(client(), input(), [], budget(), { ...runtime, remainingMs: 50 });
    expect(result.omissions[0].reason).toBe('TIMEOUT'); expect(result.metrics.calls).toBe(0);
  });
  test.each([-1, NaN, 0.5])('rejects invalid numeric config %s', maxRetries => {
    return expect(reviewFiles(client(), input(), [], { ...budget(), maxRetries }, runtime)).rejects.toThrow('Invalid model budget');
  });
});

describe('timeouts and bounded retries', () => {
  // Jest 29.0 没有异步 timer API：先排空 Promise 微任务，再推动虚拟时钟。
  const tick = async (ms: number) => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    jest.advanceTimersByTime(ms);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  test.each([429, 500, 503])('recovers once from transient HTTP %s, counts both calls', async status => {
    const c = client(); c.completeReview.mockRejectedValueOnce({ status });
    const promise = reviewFiles(c, input(), [], budget(), runtime);
    await tick(250);
    const result = await promise;
    expect(result.metrics.calls).toBe(2); expect(deriveModelStatus(input(), result)).toBe('COMPLETE');
    expect(result.metrics.inputTokens).toBeNull();
  });
  test('persistent 429 stops after maxRetries, rather than multiplying SDK retries', async () => {
    const c = client(); c.completeReview.mockRejectedValue({ status: 429 });
    const promise = reviewFiles(c, input(), [], budget(), runtime); await tick(250);
    const result = await promise; expect(result.metrics.calls).toBe(2); expect(result.omissions[0].reason).toBe('RATE_LIMIT');
  });
  test.each([401, 403, 400])('does not retry permanent HTTP %s', async status => {
    const c = client(); c.completeReview.mockRejectedValue({ status });
    const result = await reviewFiles(c, input(), [], budget(), runtime); expect(result.metrics.calls).toBe(1);
  });
  test('aborts a hung request and records TIMEOUT with unknown usage', async () => {
    const c = client(); c.completeReview.mockImplementation(() => new Promise(() => {}));
    const promise = reviewFiles(c, input(), [], { ...budget(), maxRetries: 0 }, runtime);
    const signal = c.completeReview.mock.calls[0][1].signal;
    await tick(1000);
    const result = await promise;
    expect(signal.aborted).toBe(true); expect(result.omissions[0].reason).toBe('TIMEOUT');
    expect(result.metrics.inputTokens).toBeNull(); expect(jest.getTimerCount()).toBe(0);
  });
  test('Retry-After beyond remaining budget stops instead of waiting or retrying early', async () => {
    const c = client(); c.completeReview.mockRejectedValue({ status: 429, headers: { get: () => '60' } });
    const result = await reviewFiles(c, input(), [], budget(), runtime);
    expect(result.metrics.calls).toBe(1); expect(jest.getTimerCount()).toBe(0);
  });
  test('honors Retry-After seconds within budget', async () => {
    const c = client(); c.completeReview.mockRejectedValueOnce({ status: 429, headers: { get: () => '1' } });
    const promise = reviewFiles(c, input(), [], budget(), runtime);
    await tick(999); expect(c.completeReview).toHaveBeenCalledTimes(1);
    await tick(1); expect((await promise).metrics.calls).toBe(2);
  });
});

describe('shared Chat adapter', () => {
  const original = process.env;
  beforeEach(() => { process.env = { ...original, MODEL: 'gpt-4o-mini' }; mockCreate.mockReset(); mockCreate.mockResolvedValue(completion()); });
  afterEach(() => { process.env = original; });
  test('preserves explicit temperature=0 and top_p=0', () => {
    process.env.temperature = '0'; process.env.top_p = '0';
    expect(new Chat('test').effectiveParameters).toMatchObject({ temperature: 0, top_p: 0 });
  });
  test.each(['NaN', '-1', '3', ''])('rejects invalid temperature %s', value => {
    process.env.temperature = value; expect(() => new Chat('test').effectiveParameters).toThrow('Invalid model parameter');
  });
  test.each(['0', '-1', 'NaN', '2.5'])('rejects invalid max_tokens %s', value => {
    process.env.max_tokens = value; expect(() => new Chat('test').effectiveParameters).toThrow('Invalid model parameter');
  });
  test('passes cancellation, output budget and disables SDK hidden retries', async () => {
    const signal = new AbortController().signal;
    await new Chat('test').completeReview('prompt', { signal, timeout: 500, maxRetries: 0, maxOutputTokens: 123 });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ max_tokens: 123 }), { signal, timeout: 500, maxRetries: 0 });
  });
  test.each(['o3-mini', 'openai/o3-mini', 'gpt-5.4'])('uses the completion token limit for reasoning model %s', async model => {
    process.env.MODEL = model;
    process.env.max_tokens = '250';
    const chat = new Chat('test');
    expect(chat.effectiveParameters).toMatchObject({ max_completion_tokens: 250 });
    expect(chat.effectiveParameters).not.toHaveProperty('max_tokens');
    const result = await reviewFiles(chat, input(), [], budget(), runtime);
    const request = mockCreate.mock.calls[0][0];
    expect(request.max_completion_tokens).toBe(200);
    expect(request).not.toHaveProperty('max_tokens');
    expect(result.metrics.effectiveParameters.max_completion_tokens).toBe(200);
    expect(result.metrics.effectiveParameters).not.toHaveProperty('max_tokens');
  });
});
