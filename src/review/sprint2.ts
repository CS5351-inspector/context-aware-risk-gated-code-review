import type { ReviewConfig, ReviewResult } from './contracts.js';

export const sprintConfig: ReviewConfig = {
  ruleVersion: 'inspector-sprint2-v1', requiredApprovals: 1,
  mediumChangedLines: 100, mediumChangedFiles: 4,
  sensitivePaths: ['.github/**', 'src/review/gate.ts', 'src/review/risk.ts', 'demo/policy/**'],
  maxReportCharacters: 12000,
  budget: {
    maxFiles: 5, maxCalls: 7, maxRetries: 1, requestTimeoutMs: 30000,
    analysisTimeoutMs: 240000, publishReserveMs: 30000,
    maxInputTokens: 8000, reservedOutputTokens: 800,
    localWindowLines: 4, maxDefinitionsPerFile: 2, maxDefinitionLines: 60,
  },
};

function plain(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/([\\`*_{}\[\]()#!|~])/g, '\\$1').replace(/@/g, '@\u200b').replace(/[\r\n]+/g, ' ');
}

export function renderSprintReport(result: ReviewResult, limit: number, cached: boolean): string {
  const { scope, metrics, gate, risk } = result;
  const next = gate.state === 'PASS' ? (gate.reasons.includes('HUMAN_APPROVED') ?
    'Human takeover recorded. Check the commit status before merging.' : 'Check the required status before merging.')
    : gate.state === 'WAITING' ? 'Resolve any change requests and have an eligible non-author review this commit.'
    : 'Inspect the Actions run, correct the error and rerun.';
  const lines = [
    '## Inspector code review',
    `**${risk.level} risk · ${gate.state} · ${result.analysisStatus}**`,
    `Reviewed SHA: \`${result.headSha}\` · Mode: ${result.mode}`,
    `Decision: ${gate.reasons.map(plain).join(', ')}. ${next}`,
    `Risk factors: ${risk.factors.map(plain).join(', ')}.`,
    `Coverage: ${scope.analyzedFiles.length}/${scope.supportedFiles.length} supported files analyzed; ${scope.excludedFiles.length} excluded.`,
    `Model: ${plain(metrics.model)} · Calls for this analysis: ${metrics.calls} · Input/output tokens: ${metrics.inputTokens ?? 'unknown'}/${metrics.outputTokens ?? 'unknown'}.`,
    cached ? 'Reused the analysis for this exact change. This run made no new model calls.' : 'This run performed the analysis.',
    '', '### Files and omissions',
    ...scope.analyzedFiles.map(f => `- Analyzed: ${plain(f)}`),
    ...scope.excludedFiles.map(f => `- Excluded: ${plain(f)}`),
    ...result.omissions.map(o => `- ${o.required ? 'Required' : 'Optional'}: ${plain(o.file ?? 'whole PR')} — ${o.stage} / ${o.reason}`),
    '', '### Findings',
    ...(!result.findings.length ? ['No findings were returned for the analyzed scope.'] : []),
    ...result.findings.map(f => `- **${f.severity.toUpperCase()}** ${plain(f.file)} (${f.side}, ${f.line ?? 'line unavailable'}): ${plain(f.message)} [${f.validation}; evidence: ${f.evidenceIds.map(plain).join(', ') || 'none'}]`),
    ...result.snippets.map(s => `- Evidence ${plain(s.id)}: ${plain(s.file)}, lines ${s.startLine}–${s.endLine} (${s.reason}).`),
  ];
  const report = lines.join('\n');
  const notice = '\n\n_Report shortened at the configured limit._';
  return report.length <= limit ? report : report.slice(0, limit - notice.length) + notice;
}
