'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validate } = require('../validate.cjs');
const { exportInput } = require('../export-input.cjs');
const root = path.resolve(__dirname, '..');

function mutate(edit) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs5351-dataset-negative-'));
  try {
    const copy = path.join(temp, 'evaluation');
    fs.cpSync(root, copy, { recursive: true });
    edit(copy);
    assert.throws(() => validate(copy));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
}

function changeJson(root, relative, fn) {
  const file = path.join(root, relative);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  fn(data);
  fs.writeFileSync(file, JSON.stringify(data));
}

test('six families have real bug/fixed evidence and clean controls', () => {
  const result = validate();
  assert.equal(result.families, 6);
  assert.equal(result.snapshots, 10);
  assert.equal(result.gold_defects, 4);
  assert.equal(result.behavior_checks, 50);
  assert.equal(result.observed_contract_violations, 8);
  assert.equal(result.model_calls, 0);
});

test('rejects source tampering', () => mutate((r) => {
  fs.appendFileSync(path.join(r, 'families/grant-enum/faulty/review.js'), '\n// altered\n');
}));

test('rejects a diff contradicting the head snapshot', () => mutate((r) => {
  const p = path.join(r, 'cases/DEV-001.diff');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('Boolean(lookup(account))', 'false'));
}));

test('rejects a missing defect answer', () => mutate((r) => {
  changeJson(r, 'gold/DEV-001.json', (gold) => { gold.issues = []; });
}));

test('rejects a purported counterexample that also fails on the correct base', () => mutate((r) => {
  changeJson(r, 'families/zero-limit/family.json', (f) => { f.behavior_checks[0].expected = 20; });
}));

test('rejects family variants crossing into holdout', () => mutate((r) => {
  changeJson(r, 'cases/DEV-002.json', (c) => { c.split = 'heldout'; });
}));

test('exports only allowed model input and labels full context as oracle', () => {
  const b1 = exportInput('DEV-001', 'B1');
  const oracle = exportInput('DEV-001', 'B2-oracle');
  assert.deepEqual(b1.context, []);
  assert.equal(oracle.context.length, 2);
  assert.deepEqual(Object.keys(oracle).sort(), ['case_id', 'context', 'diff', 'requirement', 'review_condition']);
  assert(!JSON.stringify(oracle).includes('gold_issue_id'));
  assert(!JSON.stringify(oracle).includes('proof_check_indices'));
  assert.throws(() => exportInput('DEV-001', 'B2'), /not implemented/);
});
