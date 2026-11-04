#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { inside, validate } = require('./validate.cjs');

function exportInput(caseId, condition, root = __dirname) {
  if (!['B1', 'B2-oracle'].includes(condition)) throw new Error('Use B1 or B2-oracle; actual B2 retrieval is not implemented');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const item = manifest.cases.find((c) => c.case_id === caseId);
  if (!item) throw new Error('Unknown case ID');
  const c = JSON.parse(fs.readFileSync(inside(root, item.file), 'utf8'));
  const f = JSON.parse(fs.readFileSync(inside(root, `families/${c.family_id}/family.json`), 'utf8'));
  // Explicit allow-list: never spread case/gold/family metadata into model input.
  const payload = {
    case_id: caseId, review_condition: condition, requirement: f.requirement,
    diff: fs.readFileSync(inside(root, c.input.diff_file), 'utf8'),
    context: [],
  };
  if (condition === 'B2-oracle') {
    payload.context = Object.keys(f.file_hashes[c.code_variant]).map((file) => ({
      file, content: fs.readFileSync(inside(root, `${c.input.head_dir}/${file}`), 'utf8'),
    }));
  }
  return payload;
}

module.exports = { exportInput };
if (require.main === module) {
  try {
    validate();
    process.stdout.write(JSON.stringify(exportInput(process.argv[2], process.argv[3]), null, 2) + '\n');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
