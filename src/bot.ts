import { Context, Probot } from 'probot';
import { minimatch } from 'minimatch'

import { Chat, InvalidReviewResponseError } from './chat.js';
import { patchLines } from './review/findings.js';
import log from 'loglevel';

const OPENAI_API_KEY = 'OPENAI_API_KEY';
// 比较接口返回接近文件上限时，下面会退回完整的 PR 文件列表，避免漏审。
const COMPARE_FILES_LIMIT = 300;
// 隐藏的 Markdown 标记帮助机器人在历史 review 中找到自己的记录。
const REVIEW_MARKER = '<!-- chatgpt-code-review -->';
const INCOMPLETE_REVIEW_MARKER = '<!-- chatgpt-code-review-incomplete -->';

type ReviewCoverage = {
  reviewedFiles: number;
  skippedFiles: Array<{ filename: string; reason: string }>;
};

type PullRequestContext = Context<
  'pull_request.opened' | 'pull_request.synchronize'
>;

// 解析 @@ -旧起点,旧行数 +新起点,新行数 @@。返回 null 让调用者选择正文评论。
const parseHunkHeader = (hunkHeader?: string) => {
  if (!hunkHeader) {
    return null;
  }

  const match = hunkHeader.trim().match(
    /^@@\s+-\s*(\d+)(?:,(\d+))?\s+\+\s*(\d+)(?:,(\d+))?\s+@@/
  );
  if (!match) {
    return null;
  }

  // match[0] 是整段匹配结果，解构时第一个逗号跳过它。省略行数时默认为 1。
  const [, oldStartValue, oldCountValue, newStartValue, newCountValue] = match;
  const oldStart = Number(oldStartValue);
  const oldCount = oldCountValue === undefined ? 1 : Number(oldCountValue);
  const newStart = Number(newStartValue);
  const newCount = newCountValue === undefined ? 1 : Number(newCountValue);

  return { oldStart, oldCount, newStart, newCount };
};

export const getReviewCommentLocation = (hunkHeader?: string) => {
  const range = parseHunkHeader(hunkHeader);
  if (!range) {
    return null;
  }

  const { oldStart, oldCount, newStart, newCount } = range;

  // 旧评论定位优先用新侧的最后一行。纯删除时用旧侧的最后一行。
  if (newCount > 0) {
    return {
      line: newStart + newCount - 1,
      side: 'RIGHT' as const,
    };
  }

  if (oldCount > 0) {
    return {
      line: oldStart + oldCount - 1,
      side: 'LEFT' as const,
    };
  }

  return null;
};

export const isHunkHeaderInPatch = (
  hunkHeader: string | undefined,
  patch: string
) => {
  const expectedRange = parseHunkHeader(hunkHeader);
  if (!expectedRange) {
    return false;
  }

  // some 找到任一真实 hunk 匹配即可。比较四个数字，也接受省略逗号行数的等价格式。
  return patch.split('\n').some((line) => {
    if (!line.startsWith('@@')) {
      return false;
    }
    const actualRange = parseHunkHeader(line);
    return (
      actualRange?.oldStart === expectedRange.oldStart &&
      actualRange.oldCount === expectedRange.oldCount &&
      actualRange.newStart === expectedRange.newStart &&
      actualRange.newCount === expectedRange.newCount
    );
  });
};

export const createInlineReviewComment = (
  path: string,
  body: string,
  hunkHeader: string | undefined,
  patch: string
) => {
  // 先算坐标，再核对模型给的 hunk 确实出现在本文件 patch。成功时返回 GitHub 行内评论字段。
  const location = getReviewCommentLocation(hunkHeader);
  if (!location || !isHunkHeaderInPatch(hunkHeader, patch)) {
    return null;
  }

  return {
    path,
    body,
    line: location.line,
    side: location.side,
  };
};

