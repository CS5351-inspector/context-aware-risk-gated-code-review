const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const parser = require('../report-parser.js');

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'report-data.js'), 'utf8'), context);
const reports = context.window.INSPECTOR_REPORTS.map(parser.parse);

test('synchronized data exposes all four scenarios with immutable identity and raw Markdown', () => {
  assert.deepEqual(Array.from(reports, report => report.slug), ['normal', 'partial', 'failed', 'publication-failure']);
  for (const report of reports) {
    assert.match(report.sha, /^a{40}$/);
    assert.equal(report.runId, '45000000000-1');
    assert(report.report.length > 100);
    assert(report.next.length > 10);
  }
});

test('normal and partial views preserve coverage, evidence, findings, and resource values', () => {
  const [normal, partial] = reports;
  assert.deepEqual(normal.coverage, { analyzed: 1, supported: 1, excluded: 1 });
  assert.equal(normal.outcome.risk, 'LOW');
  assert.equal(normal.outcome.gate, 'PASS');
  assert.equal(normal.evidence.length, 1);
  assert.match(normal.evidence[0], /duration-definition/);
  assert.equal(normal.resources.durationMs, 1820);
  assert.equal(normal.resources.tokens, '620/75');
  assert.deepEqual(partial.coverage, { analyzed: 1, supported: 2, excluded: 0 });
  assert.match(partial.findings[0], /line unavailable/);
  assert.match(partial.skipped.join('\n'), /TIMEOUT/);
  assert.equal(partial.resources.tokens, '910/unknown');
});

test('preserves periods in versioned tokenizer identifiers', () => {
  const normal = reports[0];
  const tokenizer = 'js-tiktoken@1.0.21/o200k_base';
  const report = normal.report.replace('Tokenizer: example-tokenizer.', `Tokenizer: ${tokenizer}.`);
  assert.equal(parser.parse({ ...normal, report }).resources.tokenizer, tokenizer);
  assert.equal(normal.resources.tokenizer, 'example-tokenizer');
});

test('failed analysis remains visibly incomplete rather than a clean result', () => {
  const failed = reports.find(report => report.slug === 'failed');
  assert.equal(failed.outcome.analysis, 'FAILED');
  assert.equal(failed.coverage.analyzed, 0);
  assert.match(failed.findingNote, /not a clean result/);
  assert.match(failed.stopped, /INVALID_OUTPUT/);
});

test('publication fallback shows only the actual failed delivery receipt', () => {
  const fallback = reports.find(report => report.slug === 'publication-failure');
  assert.deepEqual(fallback.publication, { status: 'FAILED', commitStatus: 'pending', comment: 'not confirmed' });
  assert.match(fallback.decision, /Failed to create review report/);
  assert.equal(fallback.coverage, null);
  assert.equal(fallback.resources, null);
});

test('static entry has responsive metadata, working local references, and handlers for every button', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
  assert.doesNotMatch(html, /href="#"/);
  assert.match(html, /href="#report-main"/);
  assert.match(html, /id="report-main"/);
  for (const [, source] of html.matchAll(/<script src="\.\/(.*?)"/g)) {
    assert.equal(path.extname(source), '.js', `${source} must have a browser script extension`);
    assert(fs.existsSync(path.join(root, source)), `Missing script: ${source}`);
  }
  for (const id of ['copy-report', 'copy-sha', 'overview-tab', 'markdown-tab']) {
    assert(html.includes(`id="${id}"`));
    if (id.endsWith('-tab')) assert(app.includes("document.querySelectorAll('[role=\"tab\"]')"));
    else assert(app.includes(`byId('${id}')`));
  }
});
