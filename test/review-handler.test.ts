import { robot } from '../src/bot';

jest.mock('openai', () => {
  const mockCreate = jest.fn();
  return {
    OpenAI: class {
      chat = { completions: { create: mockCreate } };
    },
    mockCreate,
  };
});

const { mockCreate } = require('openai');

describe('review response validation in the PR handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { OPENAI_API_KEY: 'test-key' };
    mockCreate.mockReset();
    jest.spyOn(console, 'time').mockImplementation(() => {});
    jest.spyOn(console, 'timeEnd').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  const setup = () => {
    const app = { on: jest.fn(), onError: jest.fn() };
    robot(app as any);
    const handler = app.on.mock.calls[0][1];
    const createReview = jest.fn().mockResolvedValue({});
    const context = {
      repo: () => ({ owner: 'owner', repo: 'repo' }),
      pullRequest: () => ({ pull_number: 123 }),
      payload: {
        action: 'opened',
        pull_request: {
          state: 'open', locked: false, head: { sha: 'reviewed-head' },
        },
      },
      octokit: {
        paginate: jest.fn().mockResolvedValue([{
          filename: 'src/file.ts', status: 'modified',
          contents_url: 'https://api.github.com/repos/owner/repo/contents/src/file.ts',
          patch: '@@ -1 +1 @@\n-old\n+new',
        }]),
        pulls: { listFiles: jest.fn(), createReview },
      },
    };
    return { handler, context, createReview };
  };

  test.each([
    ['empty response', { choices: [] }],
    ['invalid schema', { choices: [{ finish_reason: 'stop', message: { content: '{}' } }] }],
    ['truncated response', { choices: [{ finish_reason: 'length', message: { content: '{"reviews":[]}' } }] }],
  ])('never publishes an LGTM after an %s', async (_label, response) => {
    mockCreate.mockResolvedValue(response);
    const { handler, context, createReview } = setup();

    await expect(handler(context)).rejects.toMatchObject({
      name: 'InvalidReviewResponseError',
    });
    expect(createReview).not.toHaveBeenCalled();
  });

  test('still publishes a review for a valid explicit no-findings response', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ finish_reason: 'stop', message: { content: '{"reviews":[]}' } }],
    });
    const { handler, context, createReview } = setup();

    await expect(handler(context)).resolves.toBe('success');
    expect(createReview).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('LGTM'), commit_id: 'reviewed-head',
    }));
  });
});
