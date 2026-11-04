/** C 模块的临时边界类型：字段对齐 PR #5 候选契约，由 A 冻结后改为共享 import。
 * 这里只声明本模块所需字段；不复制风险、权限或发布接口，也不代表团队已采纳 #5。
 */
export type Mode = 'diff-only' | 'context';
export type Side = 'LEFT' | 'RIGHT';
export type Severity = 'low' | 'medium' | 'high';

/** A 固定版本后传入；supported 仍由 C 复核首版支持范围。 */
export interface ModelInput {
  headSha: string;
  diffBaseSha: string;
  mode: Mode;
  changedFiles: Array<{ path: string; status: string; patch: string | null; supported: boolean }>;
}

/** B 提供真实代码和版本；C 只能核查元数据，无法证明代码确实来自 GitHub。 */
export interface ContextSnippet {
  id: string;
  file: string;
  ref: string;
  startLine: number;
  endLine: number;
  code: string;
  reason: string;
}

/** 模型输出先经过运行时校验才成为 Finding。VERIFIED 不等于缺陷已被证实。 */
export interface Finding {
  id: string;
  file: string;
  side: Side;
  line: number | null;
  severity: Severity;
  message: string;
  evidenceIds: string[];
  validation: 'VERIFIED' | 'UNLOCATED' | 'UNVERIFIED';
}

/** 与候选 Omission 的模型阶段兼容；required=true 必须影响最终覆盖状态。 */
export interface Omission {
  file: string | null;
  stage: 'model';
  reason: 'MISSING_PATCH' | 'FILE_BUDGET' | 'TOKEN_BUDGET' | 'CALL_BUDGET'
    | 'INVALID_OUTPUT' | 'INVALID_EVIDENCE' | 'UNLOCATED_FINDING'
    | 'UNVERIFIED_FINDING' | 'TIMEOUT' | 'RATE_LIMIT' | 'SERVICE_ERROR';
  required: boolean;
}

/** 数值是演示候选值，不是实测最优参数；一次 reviewFiles 共享这些额度。 */
export interface ModelBudget {
  maxFiles: number;
  maxCalls: number;
  maxRetries: number;
  requestTimeoutMs: number;
  analysisTimeoutMs: number;
  publishReserveMs: number;
  maxInputTokens: number;
  reservedOutputTokens: number;
}

export interface ModelAnalysis {
  findings: Finding[];
  omissions: Omission[];
  analyzedFiles: string[];
  metrics: {
    model: string;
    effectiveParameters: Record<string, unknown>;
    promptVersion: string;
    durationMs: number;
    calls: number;
    inputTokens: number | null;
    outputTokens: number | null;
  };
}