export const createReviewBody = (
  hasInlineComments: boolean,
  bodyComments: string[],
  coverage?: ReviewCoverage
) => {
  // 必要 patch 被跳过时，先披露覆盖情况，再保留已经得到的意见。
  if (coverage?.skippedFiles.length) {
    const { reviewedFiles, skippedFiles } = coverage;
    const status = reviewedFiles === 0 ? 'FAILED' : 'PARTIAL';
    const skipped = skippedFiles.map(({ filename, reason }) => {
      // 转义文件名里的换行和反引号，确保文件名完整留在 Markdown 行内代码中。
      const displayName = JSON.stringify(filename).slice(1, -1).replace(/`/g, '\\u0060');
      return `- \`${displayName}\` (${reason})`;
    });
    return [
      `Code review incomplete (${status})`,
      `Reviewed ${reviewedFiles} of ${reviewedFiles + skippedFiles.length} eligible files.`,
      ['Skipped files:', ...skipped].join('\n'),
      ...bodyComments,
      REVIEW_MARKER,
      INCOMPLETE_REVIEW_MARKER,
    ].join('\n\n');
  }

  // 完整审查根据是否有意见选择标题。尾部标记供下一次 synchronize 找回记录。
  const heading =
    hasInlineComments || bodyComments.length
      ? 'Code review by ChatGPT'
      : 'LGTM 👍';
  return [heading, ...bodyComments, REVIEW_MARKER].join('\n\n');
};

export const getChangedFiles = async (context: PullRequestContext) => {
  // Octokit 是 GitHub API 客户端。paginate 按每页 100 条取齐 PR 文件。
  const repo = context.repo();
  const pullRequestFiles = await context.octokit.paginate(
    context.octokit.pulls.listFiles,
    {
      owner: repo.owner,
      repo: repo.repo,
      pull_number: context.pullRequest().pull_number,
      per_page: 100,
    }
  );

  // 初次打开 PR 直接使用完整文件列表。synchronize 才尝试找需要重新审查的文件。
  if (context.payload.action !== 'synchronize') {
    return pullRequestFiles;
  }

  let comparisonBase: string | undefined;

  try {
    const reviews = await context.octokit.paginate(
      context.octokit.pulls.listReviews,
      {
        owner: repo.owner,
        repo: repo.repo,
        pull_number: context.pullRequest().pull_number,
        per_page: 100,
      }
    );
    // slice 复制数组，reverse 让 find 优先查较后的记录，只认 Bot 用户和自己的隐藏标记。
    const botReview = reviews
      .slice()
      .reverse()
      .find((r) =>
        r.user?.type === 'Bot' &&
        r.body?.includes(REVIEW_MARKER)
      );

    if (botReview) {
      // 上次覆盖不足时重新检查整个 PR，确保本次没改动的遗漏文件也有机会重审。
      if (!botReview.commit_id || botReview.body?.includes(INCOMPLETE_REVIEW_MARKER)) {
        return pullRequestFiles;
      }
      comparisonBase = botReview.commit_id;
    } else {
      const hasLegacyReview = reviews.some(
        (r) =>
          r.user?.type === 'Bot' &&
          r.body &&
          (r.body.startsWith('Code review by ChatGPT') ||
            r.body.startsWith('LGTM'))
      );
      if (hasLegacyReview) {
        return pullRequestFiles;
      }
    }
  } catch (err) {
    log.debug('failed to detect previous bot review', err);
    return pullRequestFiles;
  }

  // before only describes the latest push; without a completed review, older
  // unchanged files may never have been analyzed. Start from the whole PR.
  if (!comparisonBase) {
    return pullRequestFiles;
  }

  try {
    const { data } = await context.octokit.repos.compareCommits({
      owner: repo.owner,
      repo: repo.repo,
      base: comparisonBase,
      head: context.payload.pull_request.head.sha,
    });

    // identical 表示这次比较没有差异。ahead 表示可从旧提交到新提交筛出变化文件。
    if (data.status === 'identical') {
      return [];
    }

    if (data.status === 'ahead') {
      if (!data.files) {
        log.debug(
          'commit comparison omitted files; using the full pull request diff'
        );
        return pullRequestFiles;
      }

      const comparisonFiles = data.files;
      if (comparisonFiles.length >= COMPARE_FILES_LIMIT) {
        log.debug(
          'commit comparison reached the GitHub file limit; using the full pull request diff'
        );
        return pullRequestFiles;
      }

      // compareCommits 提供要重审的文件名，实际传下去的文件对象及 patch 仍来自 PR 文件列表。
      const changedFilenames = new Set(
        comparisonFiles.map((file) => file.filename)
      );
      return pullRequestFiles.filter((file) =>
        changedFilenames.has(file.filename)
      );
    }

    log.debug(
      `commit comparison from ${comparisonBase} is ${data.status}; using the full pull request diff`
    );
  } catch (err) {
    log.debug(`failed to compare commits from ${comparisonBase}`, err);
  }

  return pullRequestFiles;
};

export const robot = (app: Probot) => {
  // 在注册事件时读取 patch 长度上限。length 使用 JavaScript 字符串长度。
  const configuredLimit = process.env.MAX_PATCH_LENGTH;
  const maxPatchLength = configuredLimit === undefined ? Infinity : Number(configuredLimit);
  if (configuredLimit !== undefined && (!configuredLimit.trim()
    || !Number.isSafeInteger(maxPatchLength) || maxPatchLength < 1)) {
    throw new Error('Invalid MAX_PATCH_LENGTH: expected a positive integer');
  }

  // 在 GitHub Actions 中把未处理错误反映到进程退出码，供工作流识别失败。
  if (process.env.GITHUB_ACTIONS === 'true') {
    app.onError(() => {
      process.exitCode = 1;
    });
  }

  // 按顺序尝试 GitHub Models token、环境中的 API Key、仓库 Actions 变量。
  const loadChat = async (context: Context) => {
    if (process.env.USE_GITHUB_MODELS === 'true' && process.env.GITHUB_TOKEN) {
      return new Chat(process.env.GITHUB_TOKEN);
    }

    if (process.env.OPENAI_API_KEY) {
      return new Chat(process.env.OPENAI_API_KEY);
    }

    const repo = context.repo();

    try {
      const { data } = (await context.octokit.request(
        'GET /repos/{owner}/{repo}/actions/variables/{name}',
        {
          owner: repo.owner,
          repo: repo.repo,
          name: OPENAI_API_KEY,
        }
      )) as any;

      if (!data?.value) {
        return null;
      }

      return new Chat(data.value);
    } catch {
      await context.octokit.issues.createComment({
        repo: repo.repo,
        owner: repo.owner,
        issue_number: context.pullRequest().pull_number,
        body: `Seems you are using me but didn't get OPENAI_API_KEY seted in Variables/Secrets for this repo. you could follow [readme](https://github.com/anc95/ChatGPT-CodeReview) for more information`,
      });
      return null;
    }
  };

  // 注册事件入口。opened 是创建 PR，synchronize 是已有 PR 的来源分支更新。
  app.on(
    ['pull_request.opened', 'pull_request.synchronize'],
    async (context) => {
      const repo = context.repo();
      const chat = await loadChat(context);

      if (!chat) {
        log.info('Chat initialized failed');
        return 'no chat';
      }

      const pull_request = context.payload.pull_request;

      log.debug('pull_request:', pull_request);

      if (
        pull_request.state === 'closed' ||
        pull_request.locked
      ) {
        log.info('invalid event payload');
        return 'invalid event payload';
      }

      // 只有配置 TARGET_LABEL 时才检查标签。every 为真表示没有一个标签与目标匹配。
      const target_label = process.env.TARGET_LABEL;
      if (
        target_label &&
        (!pull_request.labels?.length ||
          pull_request.labels.every((label) => label.name !== target_label))
      ) {
        log.info('no target label attached');
        return 'no target label attached';
      }

      let changedFiles = await getChangedFiles(context);

      log.debug('changedFiles:', changedFiles);
      log.debug

      // IGNORE 按换行拆成精确文件名，IGNORE_PATTERNS 与 INCLUDE_PATTERNS 按逗号拆成模式。
      const ignoreList = (process.env.IGNORE || process.env.ignore || '')
          .split('\n')
          .filter((v) => v !== '');
      const ignorePatterns = (process.env.IGNORE_PATTERNS || '').split(',').filter((v) => Boolean(v.trim()));
      const includePatterns = (process.env.INCLUDE_PATTERNS || '').split(',').filter((v) => Boolean(v.trim()));

      log.debug('ignoreList:', ignoreList);
      log.debug('ignorePatterns:', ignorePatterns);
      log.debug('includePatterns:', includePatterns);

      changedFiles = changedFiles?.filter(
        (file) => {
          const url = new URL(file.contents_url)
          const pathname = decodeURIComponent(url.pathname)
          // if includePatterns is not empty, only include files that match the pattern
          // include 有配置时直接返回它的匹配结果，这个文件的筛选到此结束。
          if (includePatterns.length) {
            return matchPatterns(includePatterns, pathname)
          }

          if (ignoreList.includes(file.filename)) {
            return false;
          }

          // if ignorePatterns is not empty, ignore files that match the pattern
          if (ignorePatterns.length) {
            return !matchPatterns(ignorePatterns, pathname)
          }

          return true
      })

      const eligibleFiles = changedFiles?.filter(file =>
        file.status === 'modified' || file.status === 'added'
      ) ?? [];
      if (!eligibleFiles.length) {
        log.info('no change found');
        return 'no change';
      }

      console.time('gpt cost');

      // ress 收集可以发布在代码行上的评论，bodyComments 收集需要放在 PR review 正文的意见。
      const ress = [];
      const bodyComments = [];
      const skippedFiles: ReviewCoverage['skippedFiles'] = [];
      let modelFailure: { error: unknown } | null = null;

      // 对每份必要 patch 做预检。跳过的文件进入覆盖记录，方便审阅人安排重审。
      for (const file of eligibleFiles) {
        const { patch } = file;
        if (!patch?.trim()) {
          skippedFiles.push({ filename: file.filename, reason: 'patch missing' });
          continue;
        }
        if (patch.length > maxPatchLength) {
          skippedFiles.push({ filename: file.filename, reason: 'patch exceeds MAX_PATCH_LENGTH' });
          continue;
        }
        try {
          patchLines(patch, file);
        } catch (error) {
          if (!(error instanceof InvalidReviewResponseError)) throw error;
          skippedFiles.push({ filename: file.filename, reason: 'invalid or incomplete patch' });
          continue;
        }
        try {
          // PR 事件当前调用旧的逐文件 codeReview。整次 PR 的 reviewFiles 入口位于 review/model-review.ts。
          const res = await chat?.codeReview(patch);
          // res can be a single review or an array of reviews (one for each hunk)
          const reviews = Array.isArray(res) ? res : [res];
          
          for (const review of reviews) {
            if (!review.lgtm && !!review.review_comment) {
              const inlineComment = createInlineReviewComment(
                file.filename,
                review.review_comment,
                review.hunk_header,
                patch
              );
              // 定位不成功时保留意见正文。文件名中的反引号先转义，以便放进 Markdown。
              if (!inlineComment) {
                const filename = file.filename.replace(/`/g, '\\`');
                bodyComments.push(
                  `**File:** \`${filename}\`\n\n${review.review_comment}`
                );
                log.error(
                  `Failed to locate inline review comment: ${review.hunk_header || 'missing hunk header'}`
                );
                continue;
              }

              ress.push(inlineComment)
            }
          }
        } catch (e) {
          // Preserve earlier findings and record a rerun marker before surfacing
          // the API/response failure to the workflow. Do not publish raw error text.
          log.info(`review ${file.filename} failed`, e);
          skippedFiles.push({ filename: file.filename, reason: e instanceof InvalidReviewResponseError
            ? 'model response invalid' : 'model request failed' });
          modelFailure ??= { error: e };
        }
      }
      // 统一发布一次 COMMENT review，携带事件中的 head SHA 和收集到的行内评论。
      try {
        await context.octokit.pulls.createReview({
          repo: repo.repo,
          owner: repo.owner,
          pull_number: context.pullRequest().pull_number,
          body: createReviewBody(ress.length > 0, bodyComments, {
            reviewedFiles: eligibleFiles.length - skippedFiles.length,
            skippedFiles,
          }),
          event: 'COMMENT',
          commit_id: context.payload.pull_request.head.sha,
          comments: ress,
        });
      } catch (e) {
        log.info(`Failed to create review`, e);
        throw e;
      }

      console.timeEnd('gpt cost');
      if (modelFailure) throw modelFailure.error;
      log.info(
        skippedFiles.length ? 'review published with skipped files' : 'successfully reviewed',
        context.payload.pull_request.html_url
      );

      return 'success';
    }
  );
};

const matchPatterns = (patterns: string[], path: string) => {
  // 每个模式先按 glob 匹配。glob 处理抛错时再尝试正则，任一模式匹配即可。
  return patterns.some((pattern) => {
    try {
      return minimatch(path, pattern.startsWith('/') ? "**" + pattern : pattern.startsWith("**") ? pattern : "**/" + pattern);
    } catch {
      // if the pattern is not a valid glob pattern, try to match it as a regular expression
      try {
        return new RegExp(pattern).test(path);
      } catch (e) {
        return false;
      }
    }
  })
}
