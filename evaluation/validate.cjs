#!/usr/bin/env node
'use strict';

// Dataset integrity and executable counterexamples only; no model calls.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function exactKeys(value, keys) {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Unexpected or missing case-format field');
}

function inside(root, relative) {
  assert.equal(typeof relative, 'string', 'Path must be a string');
  const resolved = path.resolve(root, relative);
  assert(resolved.startsWith(path.resolve(root) + path.sep), 'Path escapes dataset');
  return resolved;
}

function verifyDiff(base, head, diff) {
  const oldLines = base.trimEnd().split('\n');
  const target = head.trimEnd().split('\n');
  const lines = diff.trimEnd().split('\n');
  assert.equal(lines.shift(), '--- a/review.js');
  assert.equal(lines.shift(), '+++ b/review.js');
  let oldCursor = 0;
  const actual = [];
  while (lines.length) {
    const header = lines.shift().match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/);
    assert(header, 'Invalid diff hunk');
    const oldStart = Number(header[1]) - 1;
    assert(oldStart >= oldCursor);
    actual.push(...oldLines.slice(oldCursor, oldStart));
    oldCursor = oldStart;
    assert.equal(actual.length, Number(header[3]) - 1, 'New hunk offset mismatch');
    let removed = 0;
    let added = 0;
    while (lines.length && !lines[0].startsWith('@@')) {
      const line = lines.shift();
      assert([' ', '+', '-'].includes(line[0]), 'Invalid diff line');
      if (line[0] !== '+') {
        assert.equal(oldLines[oldCursor++], line.slice(1), 'Diff contradicts base');
        removed++;
      }
      if (line[0] !== '-') {
        actual.push(line.slice(1));
        added++;
      }
    }
    assert.equal(removed, Number(header[2] ?? 1));
    assert.equal(added, Number(header[4] ?? 1));
  }
  actual.push(...oldLines.slice(oldCursor));
  assert.deepEqual(actual, target, 'Diff does not produce head');
}

