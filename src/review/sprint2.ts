import type { PublicationReceipt, ReviewConfig, ReviewResult } from './contracts.js';

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

function listed(values: string[]): string {
  return values.length ? values.map(plain).join(', ') : 'none recorded';
}

function nextAction(result: ReviewResult): string {
  const { gate } = result;
  if (gate.state === 'PASS') {
    return gate.reasons.includes('HUMAN_APPROVED')
      ? 'Human takeover recorded. Check the commit status before merging.'
      : 'Check the required status before merging.';
  }
  if (gate.state === 'WAITING') {
    return 'Resolve the decision reasons and have an eligible non-author Write+ reviewer approve this commit.';
  }
  if (gate.state === 'STALE') {
    return 'Do not use this report for a newer commit. Start a new review for the current head.';
  }
  return 'Inspect the Actions run, correct the error and rerun. Incomplete analysis is not a safe pass.';
}

function shortNextAction(result: ReviewResult): string {
  if (result.gate.state === 'PASS') return 'Check required status before merging.';
  if (result.gate.state === 'WAITING') return 'Resolve the decision reasons and review this commit.';
  if (result.gate.state === 'STALE') return 'Review the current head; this result is stale.';
  return 'Inspect the Actions error and rerun; this is not a safe pass.';
}

function stopExplanation(result: ReviewResult): string {
  const required = [...new Set(result.omissions.filter(o => o.required).map(o => o.reason))];
  const optional = [...new Set(result.omissions.filter(o => !o.required).map(o => o.reason))];
  if (required.length) {
    return `Required work was not completed: ${required.join(', ')}. Missing analysis must not be interpreted as safe.`;
  }
  if (result.analysisStatus === 'NOT_APPLICABLE') {
    return 'No supported JavaScript or TypeScript file was available for model analysis.';
  }
  if (result.analysisStatus === 'FAILED') {
    return 'No supported file completed a usable model analysis; inspect the recorded failure.';
  }
  if (result.analysisStatus === 'PARTIAL') {
    return 'Only part of the supported scope was analyzed; compare the checked and skipped file lists.';
  }
  if (optional.length) {
    return `Supported-file analysis finished; optional work was omitted: ${optional.join(', ')}.`;
  }
  return 'The declared supported-file analysis finished; no stopping condition was recorded.';
}

function findingCounts(result: ReviewResult): string {
  const high = result.findings.filter(f => f.severity === 'high').length;
  const medium = result.findings.filter(f => f.severity === 'medium').length;
  const low = result.findings.filter(f => f.severity === 'low').length;
  const required = result.omissions.filter(o => o.required).length;
  return `Findings: ${result.findings.length} (${high} high/${medium} medium/${low} low) · Required omissions: ${required}.`;
}

const SHORT_NOTICE = '_Report shortened; see Actions receipt._';

/** Keep identity and the next action ahead of optional detail when a comment reaches its limit. */
function shortenReport(compactLines: string[], limit: number): string {
  const suffix = `\n\n${SHORT_NOTICE}`;
  const kept: string[] = [];
  for (const line of compactLines) {
    const candidate = [...kept, line].join('\n');
    if (candidate.length + suffix.length <= limit) kept.push(line);
  }
  if (kept.length) return `${kept.join('\n')}${suffix}`;

  const minimalNotice = 'Report shortened.';
  if (limit <= minimalNotice.length) return minimalNotice.slice(0, limit);
  const room = limit - minimalNotice.length - 1;
  return `${compactLines[0].slice(0, Math.max(0, room))}\n${minimalNotice}`;
}

