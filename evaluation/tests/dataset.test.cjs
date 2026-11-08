'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
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

test('twelve families have real bug/fixed evidence and clean controls', () => {
  const result = validate();
  assert.equal(result.families, 12);
  assert.equal(result.snapshots, 20);
  assert.equal(result.gold_defects, 8);
  assert.equal(result.behavior_checks, 113);
  assert.equal(result.observed_contract_violations, 17);
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

test('rejects a changed dependency omitted from the declared diff', () => mutate((r) => {
  const file = path.join(r, 'families/grant-enum/faulty/policy.js');
  fs.appendFileSync(file, '\n// An additional change outside review.js\n');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  changeJson(r, 'families/grant-enum/family.json', (f) => {
    f.file_hashes.faulty['policy.js'] = digest;
  });
}));

test('rejects gold with no acceptable finding location', () => mutate((r) => {
  changeJson(r, 'gold/DEV-001.json', (gold) => {
    gold.issues[0].acceptable_locations = [];
  });
}));

test('rejects fractional gold line numbers', () => mutate((r) => {
  changeJson(r, 'gold/DEV-001.json', (gold) => {
    gold.issues[0].acceptable_locations[0].start_line = 1.5;
  });
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

test('rejects a forged reviewed label without two independent review records',()=>mutate(r=>{
  for(const id of ['DEV-001','DEV-002']){
    changeJson(r,`cases/${id}.json`,c=>{c.label_status='reviewed';});
    changeJson(r,`gold/${id}.json`,g=>{g.label_status='reviewed';g.human_reviewers=['reviewer-a','reviewer-b'];});
  }
  changeJson(r,'families/grant-enum/family.json',f=>{f.label_status='reviewed';f.human_reviewers=['reviewer-a','reviewer-b'];});
}));
test('allows versioned human-review records, rejects stale evidence after a label edit',()=>{
 const {hash,write}=require('../lib/data.cjs');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'review-record-check-'));
 try{
  const r=path.join(temp,'evaluation');fs.cpSync(root,r,{recursive:true});
  changeJson(r,'families/grant-enum/family.json',f=>{f.label_status='reviewed';f.human_reviewers=['synthetic-review-a','synthetic-review-b'];});
  for(const id of ['DEV-001','DEV-002']){
    changeJson(r,`cases/${id}.json`,c=>{c.label_status='reviewed';});
    changeJson(r,`gold/${id}.json`,g=>{g.label_status='reviewed';g.human_reviewers=['synthetic-review-a','synthetic-review-b'];});
    const c=JSON.parse(fs.readFileSync(path.join(r,`cases/${id}.json`))),f=JSON.parse(fs.readFileSync(path.join(r,'families/grant-enum/family.json'))),g=JSON.parse(fs.readFileSync(path.join(r,`gold/${id}.json`)));
    write(path.join(r,`reviews/${id}.json`),{case_id:id,content_sha256:hash({case:c,requirement:f.requirement,hashes:f.file_hashes,checks:f.behavior_checks,issues:g.issues}),reviews:g.human_reviewers.map(reviewer=>({reviewer,is_human:true,decision:'accepted',reviewed_at:'2026-11-08T00:00:00Z',evidence:'Test fixture only, never a dataset human sign-off'}))});
  }
  assert.equal(validate(r).reviewed_snapshots,2);
  changeJson(r,'gold/DEV-001.json',g=>{g.issues[0].severity='medium';});assert.throws(()=>validate(r),/stale/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
test('rejects source files symlinked outside the dataset',()=>mutate(r=>{
 const file=path.join(r,'families/grant-enum/base/review.js');fs.unlinkSync(file);fs.symlinkSync(__filename,file);
}));
test('checks the nonmutation promise as well as returned values',()=>mutate(r=>{
 const file=path.join(r,'families/copy-reverse/clean/review.js');fs.writeFileSync(file,'exports.reverse = values => values.reverse();\n');
 // Supply consistent hashes and diff: only behavior should catch the violation.
 const family=path.join(r,'families/copy-reverse/family.json');const f=JSON.parse(fs.readFileSync(family));f.file_hashes.clean['review.js']=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');fs.writeFileSync(family,JSON.stringify(f));
 fs.writeFileSync(path.join(r,'cases/DEV-019.diff'),'--- a/review.js\n+++ b/review.js\n@@ -1 +1 @@\n-exports.reverse = values => values.slice().reverse();\n+exports.reverse = values => values.reverse();\n');
}));
