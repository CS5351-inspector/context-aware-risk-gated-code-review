/** D 模块：纯函数。只计算风险，不调用模型、不写 GitHub、不改变输入。 */
import { minimatch } from 'minimatch';
import type { AnalysisResult, CalculateRisk, ReviewInput } from './contracts.js';
import { validateReviewConfig } from './config.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const repositoryPath = (value: unknown): value is string => text(value)
  && !value.startsWith('/') && !value.includes('\\')
  && !/[\x00-\x1f\x7f]/.test(value)
  && !value.split('/').some(part => part === '.' || part === '..' || part === '');
const uniqueTexts = (value: unknown): value is string[] => Array.isArray(value)
  && value.every(text) && new Set(value).size === value.length;

/** Validate only the domain fields D consumes; this does not validate model metrics or prove a bug. */
export function isValidAnalysis(value: unknown): boolean {
  if (!isRecord(value) || typeof value.analysisStatus !== 'string'
    || !['COMPLETE', 'PARTIAL', 'FAILED', 'NOT_APPLICABLE'].includes(value.analysisStatus)
    || !isRecord(value.scope)) return false;
  const { scope } = value;
  if (!uniqueTexts(scope.supportedFiles) || !scope.supportedFiles.every(repositoryPath)
    || !uniqueTexts(scope.analyzedFiles) || !scope.analyzedFiles.every(repositoryPath)
    || !uniqueTexts(scope.excludedFiles) || !scope.excludedFiles.every(repositoryPath)) return false;
  const supported = new Set(scope.supportedFiles);
  if (scope.analyzedFiles.some(file => !supported.has(file))
    || scope.excludedFiles.some(file => supported.has(file))
    || (value.analysisStatus === 'NOT_APPLICABLE' && supported.size > 0)
    || (value.analysisStatus === 'COMPLETE' && supported.size === 0)) return false;
  if (!Array.isArray(value.omissions) || !value.omissions.every(item => isRecord(item)
    && typeof item.required === 'boolean' && (item.file === null || repositoryPath(item.file))
    && typeof item.stage === 'string' && ['input', 'context', 'model'].includes(item.stage)
    && text(item.reason))) return false;
  if (!Array.isArray(value.findings) || !value.findings.every(item => isRecord(item)
    && text(item.id) && repositoryPath(item.file) && supported.has(item.file)
    && typeof item.side === 'string' && ['LEFT', 'RIGHT'].includes(item.side)
    && (item.line === null || (typeof item.line === 'number' && Number.isSafeInteger(item.line) && item.line > 0))
    && typeof item.severity === 'string' && ['low', 'medium', 'high'].includes(item.severity)
    && typeof item.validation === 'string' && ['VERIFIED', 'UNLOCATED', 'UNVERIFIED'].includes(item.validation)
    && (item.validation !== 'VERIFIED' || item.line !== null)
    && text(item.message) && uniqueTexts(item.evidenceIds))) return false;
  return new Set(value.findings.map(item => item.id)).size === value.findings.length;
}

/** COMPLETE 还必须有实际覆盖，不能仅相信一个状态字符串。 */
export function hasCompleteCoverage(analysis: AnalysisResult): boolean {
  if (!isValidAnalysis(analysis)) return false;
  const supported = new Set(analysis.scope.supportedFiles);
  const analyzed = new Set(analysis.scope.analyzedFiles);
  return analysis.analysisStatus === 'COMPLETE' && supported.size > 0
    && analyzed.size === supported.size && [...supported].every(file => analyzed.has(file))
    && !analysis.omissions.some(item => item.required)
    && analysis.findings.every(item => item.validation === 'VERIFIED');
}

function validateInput(input: ReviewInput): void {
  if (!input || !Array.isArray(input.changedFiles)) throw new Error('Invalid risk input');
  const seen = new Set<string>();
  for (const file of input.changedFiles) {
    const paths = [file.path, ...(file.previousPath === undefined ? [] : [file.previousPath])];
    if (paths.some(path => !repositoryPath(path)) || typeof file.supported !== 'boolean'
      || seen.has(file.path)
      || !Number.isSafeInteger(file.additions) || file.additions < 0
      || !Number.isSafeInteger(file.deletions) || file.deletions < 0) {
      throw new Error('Invalid risk input');
    }
    seen.add(file.path);
  }
}

/** 全 PR 的规模与敏感路径都参与计算，包括未支持、删除、重命名前的路径。 */
export const calculateRisk: CalculateRisk = (input, analysis, config) => {
  validateReviewConfig(config);
  validateInput(input);
  if (!isValidAnalysis(analysis)) throw new Error('Invalid risk analysis');
  const supported = input.changedFiles.filter(file => file.supported).map(file => file.path);
  const excluded = input.changedFiles.filter(file => !file.supported).map(file => file.path);
  if (supported.length !== analysis.scope.supportedFiles.length
    || supported.some(file => !analysis.scope.supportedFiles.includes(file))
    || excluded.length !== analysis.scope.excludedFiles.length
    || excluded.some(file => !analysis.scope.excludedFiles.includes(file))) {
    throw new Error('Analysis scope does not match the PR snapshot');
  }
  const factors: string[] = [];
  const high = analysis.findings.filter(item => item.severity === 'high');
  const medium = analysis.findings.some(item => item.severity === 'medium' && item.validation === 'VERIFIED');
  const unavailable = analysis.analysisStatus !== 'NOT_APPLICABLE' && !hasCompleteCoverage(analysis);
  if (unavailable) factors.push('ANALYSIS_UNAVAILABLE');
  const sensitive = input.changedFiles.some(file =>
    [file.path, ...(file.previousPath ? [file.previousPath] : [])].some(path =>
      config.sensitivePaths.some(pattern => minimatch(path, pattern, {
        dot: true, nonegate: true, nocomment: true,
      }))));
  if (sensitive) factors.push('SENSITIVE_PATH');
  if (high.length) factors.push(high.some(item => item.validation === 'VERIFIED')
    ? 'VERIFIED_HIGH_FINDING' : 'RETAINED_HIGH_FINDING');
  if (medium) factors.push('VERIFIED_MEDIUM_FINDING');
  const changedLines = input.changedFiles.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  if (!Number.isSafeInteger(changedLines)) throw new Error('Invalid total change size');
  const large = changedLines >= config.mediumChangedLines || input.changedFiles.length >= config.mediumChangedFiles;
  if (large) factors.push('CHANGE_SIZE');
  // 已知 HIGH 优先于 UNKNOWN；检查失败不能抹去已保留的高风险意见。
  const level = sensitive || high.length ? 'HIGH' : unavailable ? 'UNKNOWN' : medium || large ? 'MEDIUM' : 'LOW';
  if (!factors.length) factors.push(analysis.analysisStatus === 'NOT_APPLICABLE'
    ? 'NO_SUPPORTED_FILES' : 'NO_ESCALATION');
  return { level, factors, ruleVersion: config.ruleVersion };
};
