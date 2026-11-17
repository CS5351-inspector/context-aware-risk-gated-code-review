import { OpenAI } from 'openai';
import { countReviewTokens, createLiveReview, DEEPSEEK_BASE_URL, DEEPSEEK_TOKENIZER_ID, LIVE_TOKENIZER } from '../src/review/live-model';
import { createDeepSeekContentCounter } from '../src/review/deepseek-tokenizer';
import { buildModelPrompt } from '../src/review/model-review';
import type { ReviewConfig } from '../src/review/contracts';
import { loadFixture, manifest } from './support/sprint1-fixture';

const mockComplete = jest.fn();
jest.mock('../src/review/deepseek-tokenizer', () => {
  const actual = jest.requireActual('../src/review/deepseek-tokenizer');
  return { ...actual, createDeepSeekContentCounter: jest.fn(actual.createDeepSeekContentCounter) };
});
jest.mock('openai', () => ({
  ...jest.requireActual('openai'),
  OpenAI: jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockComplete } } })),
}));

const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv };
  jest.mocked(OpenAI).mockClear();
  jest.mocked(createDeepSeekContentCounter).mockClear();
  mockComplete.mockReset();
});
afterEach(() => { process.env = originalEnv; });

test('counts the model-specific text and message framing, including literal source markers', () => {
  expect(countReviewTokens('')).toBe(64);
  expect(countReviewTokens('hello')).toBe(65);
  expect(countReviewTokens('お誕生日おめでとう')).toBe(72);
  expect(countReviewTokens('<|endoftext|>')).toBe(71);
});

const baseURL = 'https://example.test/v1';

test('freezes the endpoint and model parameters across modes and records each attempt', async () => {
  const fixture = loadFixture(manifest.scenarios.find(entry => entry.id === 'clean-context')!);
  const budget = (fixture.config as ReviewConfig).budget;
  mockComplete.mockResolvedValue({
    choices: [{ finish_reason: 'stop', message: { content: '{"reviews":[]}' } }],
    model: 'response-model-id',
    usage: { prompt_tokens: 347, completion_tokens: 9 },
  });
  const review = createLiveReview('test-only', baseURL + '/');
  // 即使同进程后来修改旧入口的环境变量，两轮真实适配请求仍用同一套参数。
  Object.assign(process.env, { MODEL: 'unrelated', max_tokens: '500',
    REASONING_EFFORT: 'high', USE_GITHUB_MODELS: 'true', OPENAI_API_ENDPOINT: 'https://unrelated.test' });
  const diff = await review({ ...fixture.input, mode: 'diff-only' }, [], budget);
  const context = await review(fixture.input, fixture.expected.context.snippets, budget);
  expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL, maxRetries: 0 }));
  for (const [body, options] of mockComplete.mock.calls) {
    expect(body).toMatchObject({ model: 'gpt-5.4-mini', reasoning_effort: 'none',
      max_completion_tokens: budget.reservedOutputTokens, response_format: { type: 'json_object' } });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('max_tokens');
    expect(options).toMatchObject({ maxRetries: 0, signal: expect.any(AbortSignal) });
  }
  expect(diff.metrics.effectiveParameters).toEqual(context.metrics.effectiveParameters);
  expect(diff.metrics).toMatchObject({ calls: 1, inputTokens: 347, outputTokens: 9, tokenizerId: LIVE_TOKENIZER,
    attempts: [{ attempt: 1, responseModel: 'response-model-id', outcome: 'RESPONSE' }] });
  expect(context.metrics.attempts![0].estimatedInputTokens).toBeGreaterThan(diff.metrics.attempts![0].estimatedInputTokens);
  expect(createDeepSeekContentCounter).not.toHaveBeenCalled();
});

