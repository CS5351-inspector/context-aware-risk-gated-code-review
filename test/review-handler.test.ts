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
const completePatch = '@@ -1 +1 @@\n-old\n+new';
const changedFile = (filename: string, patch?: string, status = 'modified') => ({
  filename, status, patch, additions: 1, deletions: 1,
  contents_url: `https://api.github.com/repos/owner/repo/contents/${filename}`,
});

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

  const setup = (files = [changedFile('src/file.ts', completePatch)]) => {
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
        paginate: jest.fn().mockResolvedValue(files),
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

    await expect(handler(context)).rejects.toMatchObject({ name: 'InvalidReviewResponseError' });
    expect(createReview.mock.calls[0][0].body).toContain('Code review incomplete (FAILED)');
    expect(createReview.mock.calls[0][0].body).toContain('model response invalid');
    expect(createReview.mock.calls[0][0].body).not.toContain('LGTM');
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

  // 模拟 GitHub 提供的 patch 在发给模型之前就无法审查的情况。
  test.each([
    { name: 'missing patch', patch: undefined, reason: 'patch missing' },
    { name: 'blank patch', patch: ' \r\n', reason: 'patch missing' },
    { name: 'truncated patch', patch: '@@ -1,2 +1,2 @@\n-old\n+new', reason: 'invalid or incomplete patch' },
    { name: 'oversized patch', patch: completePatch, maxPatchLength: '1', reason: 'patch exceeds MAX_PATCH_LENGTH' },
  ])('reports failed coverage for $name', async ({ patch, maxPatchLength, reason }) => {
    if (maxPatchLength) process.env.MAX_PATCH_LENGTH = maxPatchLength;
    const { handler, context, createReview } = setup([changedFile('src/skipped.ts', patch)]);

    await handler(context);

    expect(mockCreate).not.toHaveBeenCalled();
    const { body } = createReview.mock.calls[0][0];
    expect(body).toContain('Code review incomplete (FAILED)');
    expect(body).toContain('Reviewed 0 of 1 eligible files.');
    expect(body).toContain(`\`src/skipped.ts\` (${reason})`);
    expect(body).not.toContain('LGTM');
  });

  test('preserves inline findings in a partial review', async () => {
    mockCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ reviews: [{
        lgtm: false, review_comment: 'Check this change.', hunk_header: '@@ -1 +1 @@',
      }] }),
    } }] });
    const { handler, context, createReview } = setup([
      changedFile('src/reviewed.ts', completePatch), changedFile('src/skipped.ts'),
    ]);

    await handler(context);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const { body, comments, commit_id } = createReview.mock.calls[0][0];
    expect(body).toContain('Code review incomplete (PARTIAL)');
    expect(body).toContain('Reviewed 1 of 2 eligible files.');
    expect(body).toContain('`src/skipped.ts` (patch missing)');
    expect(body).toContain('<!-- chatgpt-code-review-incomplete -->');
    expect(comments).toEqual([{ path: 'src/reviewed.ts', body: 'Check this change.', side: 'RIGHT', line: 1 }]);
    expect(commit_id).toBe('reviewed-head');
  });

  test('detects a whole missing hunk using GitHub change counts', async () => {
    const { handler, context, createReview } = setup([
      { ...changedFile('src/truncated.ts', completePatch), additions: 2, deletions: 2 },
    ]);
    mockCreate.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: '{"reviews":[]}' } }] });

    await handler(context);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(createReview.mock.calls[0][0].body).toContain('Code review incomplete (FAILED)');
    expect(createReview.mock.calls[0][0].body).toContain('invalid or incomplete patch');
  });

  test('preserves prior findings and retries omitted files after a later model failure', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ finish_reason: 'stop', message: {
      content: JSON.stringify({ reviews: [{ lgtm: false, review_comment: 'Existing finding', hunk_header: '@@ -1 +1 @@' }] }),
    } }] }).mockRejectedValueOnce(new Error('upstream private details'));
    const { handler, context, createReview } = setup([
      changedFile('src/reviewed.ts', completePatch), changedFile('src/failed.ts', completePatch),
    ]);

    await expect(handler(context)).rejects.toThrow('upstream private details');

    const { body, comments } = createReview.mock.calls[0][0];
    expect(body).toContain('Code review incomplete (PARTIAL)');
    expect(body).toContain('Reviewed 1 of 2 eligible files.');
    expect(body).toContain('model request failed');
    expect(body).toContain('<!-- chatgpt-code-review-incomplete -->');
    expect(body).not.toContain('upstream private details');
    expect(comments).toEqual([{ path: 'src/reviewed.ts', body: 'Existing finding', side: 'RIGHT', line: 1 }]);
  });

  test.each(['NaN', 'Infinity', '-1', '0', '1.5', ''])('rejects invalid MAX_PATCH_LENGTH=%j before provider calls', value => {
    process.env.MAX_PATCH_LENGTH = value;
    expect(() => setup()).toThrow('Invalid MAX_PATCH_LENGTH');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('leaves a PR with only excluded statuses without a review', async () => {
    const { handler, context, createReview } = setup([changedFile('src/deleted.ts', undefined, 'removed')]);

    await expect(handler(context)).resolves.toBe('no change');
    expect(mockCreate).not.toHaveBeenCalled();
    expect(createReview).not.toHaveBeenCalled();
  });
});
