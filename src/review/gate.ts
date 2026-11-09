/** D 模块：基于一次可信快照重放批准历史，返回决策；不执行 GitHub 写操作。 */
import type { ApprovalReview, DecideGate, GateResult } from './contracts.js';
import { validateReviewConfig } from './config.js';
import { hasCompleteCoverage, isValidAnalysis } from './risk.js';

const sha = (value: string) => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);
const login = (value: string) => typeof value === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(value);
const reviewLogin = (value: string) => login(value) || (typeof value === 'string' && value.endsWith('[bot]') && login(value.slice(0, -5)));
const identity = (value: string) => value.toLowerCase();
const writable = new Set(['write', 'maintain', 'admin']);
const states = new Set(['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED', 'DISMISSED']);

/** Date.parse normalizes some impossible dates; approval ordering must reject those inputs. */
function validReviewTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day && hour < 24 && minute < 60 && second < 60;
}

/** 重复快照可幂等输入；相同 review ID 的冲突快照必须先在适配层解决。 */
function orderedHistory(reviews: ApprovalReview[]): ApprovalReview[] {
  const unique = new Map<number, ApprovalReview>();
  const actors = new Map<string, ApprovalReview['actorType']>();
  for (const review of reviews) {
    if (!review || !Number.isSafeInteger(review.id) || review.id < 1 || !reviewLogin(review.login)
      || !['User', 'Bot'].includes(review.actorType)
      || !['read', 'triage', 'write', 'maintain', 'admin'].includes(review.permission)
      || !sha(review.commitSha) || !states.has(review.state)
      || !validReviewTime(review.submittedAt)) throw new Error('Invalid review history');
    const key = identity(review.login);
    if (actors.has(key) && actors.get(key) !== review.actorType) throw new Error('Conflicting actor identity');
    actors.set(key, review.actorType);
    const previous = unique.get(review.id);
    if (previous && (identity(previous.login) !== identity(review.login)
      || previous.actorType !== review.actorType || previous.permission !== review.permission
      || previous.commitSha !== review.commitSha || previous.state !== review.state
      || Date.parse(previous.submittedAt) !== Date.parse(review.submittedAt))) {
      throw new Error('Conflicting review snapshots');
    }
    unique.set(review.id, review);
  }
  return [...unique.values()].sort((a, b) =>
    Date.parse(a.submittedAt) - Date.parse(b.submittedAt) || a.id - b.id);
}

export const decideGate: DecideGate = (analysis, risk, context, config) => {
  const required = Number.isSafeInteger(config?.requiredApprovals) && config.requiredApprovals >= 1
    ? config.requiredApprovals : 1;
  const result = (state: GateResult['state'], reason: string, validApprovers: string[] = []): GateResult =>
    ({ state, reasons: [reason], requiredApprovals: required, validApprovers });
  try { validateReviewConfig(config); } catch { return result('ERROR', 'INVALID_CONFIG'); }
  if (!context || context.configValid !== true) return result('ERROR', 'INVALID_CONFIG');
  if (!sha(context.reviewedHeadSha) || !sha(context.currentHeadSha) || !login(context.prAuthor)
    || !Array.isArray(context.reviews)) return result('ERROR', 'INVALID_GATE_CONTEXT');
  if (context.reviewedHeadSha !== context.currentHeadSha) return result('STALE', 'HEAD_CHANGED');
  if (!risk || !['LOW', 'MEDIUM', 'HIGH', 'UNKNOWN'].includes(risk.level)
    || risk.ruleVersion !== config.ruleVersion
    || !Array.isArray(risk.factors) || risk.factors.some(factor => typeof factor !== 'string')
    || !isValidAnalysis(analysis)) return result('ERROR', 'INVALID_ANALYSIS');
  // D 的两个函数必须使用同一份输入；拒绝将保留 HIGH 与低风险结果混用。
  if (analysis.findings.some(item => item.severity === 'high') && risk.level !== 'HIGH') {
    return result('ERROR', 'INCONSISTENT_RISK');
  }
  let history: ApprovalReview[];
  try { history = orderedHistory(context.reviews); } catch { return result('ERROR', 'INVALID_REVIEW_HISTORY'); }
  const decisions = new Map<string, ApprovalReview>();
  const actors = new Map<string, ApprovalReview>();
  for (const review of history) {
    const key = identity(review.login);
    // 最新身份/权限也适用于较早的批准，避免降权后的旧批准继续生效。
    actors.set(key, review);
    if (review.state !== 'COMMENTED') decisions.set(key, review);
  }
  const validApprovers: string[] = [];
  let changesRequested = false;
  for (const [key, decision] of decisions) {
    const actor = actors.get(key)!;
    if (key === identity(context.prAuthor) || actor.actorType !== 'User' || actor.login.endsWith('[bot]') || !writable.has(actor.permission)) continue;
    if (decision.state === 'CHANGES_REQUESTED') changesRequested = true;
    if (decision.state === 'APPROVED' && decision.commitSha === context.reviewedHeadSha) {
      validApprovers.push(key);
    }
  }
  validApprovers.sort();
  // 请求修改跨提交保留，直到该成员批准或撤销；其他成员的批准不能覆盖它。
  if (changesRequested) return result('WAITING', 'CHANGES_REQUESTED', validApprovers);
  if (hasCompleteCoverage(analysis) && (risk.level === 'LOW' || risk.level === 'MEDIUM')) {
    return result('PASS', 'COMPLETE_LOW_MEDIUM', validApprovers);
  }
  if (validApprovers.length >= required) return result('PASS', 'HUMAN_APPROVED', validApprovers);
  return result('WAITING', 'APPROVAL_REQUIRED', validApprovers);
};
