'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { validate } = require('../validate.cjs');
const { hash, load, fingerprint, implementationHash } = require('./data.cjs');
function random(seed) { let x = seed >>> 0; return () => { x = (1664525 * x + 1013904223) >>> 0; return x / 4294967296; }; }
function configCheck(c) {
  assert(['development', 'formal'].includes(c.purpose));
  assert(['scripted','live'].includes(c.provider_kind));
  assert.equal(c.evaluation_scope, 'component', 'Current bridge supports C component only; final-product adapter is not implemented');
  assert.equal(c.output_boundary, 'C.reviewFiles.validated-findings');
  assert.deepEqual(c.conditions, c.conditions.includes('B2') ? ['B1','B2'] : ['B1','B2-oracle']);
  assert(Number.isSafeInteger(c.seed)); assert(Number.isSafeInteger(c.trials) && c.trials > 0 && c.trials <= 100);
  for (const k of ['maxFiles','maxCalls','requestTimeoutMs','analysisTimeoutMs','maxInputTokens','reservedOutputTokens']) assert(Number.isSafeInteger(c.budget[k]) && c.budget[k] > 0, k);
  for (const k of ['maxRetries','publishReserveMs']) assert(Number.isSafeInteger(c.budget[k]) && c.budget[k] >= 0, k);
  assert(c.budget.analysisTimeoutMs > c.budget.publishReserveMs); assert(c.budget.maxInputTokens > c.budget.reservedOutputTokens);
  for (const k of ['max_runs','max_wall_ms','worker_timeout_ms','max_tokens']) assert(Number.isSafeInteger(c.limits[k]) && c.limits[k] > 0, k);
  assert(c.limits.worker_timeout_ms > c.budget.analysisTimeoutMs);
  assert(Number.isFinite(c.limits.max_cost_usd) && c.limits.max_cost_usd >= 0);
  if (c.provider_kind === 'live') {
    assert(c.pricing && ['input_per_million','output_per_million'].every(k => Number.isFinite(c.pricing[k]) && c.pricing[k] >= 0));
    assert(c.pricing.currency === 'USD' && c.pricing.model && c.pricing.checked_at);
    assert(c.adapter_sha256 && /^[a-f0-9]{64}$/.test(c.adapter_sha256));
    assert(c.model && c.prompt_version && c.effective_parameters && c.tokenizer_id, 'Pin live model, parameters, prompt and tokenizer');
    assert.equal(c.model, c.pricing.model);
    assert(Number.isFinite(Date.parse(c.pricing.checked_at)));
    if(c.conditions.includes('B2'))assert(c.context_version?.trim(),'Freeze actual B context version');
  }
  if (c.purpose === 'formal') {
    assert.equal(c.split, 'heldout'); assert.equal(c.provider_kind, 'live'); assert.deepEqual(c.conditions, ['B1','B2']);
    const a = c.formal_approval;
    assert(a && a.approved_by?.trim() && Number.isFinite(Date.parse(a.approved_at)) && a.stopping_rule?.trim());
    for (const k of ['minimum_recall_gain','maximum_precision_loss','maximum_clean_success_loss']) assert(Number.isFinite(a[k]) && a[k] >= 0 && a[k] <= 1);
  }
}
function createPlan(root, config, repo) {
  configCheck(config); validate(root);
  const available = load(root).filter(x => x.case.split === config.split);
  if (config.case_ids) { assert(Array.isArray(config.case_ids) && new Set(config.case_ids).size === config.case_ids.length); for (const id of config.case_ids) assert(available.some(x => x.case.case_id === id), 'Unknown selected case'); }
  const rows = available.filter(x => !config.case_ids || config.case_ids.includes(x.case.case_id));
  assert(rows.length > 0, 'No cases for requested split');
  if (config.purpose === 'formal') assert(rows.every(x => x.case.label_status === 'reviewed'), 'Formal evaluation requires reviewed labels');
  const rand = random(config.seed), pairs=[];
  for (const row of rows) for (let trial=1; trial<=config.trials; trial++) pairs.push({case_id: row.case.case_id, trial_id: trial, conditions: rand()<.5 ? [...config.conditions] : [...config.conditions].reverse()});
  for (let i=pairs.length-1;i>0;i--) { const j=Math.floor(rand()*(i+1)); [pairs[i],pairs[j]]=[pairs[j],pairs[i]]; }
  assert(config.limits.max_runs >= pairs.length*2, 'Budget cannot cover planned run count; select a smaller dataset or fewer trials before freezing');
  const plan = { schema_version: 1, config, implementation_sha256: implementationHash(repo), dataset_sha256: fingerprint(root), code_sha: execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(), pairs };
  return { ...plan, plan_id: hash(plan) };
}
function verifyPlan(plan, root) {
  const { plan_id, ...body } = plan; assert.equal(hash(body), plan_id, 'Plan changed after freeze');
  configCheck(plan.config); assert.equal(fingerprint(root), plan.dataset_sha256, 'Dataset changed after freeze');
  const available=load(root).filter(r=>r.case.split===plan.config.split && (!plan.config.case_ids || plan.config.case_ids.includes(r.case.case_id)));
  const required=new Set(available.flatMap(r=>Array.from({length:plan.config.trials},(_,i)=>`${r.case.case_id}/${i+1}`)));
  const keys=new Set();
  for (const p of plan.pairs) { const k=`${p.case_id}/${p.trial_id}`; assert(required.has(k) && !keys.has(k));keys.add(k);assert.deepEqual([...p.conditions].sort(),[...plan.config.conditions].sort()); }
  assert.equal(keys.size,required.size,'Incomplete planned case/trial pairs');
}
module.exports = { createPlan, verifyPlan, configCheck, random };