export function renderSprintReport(result: ReviewResult, limit: number, cached: boolean): string {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Report limit must be a positive integer');
  const { scope, metrics, gate, risk } = result;
  const analyzed = new Set(scope.analyzedFiles);
  const notAnalyzed = scope.supportedFiles.filter(file => !analyzed.has(file));
  const next = nextAction(result);
  const stopped = stopExplanation(result);
  const lines = [
    '## Inspector code review',
    `**${risk.level} risk · ${gate.state} · ${result.analysisStatus}**`,
    `Reviewed SHA: \`${plain(result.headSha)}\` · Mode: ${result.mode} · Provider: ${result.provider}`,
    `Run: \`${plain(result.runId)}\` · Rule: ${plain(risk.ruleVersion)}`,
    `Decision: ${listed(gate.reasons)}.`,
    `Next action: ${next}`,
    `Risk factors: ${listed(risk.factors)}.`,
    `Coverage: ${scope.analyzedFiles.length}/${scope.supportedFiles.length} supported files analyzed; ${scope.excludedFiles.length} excluded.`,
    '', '### What was checked',
    ...scope.analyzedFiles.map(file => `- Analyzed: ${plain(file)}`),
    ...(!scope.analyzedFiles.length ? ['- No files completed model analysis.'] : []),
    '', '### What was skipped and why',
    ...notAnalyzed.map(file => `- Not analyzed: ${plain(file)} — no successful model analysis was recorded.`),
    ...scope.excludedFiles.map(file => `- Excluded from model analysis: ${plain(file)} — outside the supported review scope.`),
    ...result.omissions.map(o => `- ${o.required ? 'Required' : 'Optional'} omission: ${plain(o.file ?? 'whole PR')} — ${o.stage} / ${o.reason}.`),
    ...(!notAnalyzed.length && !scope.excludedFiles.length && !result.omissions.length ? ['- No skipped files or omissions were recorded.'] : []),
    '', '### Why the run stopped',
    stopped,
    '', '### Findings',
    ...(!result.findings.length ? [result.analysisStatus === 'COMPLETE'
      ? 'No findings were returned for the analyzed scope.'
      : `No findings were returned, but analysis is ${result.analysisStatus}; this is not a clean result.`] : []),
    ...result.findings.map(f => `- **${f.severity.toUpperCase()}** ${plain(f.file)} (${f.side}, ${f.line ?? 'line unavailable'}): ${plain(f.message)} [${f.validation}; evidence: ${listed(f.evidenceIds)}]`),
    'Validation confirms coordinates and references only; it does not prove that a finding is correct.',
    '', '### Evidence',
    ...result.snippets.map(s => `- ${plain(s.id)}: ${plain(s.file)}, lines ${s.startLine}–${s.endLine}; ref \`${plain(s.ref)}\`; ${s.reason}.`),
    ...(!result.snippets.length ? ['- No retrieved context snippets were recorded; diff evidence is identified by file and line above.'] : []),
    '', '### Analysis resources',
    `Model: ${plain(metrics.model)} · Duration: ${metrics.durationMs} ms · Calls including retries: ${metrics.calls}.`,
    `Input/output tokens: ${metrics.inputTokens ?? 'unknown'}/${metrics.outputTokens ?? 'unknown'} · Tokenizer: ${plain(metrics.tokenizerId ?? 'unknown')}.`,
    `Effective parameters: ${plain(JSON.stringify(metrics.effectiveParameters))}`,
    cached
      ? 'Reused the analysis for this exact change. These resource values belong to the cached analysis; this run made no new model calls.'
      : 'These values describe this analysis only; runner queue and dependency-installation time are recorded separately.',
  ];
  const report = lines.join('\n');
  if (report.length <= limit) return report;
  const compact = [
    `**${risk.level} risk · ${gate.state} · ${result.analysisStatus}**`,
    `SHA: \`${plain(result.headSha)}\``,
    `Next: ${shortNextAction(result)}`,
    `Coverage: ${scope.analyzedFiles.length}/${scope.supportedFiles.length} supported files analyzed; ${scope.excludedFiles.length} excluded.`,
    `Stopped: ${stopped}`,
    findingCounts(result),
  ];
  return shortenReport(compact, limit);
}

/** A fallback for the Actions summary/receipt when GitHub did not accept the normal report. */
export function renderSprintPublicationFailure(result: ReviewResult, receipt: PublicationReceipt): string {
  return [
    '## Inspector report publication failed',
    `**${result.risk.level} risk · ${result.gate.state} · ${result.analysisStatus}**`,
    `Reviewed SHA: \`${plain(result.headSha)}\` · Run: \`${plain(result.runId)}\``,
    `Publication: ${receipt.status} · Last confirmed commit status: ${receipt.commitStatus ?? 'not confirmed'} · Comment: ${receipt.commentId ?? 'not confirmed'}.`,
    `Publication error: ${plain(receipt.error ?? 'unspecified publication error')}.`,
    'Next action: inspect the Actions receipt, correct GitHub permissions or API configuration, and rerun for the current head. Do not treat an unconfirmed status as a successful gate.',
    'This fallback records delivery failure only; it does not change the analysis or gate decision.',
  ].join('\n');
}
