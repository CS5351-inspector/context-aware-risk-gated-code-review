import { Chat } from '../src/chat';

jest.mock('openai', () => {
  const mockCreate = jest.fn();
  return {
    OpenAI: jest.fn().mockImplementation(() => ({
      chat: { completions: { create: mockCreate } },
    })),
    mockCreate,
  };
});

const { mockCreate } = require('openai');
const patch = '@@ -1 +1 @@\n-old\n+new';
const finding = {
  lgtm: false,
  review_comment: 'Check the null case.',
  hunk_header: '@@ -1 +1 @@',
};

const completion = (content: string | null, finishReason = 'stop') => ({
  choices: [{ finish_reason: finishReason, message: { content } }],
});

describe('model review response validation', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  test('accepts an explicit empty findings array', async () => {
    mockCreate.mockResolvedValue(completion('{"reviews":[]}'));

    await expect(new Chat('test-key').codeReview(patch)).resolves.toEqual([]);
  });

  test('accepts valid per-hunk findings and explicit LGTM', async () => {
    const reviews = [finding, { lgtm: true, review_comment: '' }];
    mockCreate.mockResolvedValue(completion(JSON.stringify({ reviews })));

    await expect(new Chat('test-key').codeReview(patch)).resolves.toEqual(reviews);
  });

  test('preserves the supported single-review format', async () => {
    mockCreate.mockResolvedValue(completion(JSON.stringify(finding)));

    await expect(new Chat('test-key').codeReview(patch)).resolves.toEqual(finding);
  });

  test.each([
    ['no choices', { choices: [] }],
    ['missing finish reason', { choices: [{ message: { content: '{"reviews":[]}' } }] }],
    ['null content', completion(null)],
    ['empty content', completion('')],
    ['whitespace content', completion('   \n')],
    ['invalid JSON', completion('Looks good to me!')],
    ['truncated JSON', completion('{"reviews":[')],
    ['JSON null', completion('null')],
    ['JSON string', completion('"LGTM"')],
    ['JSON boolean', completion('true')],
    ['bare array', completion('[]')],
    ['missing fields', completion('{}')],
    ['reviews is not an array', completion('{"reviews":{}}')],
    ['null review item', completion('{"reviews":[null]}')],
    ['string LGTM', completion('{"lgtm":"false","review_comment":"Bug"}')],
    ['missing LGTM', completion('{"review_comment":"Bug"}')],
    ['missing comment', completion('{"lgtm":true}')],
    ['non-string comment', completion('{"lgtm":false,"review_comment":42}')],
    ['finding without explanation', completion(JSON.stringify({ lgtm: false, review_comment: ' \n' }))],
    ['contradictory LGTM', completion('{"lgtm":true,"review_comment":"There is a bug"}')],
    ['non-string hunk header', completion('{"lgtm":false,"review_comment":"Bug","hunk_header":12}')],
    ['mixed valid and invalid items', completion(JSON.stringify({ reviews: [finding, { lgtm: 'true', review_comment: '' }] }))],
    ['token limit despite valid JSON', completion('{"reviews":[]}', 'length')],
    ['content filter despite valid JSON', completion('{"reviews":[]}', 'content_filter')],
    ['tool call instead of review', completion('{"reviews":[]}', 'tool_calls')],
    ['refusal despite valid JSON', { choices: [{ finish_reason: 'stop', message: { content: '{"reviews":[]}', refusal: 'Cannot review' } }] }],
  ])('rejects %s instead of returning an LGTM', async (_label, response) => {
    mockCreate.mockResolvedValue(response);

    await expect(new Chat('test-key').codeReview(patch)).rejects.toMatchObject({
      name: 'InvalidReviewResponseError',
    });
  });

  test('does not expose raw model content in validation errors', async () => {
    mockCreate.mockResolvedValue(completion('private source code echoed by model'));

    await expect(new Chat('test-key').codeReview(patch)).rejects.toThrow(
      'Invalid model review response: expected valid JSON.'
    );
  });

  test('preserves model API failures for the caller', async () => {
    const error = new Error('Rate limited');
    mockCreate.mockRejectedValue(error);

    await expect(new Chat('test-key').codeReview(patch)).rejects.toBe(error);
  });
});
