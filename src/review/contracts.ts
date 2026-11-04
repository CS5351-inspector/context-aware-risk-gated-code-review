/**
 * Sprint 1 shared domain model v1; integrated from PR #5. Type declarations only: no network,
 * no runtime validator and no production bot integration.
 * JSON/network input is unknown until the owning module validates it.
 */
export type Mode = 'diff-only' | 'context';
export type AnalysisStatus = 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'NOT_APPLICABLE';
export type Severity = 'low' | 'medium' | 'high';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
export type GateState = 'PASS' | 'WAITING' | 'ERROR' | 'STALE';
export type Side = 'LEFT' | 'RIGHT';
export type ActorType = 'User' | 'Bot';
export type Permission = 'read' | 'triage' | 'write' | 'maintain' | 'admin';
export type Trigger =
  | 'pull_request.opened' | 'pull_request.reopened' | 'pull_request.synchronize'
  | 'pull_request_review.submitted' | 'pull_request_review.edited'
  | 'pull_request_review.dismissed' | 'manual';

export interface Repo { owner: string; name: string }
export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'other';
  previousPath?: string;
  additions: number;
  deletions: number;
  patch: string | null;
  supported: boolean;
  exclusionReason?: string;
}
export interface ReviewInput {
  schemaVersion: '1';
  runId: string;
  repo: Repo;
  sourceRepo: Repo;
  prNumber: number;
  author: string;
  trigger: Trigger;
  baseSha: string;
  diffBaseSha: string;
  headSha: string;
  mode: Mode;
  diff: string;
  changedFiles: ChangedFile[];
}
export interface ContextSnippet {
  id: string;
  file: string;
  ref: string;
  startLine: number;
  endLine: number;
  code: string;
  reason: 'local-window' | 'direct-definition';
}
export type OmissionReason =
  | 'MISSING_PATCH' | 'FILE_READ_FAILED' | 'OPTIONAL_CONTEXT_UNAVAILABLE'
  | 'CONTEXT_BUDGET' | 'FILE_BUDGET' | 'TOKEN_BUDGET' | 'CALL_BUDGET'
  | 'EMPTY_RESPONSE' | 'INVALID_JSON' | 'INVALID_OUTPUT' | 'INVALID_EVIDENCE'
  | 'UNLOCATED_FINDING' | 'UNVERIFIED_FINDING'
  | 'TIMEOUT' | 'RATE_LIMIT' | 'SERVICE_ERROR';
export interface Omission {
  file: string | null;
  stage: 'input' | 'context' | 'model';
  reason: OmissionReason;
  required: boolean;
}
export interface Finding {
  id: string;
  file: string;
  side: Side;
  line: number | null;
  severity: Severity;
  message: string;
  evidenceIds: string[];
  /** Coordinates/references validated; never a proof that the alleged bug is real. */
  validation: 'VERIFIED' | 'UNLOCATED' | 'UNVERIFIED';
}
export interface Budget {
  maxFiles: number;
  localWindowLines: number;
  maxDefinitionsPerFile: number;
  maxDefinitionLines: number;
  maxInputTokens: number;
  reservedOutputTokens: number;
  maxCalls: number;
  requestTimeoutMs: number;
  analysisTimeoutMs: number;
  publishReserveMs: number;
  maxRetries: number;
}
export interface ReviewConfig {
  ruleVersion: string;
  requiredApprovals: number;
  mediumChangedLines: number;
  mediumChangedFiles: number;
  sensitivePaths: string[];
  maxReportCharacters: number;
  budget: Budget;
}
export interface RiskResult {
  level: RiskLevel;
  factors: string[];
  ruleVersion: string;
}
/** Ordered review history, not merely the most recent comment per user. */
export interface ApprovalReview {
  id: number;
  login: string;
  actorType: ActorType;
  permission: Permission;
  commitSha: string;
  state: 'APPROVED' | 'COMMENTED' | 'CHANGES_REQUESTED' | 'DISMISSED';
  submittedAt: string;
}
export interface GateContext {
  /** Snapshot this decision concerns; never infer it from currentHeadSha. */
  reviewedHeadSha: string;
  /** Needed to reject approvals from the PR author. */
  prAuthor: string;
  currentHeadSha: string;
  reviews: ApprovalReview[];
  configValid: boolean;
}
export interface GateResult {
  state: GateState;
  reasons: string[];
  requiredApprovals: number;
  validApprovers: string[];
}
export interface RunMetrics {
  model: string;
  effectiveParameters: Record<string, unknown>;
  promptVersion: string;
  durationMs: number;
  calls: number;
  /** Unknown provider usage must be null, not invented zero usage. */
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface ContextResult { snippets: ContextSnippet[]; omissions: Omission[] }
export interface ModelAnalysis {
  findings: Finding[];
  omissions: Omission[];
  analyzedFiles: string[];
  metrics: RunMetrics;
}
export interface AnalysisResult extends Omit<ModelAnalysis, 'analyzedFiles'> {
  analysisStatus: AnalysisStatus;
  scope: { supportedFiles: string[]; analyzedFiles: string[]; excludedFiles: string[] };
  snippets: ContextSnippet[];
}
export interface ReviewResult extends AnalysisResult {
  schemaVersion: '1';
  runId: string;
  repo: Repo;
  prNumber: number;
  headSha: string;
  mode: Mode;
  provider: 'mock' | 'live';
  risk: RiskResult;
  gate: GateResult;
}
/** A gate decision is separate from whether GitHub accepted its publication. */
export interface PublicationReceipt {
  status: 'PUBLISHED' | 'STALE' | 'FAILED';
  commentId: number | null;
  commitStatus: 'success' | 'pending' | 'failure' | null;
  error: string | null;
}

// Module ports. See SPRINT1_HANDOFF.md for implemented adapters and remaining work.
export type CollectInput = (event: unknown) => Promise<ReviewInput>;
export type ReadFileAtRef = (file: string, ref: string) => Promise<string>;
export type CollectContext = (
  input: ReviewInput, readFile: ReadFileAtRef, budget: Budget
) => Promise<ContextResult>;
export type ReviewFiles = (
  input: ReviewInput, snippets: ContextSnippet[], budget: Budget
) => Promise<ModelAnalysis>;
export type DeriveAnalysisStatus = (
  input: ReviewInput, context: ContextResult, model: ModelAnalysis
) => AnalysisStatus;
export type CalculateRisk = (
  input: ReviewInput, analysis: AnalysisResult, config: ReviewConfig
) => RiskResult;
export type DecideGate = (
  analysis: AnalysisResult, risk: RiskResult, context: GateContext, config: ReviewConfig
) => GateResult;
export type RenderReport = (result: ReviewResult) => string;
export type PublishResult = (result: ReviewResult, report: string) => Promise<PublicationReceipt>;