function runSnapshot(root, family, version) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cs5351-eval-proof-'));
  try {
    fs.writeFileSync(path.join(temp, 'package.json'), '{"type":"commonjs"}');
    for (const file of Object.keys(family.file_hashes[version])) {
      const dest = inside(temp, file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(inside(root, `families/${family.family_id}/${version}/${file}`), dest);
    }
    // Loading errors are dataset errors, never accepted as a bug counterexample.
    const module = require(inside(temp, family.entry_file));
    assert.equal(typeof module[family.entry_function], 'function');
    return family.behavior_checks.map((check, checkIndex) => {
      assert(Array.isArray(check.args));
      assert(Object.hasOwn(check, 'expected'));
      try {
        const actual = module[family.entry_function](...structuredClone(check.args));
        assert(!(actual && typeof actual.then === 'function'), 'Async examples require an async runner');
        return { check_index: checkIndex, matches_contract: isDeepStrictEqual(actual, check.expected), actual };
      } catch (error) {
        return { check_index: checkIndex, matches_contract: false, error_name: error.name, error_message: error.message };
      }
    });
  } finally {
    for (const key of Object.keys(require.cache)) {
      if (key.startsWith(temp + path.sep)) delete require.cache[key];
    }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function validate(root = __dirname) {
  const manifest = readJson(path.join(root, 'manifest.json'));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.split, 'development');
  assert.equal(manifest.label_status, 'provisional');
  assert.equal(manifest.cases.length, 10, 'v0.1 has exactly 10 snapshots');
  const seen = new Set();
  const families = new Map();
  const issueIds = new Set();
  const outputs = [];
  for (const item of manifest.cases) {
    assert(!seen.has(item.case_id), 'Duplicate case ID');
    seen.add(item.case_id);
    const c = readJson(inside(root, item.file));
    exactKeys(c, ['case_id', 'family_id', 'split', 'code_variant', 'evaluation_layer', 'semantic_gold_eligible', 'label_status', 'input', 'gold_file']);
    exactKeys(c.input, ['base_dir', 'head_dir', 'changed_files', 'diff_file']);
    assert.match(c.case_id, /^DEV-[0-9]{3}$/);
    assert.equal(typeof c.family_id, 'string');
    assert(c.family_id.length > 0);
    assert.equal(c.case_id, item.case_id);
    assert.equal(c.split, manifest.split);
    assert.equal(c.label_status, 'provisional');
    assert.equal(c.evaluation_layer, 'L2-input-preparation');
    assert.equal(c.semantic_gold_eligible, true);
    assert(['faulty', 'fixed', 'clean'].includes(c.code_variant));
    assert.deepEqual(c.input.changed_files, ['review.js']);
    const f = readJson(inside(root, `families/${c.family_id}/family.json`));
    assert.equal(f.family_id, c.family_id);
    assert.equal(f.split, c.split);
    assert.equal(f.label_status, 'provisional');
    assert.deepEqual(f.human_reviewers, []);
    assert.equal(f.provenance.kind, 'synthetic');
    assert.equal(f.provenance.external_code_copied, false);
    assert(f.provenance.license && f.requirement && f.behavior_checks.length > 0);
    assert.equal(f.context_required, f.category === 'cross-file');
    if (f.context_required) assert(f.context_rationale && Object.keys(f.file_hashes.base).length > 1);
    assert.equal(c.input.base_dir, `families/${c.family_id}/base`);
    assert.equal(c.input.head_dir, `families/${c.family_id}/${c.code_variant}`);
    for (const [version, files] of Object.entries(f.file_hashes)) {
      for (const [file, expected] of Object.entries(files)) {
        assert.equal(hash(fs.readFileSync(inside(root, `families/${c.family_id}/${version}/${file}`))), expected, 'Source hash mismatch');
      }
    }
    if (!families.has(f.family_id)) {
      const base = runSnapshot(root, f, 'base');
      assert(base.every((row) => row.matches_contract), 'Base must satisfy the requirement');
      families.set(f.family_id, { category: f.category, variants: [], base });
    }
    families.get(f.family_id).variants.push(c.code_variant);
    const baseSource = fs.readFileSync(inside(root, `${c.input.base_dir}/review.js`), 'utf8');
    const headSource = fs.readFileSync(inside(root, `${c.input.head_dir}/review.js`), 'utf8');
    assert.notEqual(baseSource, headSource, 'Every case must be a nonempty change');
    verifyDiff(baseSource, headSource, fs.readFileSync(inside(root, c.input.diff_file), 'utf8'));
    const gold = readJson(inside(root, c.gold_file));
    assert.equal(gold.case_id, c.case_id);
    assert.equal(gold.label_status, 'provisional');
    assert.deepEqual(gold.human_reviewers, []);
    const observations = runSnapshot(root, f, c.code_variant);
    if (c.code_variant === 'faulty') {
      assert.equal(gold.issues.length, 1);
      const issue = gold.issues[0];
      assert(!issueIds.has(issue.gold_issue_id), 'Duplicate gold root cause');
      issueIds.add(issue.gold_issue_id);
      assert(issue.root_cause && issue.severity_rationale);
      assert(['low', 'medium', 'high'].includes(issue.severity));
      const failures = observations.filter((row) => !row.matches_contract);
      assert(failures.length > 0, 'Faulty version must violate its stated contract');
      assert.deepEqual(failures.map((row) => row.check_index), f.expected_faulty_failures.map((row) => row.check_index));
      assert.deepEqual(issue.proof_check_indices, failures.map((row) => row.check_index));
      for (const expected of f.expected_faulty_failures) {
        const actual = observations[expected.check_index];
        if (expected.error_name) {
          assert.equal(actual.error_name, expected.error_name);
          assert(actual.error_message.includes(expected.error_message_contains));
        } else {
          assert(!actual.error_name, 'Unexpected runtime error is not defect evidence');
          assert.deepEqual(actual.actual, expected.actual);
        }
      }
      for (const location of issue.acceptable_locations) {
        assert.equal(location.file, 'review.js');
        assert(location.start_line >= 1 && location.end_line >= location.start_line);
        assert(location.end_line <= headSource.trimEnd().split('\n').length);
      }
      for (const file of issue.required_context_files) assert(Object.hasOwn(f.file_hashes[c.code_variant], file));
      assert.equal(issue.required_context_files.length > 0, f.context_required);
    } else {
      assert.deepEqual(gold.issues, [], 'Clean/fixed cannot contain a declared bug');
      assert(observations.every((row) => row.matches_contract), 'Clean/fixed violates its contract');
    }
    outputs.push({ case_id: c.case_id, family_id: f.family_id, code_variant: c.code_variant, observations });
  }
  assert.equal(families.size, 6);
  const counts = { 'cross-file': 0, 'diff-sufficient': 0, 'clean-only': 0 };
  for (const f of families.values()) {
    assert(Object.hasOwn(counts, f.category));
    counts[f.category]++;
    assert.deepEqual(f.variants.sort(), f.category === 'clean-only' ? ['clean'] : ['faulty', 'fixed']);
  }
  assert.deepEqual(Object.values(counts), [2, 2, 2]);
  return {
    dataset_id: manifest.dataset_id, status: 'validated-development-only', label_status: 'provisional',
    families: families.size, snapshots: outputs.length, categories: counts, gold_defects: issueIds.size,
    behavior_checks: [...families.values()].reduce((n, f) => n + f.base.length, 0) + outputs.reduce((n, c) => n + c.observations.length, 0),
    observed_contract_violations: outputs.flatMap((c) => c.observations).filter((row) => !row.matches_contract).length,
    model_calls: 0, human_gold_review_complete: false, cases: outputs,
  };
}

module.exports = { validate, inside, verifyDiff };
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(validate(), null, 2) + '\n'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