test('DeepSeek freezes non-thinking JSON output, its token counter and the SDK retry limit', async () => {
  const fixture = loadFixture(manifest.scenarios.find(entry => entry.id === 'clean-context')!);
  const budget = (fixture.config as ReviewConfig).budget;
  mockComplete.mockResolvedValue({
    choices: [{ finish_reason: 'stop', message: { content: '{"reviews":[]}' } }],
    model: 'deepseek-flash',
    usage: { prompt_tokens: 112, completion_tokens: 5 },
  });
  const review = createLiveReview('test-only', DEEPSEEK_BASE_URL + '/v1/');
  const diff = await review({ ...fixture.input, mode: 'diff-only' }, [], budget);
  const context = await review(fixture.input, fixture.expected.context.snippets, budget);
  expect(OpenAI).toHaveBeenCalledWith(expect.objectContaining({ baseURL: DEEPSEEK_BASE_URL + '/v1', maxRetries: 0 }));
  expect(mockComplete).toHaveBeenCalledTimes(2);
  for (const [body, options] of mockComplete.mock.calls) {
    expect(body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'disabled' },
      max_tokens: budget.reservedOutputTokens, response_format: { type: 'json_object' } });
    expect(body).not.toHaveProperty('max_completion_tokens');
    expect(body).not.toHaveProperty('reasoning_effort');
    expect(options).toMatchObject({ maxRetries: 0, signal: expect.any(AbortSignal) });
  }
  expect(diff.metrics.effectiveParameters).toEqual(context.metrics.effectiveParameters);
  expect(context.metrics).toMatchObject({ tokenizerId: DEEPSEEK_TOKENIZER_ID, inputTokens: 112, outputTokens: 5,
    attempts: [{ outcome: 'RESPONSE' }] });
  const estimated = context.metrics.attempts![0].estimatedInputTokens;
  expect(estimated).toBeGreaterThan(diff.metrics.attempts![0].estimatedInputTokens);
  expect(createDeepSeekContentCounter()('中文💡')).toBe(3);
  const blocked = await review(fixture.input, fixture.expected.context.snippets,
    { ...budget, maxInputTokens: estimated + budget.reservedOutputTokens - 1 });
  expect(blocked.metrics.calls).toBe(0);
  expect(blocked.omissions[0].reason).toBe('TOKEN_BUDGET');
});

test('an unavailable DeepSeek tokenizer fails before an SDK client is constructed', () => {
  jest.mocked(createDeepSeekContentCounter).mockImplementationOnce(() => { throw new Error('tokenizer unavailable'); });
  expect(() => createLiveReview('test-only', DEEPSEEK_BASE_URL)).toThrow('tokenizer unavailable');
  expect(OpenAI).not.toHaveBeenCalled();
});

test('the complete tokenized message can exactly fill the input allowance, but one token more cannot', async () => {
  const fixture = loadFixture(manifest.scenarios.find(entry => entry.id === 'clean-context')!);
  const input = { ...fixture.input, mode: 'diff-only' as const };
  const budget = (fixture.config as ReviewConfig).budget;
  const file = input.changedFiles[0];
  const estimated = countReviewTokens(buildModelPrompt(file.path, file.patch!, []));
  const boundary = estimated + budget.reservedOutputTokens;
  mockComplete.mockResolvedValue({
    choices: [{ finish_reason: 'stop', message: { content: '{"reviews":[]}' } }],
    usage: { prompt_tokens: estimated, completion_tokens: 4 },
  });
  const review = createLiveReview('test-only', baseURL);
  const accepted = await review(input, [], { ...budget, maxInputTokens: boundary });
  const blocked = await review(input, [], { ...budget, maxInputTokens: boundary - 1 });
  expect(mockComplete).toHaveBeenCalledTimes(1);
  expect(accepted.metrics.attempts![0].estimatedInputTokens).toBe(estimated);
  expect(blocked.metrics).toMatchObject({ calls: 0, inputTokens: 0, outputTokens: 0, attempts: [] });
  expect(blocked.omissions).toEqual([{ file: file.path, stage: 'model', reason: 'TOKEN_BUDGET', required: true }]);
});

test.each(['', 'http://example.test/v1', 'https://example.test/v1?key=no', 'https://user@example.test/v1',
  'https://example.test/v1#fragment', 'https://models.github.ai/inference', DEEPSEEK_BASE_URL + '/anthropic',
  DEEPSEEK_BASE_URL + ':8080'])('refuses an invalid or retired endpoint %s', endpoint => {
  expect(() => createLiveReview('test-only', endpoint)).toThrow();
  expect(OpenAI).not.toHaveBeenCalled();
});

test('requires a separate model credential before constructing an SDK client', () => {
  expect(() => createLiveReview(' ', baseURL)).toThrow('Missing model credential');
  expect(OpenAI).not.toHaveBeenCalled();
});
