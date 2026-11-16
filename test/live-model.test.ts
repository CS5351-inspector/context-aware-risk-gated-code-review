import { countReviewTokens, createLiveReview } from '../src/review/live-model';
import type { ReviewConfig } from '../src/review/contracts';
import { loadFixture, manifest } from './support/sprint1-fixture';

const mockComplete = jest.fn();
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({ chat: { completions: { create: mockComplete } } })),
}));

const originalEnv = process.env;
beforeEach(() => {
  process.env = { ...originalEnv, USE_GITHUB_MODELS: 'true', MODEL: 'openai/gpt-4o-mini', temperature: '0', top_p: '1' };
  delete process.env.AZURE_API_VERSION;
  mockComplete.mockReset();
});
afterEach(() => { process.env = originalEnv; });

test('counts the model-specific text and message framing, including literal source markers', () => {
  expect(countReviewTokens('')).toBe(7);
  expect(countReviewTokens('hello')).toBe(8);
  expect(countReviewTokens('お誕生日おめでとう')).toBe(15);
  expect(countReviewTokens('<|endoftext|>')).toBe(14);
});

test('a supported model uses bounded SDK options and preserves provider usage', async () => {
  const fixture = loadFixture(manifest.scenarios.find(entry => entry.id === 'clean-context')!);
  mockComplete.mockResolvedValue({
    choices: [{ finish_reason: 'stop', message: { content: '{"reviews":[]}' } }],
    usage: { prompt_tokens: 347, completion_tokens: 9 },
  });
  const review = createLiveReview('test-only');
  const result = await review(fixture.input, [], (fixture.config as ReviewConfig).budget);
  expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({
    model: 'openai/gpt-4o-mini', temperature: 0, top_p: 1,
    messages: [{ role: 'user', content: expect.any(String) }],
  }), expect.objectContaining({ maxRetries: 0, signal: expect.any(AbortSignal) }));
  expect(result.metrics).toMatchObject({ calls: 1, inputTokens: 347, outputTokens: 9 });
});

test('an unsupported model or missing credential fails before a request', () => {
  expect(() => createLiveReview(' ')).toThrow('Missing model credential');
  process.env.MODEL = 'unknown';
  expect(() => createLiveReview('test-only')).toThrow('No configured tokenizer');
  expect(mockComplete).not.toHaveBeenCalled();
});
