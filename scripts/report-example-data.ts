import { decideGate } from '../src/review/gate.js';
import { createPublisher } from '../src/review/publication.js';
import type { PublicationPort } from '../src/review/publication.js';
import { calculateRisk } from '../src/review/risk.js';
import { renderSprintPublicationFailure, renderSprintReport, sprintConfig } from '../src/review/sprint2.js';
import type { ReviewInput, ReviewResult } from '../src/review/contracts.js';

const head = 'a'.repeat(40);
type AnalysisExample = Omit<ReviewResult, 'risk' | 'gate'>;

export interface ReportExample {
  slug: 'normal' | 'partial' | 'failed' | 'publication-failure';
  title: string;
  description: string;
  report: string;
}

export interface ReportExampleSet {
  examples: ReportExample[];
  publicationStatusWrites: string[];
}

function withDecision(analysis: AnalysisExample): ReviewResult {
  const { runId, repo, prNumber, headSha, mode, scope } = analysis;
  const input: ReviewInput = {
    schemaVersion: '1', runId, repo, sourceRepo: repo, prNumber, author: 'author', trigger: 'manual',
    baseSha: 'b'.repeat(40), diffBaseSha: 'b'.repeat(40), headSha, mode, diff: '',
    changedFiles: [
      ...scope.supportedFiles.map(path => ({ path, supported: true })),
      ...scope.excludedFiles.map(path => ({ path, supported: false })),
    ].map(file => ({ ...file, status: 'modified', additions: 1, deletions: 0, patch: null })),
  };
  const risk = calculateRisk(input, analysis, sprintConfig);
  const gate = decideGate(analysis, risk, {
    reviewedHeadSha: headSha, currentHeadSha: headSha, prAuthor: input.author, reviews: [], configValid: true,
  }, sprintConfig);
  return { ...analysis, risk, gate };
}

const base: AnalysisExample = {
  schemaVersion: '1', provider: 'live', runId: '45000000000-1', repo: { owner: 'inspector', name: 'demo' },
  prNumber: 42, headSha: head, mode: 'context', analysisStatus: 'COMPLETE',
  scope: { supportedFiles: ['src/duration.js'], analyzedFiles: ['src/duration.js'], excludedFiles: ['README.md'] },
  findings: [{ id: 'src/duration.js:1', file: 'src/duration.js', side: 'RIGHT', line: 4, severity: 'low',
    message: 'Document the accepted numeric range.', evidenceIds: ['duration-definition'], validation: 'VERIFIED' }],
  omissions: [],
  snippets: [{ id: 'duration-definition', file: 'src/units.js', ref: head, startLine: 1, endLine: 3,
    code: 'export const seconds = minutes => minutes * 60;', reason: 'direct-definition' }],
  metrics: { model: 'example-model', effectiveParameters: { temperature: 0, max_tokens: 800 },
    promptVersion: 'example-v1', durationMs: 1820, calls: 1, inputTokens: 620, outputTokens: 75,
    tokenizerId: 'example-tokenizer' },
};

function analysisFixtures(): { normal: ReviewResult; partial: ReviewResult; failed: ReviewResult } {
  const partial = structuredClone(base);
  partial.analysisStatus = 'PARTIAL';
  partial.scope = { supportedFiles: ['src/duration.js', 'src/cache.js'], analyzedFiles: ['src/duration.js'], excludedFiles: [] };
  partial.findings[0].line = null;
  partial.findings[0].validation = 'UNLOCATED';
  partial.omissions = [{ file: 'src/cache.js', stage: 'model', reason: 'TIMEOUT', required: true }];
  partial.metrics = { ...base.metrics, durationMs: 30120, calls: 2, inputTokens: 910, outputTokens: null };

  const failed = structuredClone(base);
  failed.analysisStatus = 'FAILED';
  failed.scope = { supportedFiles: ['src/duration.js'], analyzedFiles: [], excludedFiles: [] };
  failed.findings = [];
  failed.snippets = [];
  failed.omissions = [{ file: 'src/duration.js', stage: 'model', reason: 'INVALID_OUTPUT', required: true }];
  failed.metrics = { ...base.metrics, durationMs: 2100, calls: 2, inputTokens: 640, outputTokens: null };
  return { normal: withDecision(structuredClone(base)), partial: withDecision(partial), failed: withDecision(failed) };
}

/** Build all examples through production decisions/rendering and the real guarded publisher. */
export async function createReportExamples(): Promise<ReportExampleSet> {
  const { normal, partial, failed } = analysisFixtures();
  const publicationStatusWrites: string[] = [];
  const port: PublicationPort = {
    readCurrentHead: async () => head,
    createComment: async () => { throw new Error('Simulated GitHub comment rejection'); },
    createCommitStatus: async (_repo, _sha, status) => { publicationStatusWrites.push(status.state); },
  };
  const failedReport = renderSprintReport(failed, sprintConfig.maxReportCharacters, false);
  const publication = await createPublisher(port)(failed, failedReport);
  if (publication.status !== 'FAILED' || publication.error !== 'Failed to create review report') {
    throw new Error('The publication-failure example did not follow the expected publisher path');
  }
  return {
    publicationStatusWrites,
    examples: [
      { slug: 'normal', title: 'Normal / complete',
        description: 'A complete LOW-risk analysis with one located finding and immutable evidence.',
        report: renderSprintReport(normal, sprintConfig.maxReportCharacters, false) },
      { slug: 'partial', title: 'Partial completion',
        description: 'One supported file timed out, the finding has no line number, and output usage is unknown.',
        report: renderSprintReport(partial, sprintConfig.maxReportCharacters, false) },
      { slug: 'failed', title: 'Failed analysis',
        description: 'Invalid model output left no usable analysis; an empty finding list is explicitly not a clean result.',
        report: failedReport },
      { slug: 'publication-failure', title: 'Publication failure fallback',
        description: 'The real guarded publisher attempted the status write, then received a simulated comment rejection. The fallback uses that actual FAILED receipt.',
        report: renderSprintPublicationFailure(failed, publication) },
    ],
  };
}
