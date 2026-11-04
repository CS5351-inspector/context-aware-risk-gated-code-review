/** 把旧 Review 协议显式转换为统一 Finding，校验坐标与引用，不生成 URL。 */
import { InvalidReviewResponseError, parseReviewResponse, readReviewContent } from '../chat.js';
import type { ContextSnippet, Finding, ModelInput, Omission, Side } from './model-types.js';

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 解析 unified diff 的两侧可见行；只允许 patch 内真实出现的行，不猜测 hunk 首行。
 * 同时验证 hunk 声明长度，防止截断的 patch 被当成完整必要输入。
 */
export function patchLines(patch: string): Record<Side, Set<number>> {
  const visible = { LEFT: new Set<number>(), RIGHT: new Set<number>() };
  let left = 0, right = 0, oldRemaining = 0, newRemaining = 0, hunks = 0;
  const rows = patch.replace(/\r\n/g, '\n').split('\n');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(row);
    if (header) {
      if (oldRemaining || newRemaining) throw new InvalidReviewResponseError('incomplete diff hunk');
      left = Number(header[1]); right = Number(header[3]);
      oldRemaining = Number(header[2] ?? 1); newRemaining = Number(header[4] ?? 1);
      if (![left, right, oldRemaining, newRemaining].every(Number.isSafeInteger)) {
        throw new InvalidReviewResponseError('invalid diff coordinates');
      }
      if ((oldRemaining > 0 && left < 1) || (newRemaining > 0 && right < 1)) {
        throw new InvalidReviewResponseError('invalid diff origin');
      }
      hunks++;
      continue;
    }
    if (!hunks) continue; // 允许 diff --git、---、+++ 等文件头。
    if (row === '\\ No newline at end of file' || (row === '' && i === rows.length - 1)) continue;
    if (row.startsWith(' ') || row.startsWith('-')) {
      visible.LEFT.add(left++); oldRemaining--;
    }
    if (row.startsWith(' ') || row.startsWith('+')) {
      visible.RIGHT.add(right++); newRemaining--;
    }
    if (!/^[ +\-]/.test(row) || oldRemaining < 0 || newRemaining < 0) {
      throw new InvalidReviewResponseError('invalid diff hunk body');
    }
  }
  if (!hunks || oldRemaining || newRemaining) throw new InvalidReviewResponseError('missing or incomplete diff');
  return visible;
}

/** 逐条验证结构与来源；保留有效发现，并将混杂的无效条目标为必要遗漏。 */
export function convertFindings(
  completion: unknown, input: ModelInput, file: string, patch: string,
  snippets: ContextSnippet[]
): { findings: Finding[]; omissions: Omission[] } {
  let payload: unknown;
  try { payload = JSON.parse(readReviewContent(completion)); }
  catch (error) {
    if (error instanceof InvalidReviewResponseError) throw error;
    throw new InvalidReviewResponseError('expected valid JSON');
  }
  const reviews = record(payload) && Array.isArray(payload.reviews) ? payload.reviews : [payload];
  const lines = patchLines(patch);
  const findings: Finding[] = [];
  const omissions: Omission[] = [];
  const omit = (reason: Omission['reason'], required = true) =>
    omissions.push({ file, stage: 'model', reason, required });

  let validReviews = 0;
  for (const raw of reviews) {
    try {
      const review = parseReviewResponse(JSON.stringify(raw));
      if (Array.isArray(review)) throw new InvalidReviewResponseError('invalid nested review');
      if (review.lgtm) { validReviews++; continue; }
      if (!record(raw)) throw new InvalidReviewResponseError('invalid finding');
      const legacy = ['file', 'side', 'line', 'severity', 'evidenceIds'].every(key => !(key in raw));
      // 旧格式没有位置、证据和严重性：保留文字，明确未验证，不能装成可靠空结果。
      if (legacy) {
        findings.push({ id: `${file}:${findings.length + 1}`, file, side: 'RIGHT', line: null,
          severity: 'medium', message: review.review_comment, evidenceIds: [], validation: 'UNVERIFIED' });
        omit('UNVERIFIED_FINDING');
        validReviews++;
        continue;
      }
      if (raw.file !== file || typeof raw.side !== 'string' || !['LEFT', 'RIGHT'].includes(raw.side)
        || typeof raw.severity !== 'string' || !['low', 'medium', 'high'].includes(raw.severity)
        || !(raw.line === null || (typeof raw.line === 'number' && Number.isSafeInteger(raw.line) && raw.line > 0))
        || !Array.isArray(raw.evidenceIds) || !raw.evidenceIds.every(id => typeof id === 'string' && id.trim())) {
        throw new InvalidReviewResponseError('invalid finding fields');
      }
      const side = raw.side as Side;
      let line = raw.line as number | null;
      let validation: Finding['validation'] = line === null ? 'UNLOCATED' : 'VERIFIED';
      // 不在本次 diff 中的行号降级到正文，同时使该文件分析不完整。
      if (line !== null && !lines[side].has(line)) {
        line = null; validation = 'UNVERIFIED'; omit('UNVERIFIED_FINDING');
      } else if (line === null) omit('UNLOCATED_FINDING', false);
      const expectedRef = side === 'RIGHT' ? input.headSha : input.diffBaseSha;
      const evidenceIds = [...new Set(raw.evidenceIds as string[])];
      const validIds = evidenceIds.filter(id => snippets.some(s => s.id === id && s.ref === expectedRef));
      // diff-only 没有上下文 ID；context 中也可以直接以 patch 为依据，不强制伪造引用。
      if (validIds.length !== evidenceIds.length) {
        validation = 'UNVERIFIED'; omit('INVALID_EVIDENCE');
      }
      findings.push({ id: `${file}:${findings.length + 1}`, file, side, line,
        severity: raw.severity as Finding['severity'], message: review.review_comment,
        evidenceIds: validIds, validation });
      validReviews++;
    } catch (error) {
      if (!(error instanceof InvalidReviewResponseError)) throw error;
      omit('INVALID_OUTPUT');
    }
  }
  if (reviews.length && !validReviews) throw new InvalidReviewResponseError('invalid finding fields');
  return { findings, omissions };
}
