'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { read, write, hash } = require('../lib/data.cjs');
const { createPlan } = require('../lib/plan.cjs');
const { runPlan } = require('../lib/runner.cjs');
const { score, template } = require('../lib/score.cjs');
const root = path.resolve(__dirname, '..'), repo = path.dirname(root);

function fixture(fn, trials = 1) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspector-score-check-'));
  try {
    const config = { ...read(path.join(root, 'config/offline.json')), case_ids: ['DEV-001', 'DEV-002'], trials };
    const out = path.join(dir, 'run');
    runPlan(root, createPlan(root, config, repo), out, path.join(root, 'adapters/scripted.cjs'), path.join(root, '.cache/production.cjs'));
    fn(out);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function inject(out, key, ids) {
  const runs = read(path.join(out, 'runs.json')), run = runs.records.find(r => r.run_key === key);
  const raw = read(path.join(out, run.raw_file));
  run.findings = raw.findings = ids.map(id => ({ id, file: 'review.js', side: 'RIGHT', line: 2,
    severity: 'high', message: 'Synthetic scoring test claim.', evidenceIds: [], validation: 'VERIFIED' }));
  write(path.join(out, run.raw_file), raw);
  run.raw_sha256 = hash(fs.readFileSync(path.join(out, run.raw_file)));
  write(path.join(out, 'runs.json'), runs);
}
function labels(out, verdict = 'gold', gold = 'grant-enum-001') {
  const value = template(root, out);
  value.reviewer = 'synthetic-scoring-test'; value.reviewed_at = '2026-11-08T00:00:00Z';
  value.judgments = value.judgments.map(j => ({ ...j, verdict, gold_issue_id: gold,
    evidence: 'Synthetic test expectation, not human sign-off.', location_acceptable: true, severity_acceptable: true }));
  return value;
}

test('novel defect invalidates clean eligibility symmetrically across conditions and trials', () => fixture(out => {
  inject(out, 'DEV-002/B1/1', ['novel']);
  const result = score(root, out, labels(out, 'novel', null));
  assert.deepEqual(result.clean_reclassification_cases, ['DEV-002']);
  for (const condition of ['B1', 'B2-oracle']) {
    assert.equal(result.conditions[condition].clean_success, null);
    assert.equal(result.conditions[condition].clean_eligible_runs, 0);
    assert.equal(result.conditions[condition].clean_reclassification_needed, 2);
  }
  assert(result.rows.filter(r => r.case_id === 'DEV-002').every(r => r.clean_success === null));
}, 2));

test('location and severity assessments do not depend on duplicate annotation order', () => fixture(out => {
  inject(out, 'DEV-001/B1/1', ['first', 'second']);
  const value = labels(out);
  value.judgments[1].location_acceptable = false;
  value.judgments[1].severity_acceptable = false;
  const forward = score(root, out, value).conditions.B1;
  value.judgments.reverse();
  const reverse = score(root, out, value).conditions.B1;
  assert.equal(forward.hits, 1); assert.equal(forward.duplicate_atoms, 1);
  assert.equal(forward.location_accuracy, .5); assert.equal(reverse.location_accuracy, .5);
  assert.equal(forward.severity_agreement, .5); assert.equal(reverse.severity_agreement, .5);
  assert.equal(forward.location_assessed_atoms, 2); assert.equal(forward.severity_assessed_atoms, 2);
}));

test('missing planned records are distinguished from explicit not-executed records', () => fixture(out => {
  const runs = read(path.join(out, 'runs.json'));
  runs.records = runs.records.filter(r => r.run_key !== 'DEV-001/B2-oracle/1');
  write(path.join(out, 'runs.json'), runs);
  const result = score(root, out, template(root, out));
  assert.equal(result.paired_plan_complete, false);
  assert.equal(result.conditions.B1.planned, 2);
  assert.equal(result.conditions.B1.missing, 0);
  assert.equal(result.conditions['B2-oracle'].missing, 1);
  assert.equal(result.conditions['B2-oracle'].not_executed, 0);
}));

test('atomic judgment IDs must be nonblank strings as declared by the schema', () => fixture(out => {
  inject(out, 'DEV-001/B1/1', ['claim']);
  const value = labels(out);
  value.judgments[0].atom_id = 1;
  assert.throws(() => score(root, out, value), /atom/i);
  value.judgments[0].atom_id = '1'; value.judgments[0].root_id = '   ';
  assert.throws(() => score(root, out, value), /root/i);
}));
