import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createReportExamples } from './report-example-data.js';

const expectedContent: Record<string, string[]> = {
  normal: ['LOW risk · PASS · COMPLETE', 'Coverage: 1/1 supported files analyzed', '### Evidence',
    `ref \`${'a'.repeat(40)}\``, 'What was checked', 'What was skipped and why'],
  partial: ['UNKNOWN risk · WAITING · PARTIAL', 'Coverage: 1/2 supported files analyzed',
    'line unavailable', 'TIMEOUT', 'Not analyzed: src/cache.js'],
  failed: ['UNKNOWN risk · WAITING · FAILED', 'INVALID_OUTPUT', 'this is not a clean result',
    'Coverage: 0/1 supported files analyzed'],
  'publication-failure': ['Publication: FAILED', 'Last confirmed commit status: pending',
    'Failed to create review report', 'does not change the analysis or gate decision'],
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const workspace = process.cwd();
  fs.mkdirSync('.cache', { recursive: true });
  const temporary = fs.mkdtempSync(path.join(workspace, '.cache', 'report-verification-'));
  try {
    execFileSync(process.execPath, [path.join(workspace, '.cache', 'render-report-examples.cjs')], {
      cwd: workspace,
      env: { ...process.env, INSPECTOR_REPORT_EXAMPLE_DIR: temporary },
      stdio: 'pipe',
    });
    const first = await createReportExamples();
    const second = await createReportExamples();
    assert(JSON.stringify(first) === JSON.stringify(second), 'Repeated example generation is not identical');
    assert(first.publicationStatusWrites.join(',') === 'pending',
      `Unexpected status writes: ${first.publicationStatusWrites.join(',')}`);
    assert(first.examples.length === 4, 'Exactly four report examples are required');

    const receipt = {
      schemaVersion: '1',
      verifiedAt: new Date().toISOString(),
      node: process.version,
      platform: process.platform,
      modelCalls: 0,
      githubRequests: 0,
      simulatedPublicationRejections: 1,
      publicationStatusWrites: first.publicationStatusWrites,
      checks: ['four-standalone-files', 'combined-document', 'byte-identical-regeneration',
        'risk-and-gate-content', 'evidence-and-coverage-content', 'real-publisher-failure-receipt'],
      reports: [] as Array<{ file: string; sha256: string; characters: number }>,
    };
    for (const example of first.examples) {
      const relative = path.join('report-examples', `${example.slug}.md`);
      const generated = fs.readFileSync(path.join(temporary, relative), 'utf8');
      const committed = fs.readFileSync(path.join(workspace, 'docs', relative), 'utf8');
      assert(generated === example.report + '\n', `${example.slug}: generator output differs from direct rendering`);
      assert(committed === generated, `${example.slug}: committed standalone report is stale`);
      for (const text of expectedContent[example.slug]) {
        assert(generated.includes(text), `${example.slug}: missing required content: ${text}`);
      }
      receipt.reports.push({ file: `docs/${relative.replace(/\\/g, '/')}`,
        sha256: createHash('sha256').update(generated).digest('hex'), characters: generated.length });
    }
    const indexName = 'SPRINT2_REPORT_EXAMPLES.md';
    const generatedIndex = fs.readFileSync(path.join(temporary, indexName), 'utf8');
    const committedIndex = fs.readFileSync(path.join(workspace, 'docs', indexName), 'utf8');
    assert(committedIndex === generatedIndex, 'The combined report-example document is stale');
    const uiDataName = path.join('report-ui', 'report-data.js');
    const generatedUiData = fs.readFileSync(path.join(temporary, uiDataName), 'utf8');
    const committedUiData = fs.readFileSync(path.join(workspace, 'docs', uiDataName), 'utf8');
    assert(committedUiData === generatedUiData, 'The report UI data is stale');
    receipt.checks.push('synchronized-ui-data');
    fs.writeFileSync(path.join(workspace, '.cache', 'report-verification.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Report verification failed');
  process.exitCode = 1;
});
