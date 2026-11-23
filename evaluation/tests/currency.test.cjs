'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {read,write,hash}=require('../lib/data.cjs');
const {createPlan,configCheck}=require('../lib/plan.cjs');
const {runPlan,verifyRuns}=require('../lib/runner.cjs');
const {score,template}=require('../lib/score.cjs');
const root=path.resolve(__dirname,'..'),repo=path.dirname(root);
const offline=()=>({...read(path.join(root,'config/offline.json')),case_ids:['DEV-001']});
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inspector-currency-'));try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
function fixture(dir,{currency='CNY',limit=1,unknown=false,failure=false}={}){
  // Live metadata exercises the production accounting path; transport is entirely local,
  // with deterministic responses and no imports that can contact a provider or read keys.
  const adapter=path.join(dir,'fake-live.cjs');
  fs.writeFileSync(adapter,`module.exports={metadata:{kind:'live',version:'currency-test-only',tokenizer_id:'fake-test-counter'},
    countInputTokens:()=>100,createClient:()=>({effectiveParameters:{model:'fake-currency-model',temperature:0},
    completeReview:async()=>${failure?"{throw new Error('synthetic failure');}":`({choices:[{finish_reason:'stop',message:{content:'{"reviews":[]}'}}]${unknown?'':',usage:{prompt_tokens:100,completion_tokens:10}'}})`}})};`);
  const c=offline();c.provider_kind='live';c.model='fake-currency-model';c.tokenizer_id='fake-test-counter';
  c.prompt_version='inspector-c-v1+public-requirement-v1';
  c.effective_parameters={model:c.model,temperature:0,maxRetries:0,max_tokens:c.budget.reservedOutputTokens};
  c.pricing={model:c.model,currency,checked_at:'2026-11-22T00:00:00Z',input_per_million:2,output_per_million:4};
  delete c.limits.max_cost_usd;c.limits.max_cost=limit;c.adapter_sha256=hash(fs.readFileSync(adapter));
  const out=path.join(dir,'run');runPlan(root,createPlan(root,c,repo),out,adapter,path.join(root,'.cache/production.cjs'),true);
  return {out,c};
}
test('CNY runs retain native currency through raw receipts, verification, scoring and report',()=>temp(dir=>{
  const {out}=fixture(dir),{runs,complete}=verifyRuns(root,out);assert(complete);
  for(const r of runs.records){
    assert.equal(r.status,'complete');assert.equal(r.cost_currency,'CNY');assert.equal(r.cost_amount,.00024);assert.equal(r.cost_usd,null);
    const raw=read(path.join(out,r.raw_file));assert.equal(raw.raw[0].response.usage.prompt_tokens,100);
  }
  assert.equal(runs.cost_currency,'CNY');assert.equal(runs.reserved_cost_upper_bound,.208);assert.equal(runs.reserved_cost_upper_bound_usd,null);
  const labels=template(root,out),summary=score(root,out,labels);assert.equal(summary.cost_currency,'CNY');
  for(const s of Object.values(summary.conditions)){
    assert.equal(s.cost_currency,'CNY');assert.equal(s.cost_known_subtotal,.00024);assert.equal(s.cost_known_subtotal_usd,null);assert.equal(s.cost_unknown_runs,0);
  }
  const labelsFile=path.join(dir,'labels.json'),reportDir=path.join(dir,'report');write(labelsFile,labels);
  execFileSync(process.execPath,[path.join(root,'cli.cjs'),'score','--runs',out,'--labels',labelsFile,'--out',reportDir]);
  const report=fs.readFileSync(path.join(reportDir,'REPORT.md'),'utf8');assert.match(report,/Known cost CNY/);assert.doesNotMatch(report,/Known cost USD/);
}));
test('CNY refuses a whole pair when only one worst-case reservation fits',()=>temp(dir=>{
  const {out}=fixture(dir,{limit:.15}),{runs,complete}=verifyRuns(root,out);assert.equal(complete,false);
  assert.equal(runs.records.length,2);assert.equal(runs.reserved_cost_upper_bound,0);
  for(const r of runs.records){assert.equal(r.status,'not_executed');assert.equal(r.stop_reason,'pair_budget_reservation');assert.equal(r.cost_amount,null);assert.equal(r.raw_file,null);}
}));
test('CNY unknown usage stays unknown instead of becoming a free request',()=>temp(dir=>{
  const {out}=fixture(dir,{unknown:true}),{runs}=verifyRuns(root,out);
  for(const r of runs.records){assert.equal(r.cost_amount,null);assert.equal(r.cost_usd,null);}
  for(const s of Object.values(score(root,out,template(root,out)).conditions)){assert.equal(s.cost_known_subtotal,0);assert.equal(s.cost_unknown_runs,1);}
}));
test('CNY transport failure does not invent a charge or zero usage',()=>temp(dir=>{
  const {out}=fixture(dir,{failure:true}),{runs}=verifyRuns(root,out);
  for(const r of runs.records){assert.equal(r.status,'failed');assert.equal(r.cost_amount,null);assert.equal(r.input_tokens,null);}
}));
test('CNY rejects changed cost, currency, USD alias and raw receipts',()=>temp(dir=>{
  const {out}=fixture(dir),file=path.join(out,'runs.json'),original=read(file);
  for(const patch of [{cost_amount:0},{cost_currency:'USD'},{cost_usd:.00024}]){
    const runs=structuredClone(original);Object.assign(runs.records[0],patch);write(file,runs);
    assert.throws(()=>verifyRuns(root,out),/cost|currency/i);
  }
  write(file,original);const rawFile=path.join(out,original.records[0].raw_file),raw=read(rawFile);raw.metrics.inputTokens++;write(rawFile,raw);
  assert.throws(()=>verifyRuns(root,out),/Raw output changed/);
  original.records[0].raw_sha256=hash(fs.readFileSync(rawFile));write(file,original);
  assert.throws(()=>verifyRuns(root,out));
}));
test('live plans require concrete rates, unambiguous limits and supported currency',()=>temp(dir=>{
  const {c}=fixture(dir);
  for(const pricing of [null,{...c.pricing,input_per_million:null},{...c.pricing,output_per_million:null},{...c.pricing,currency:'EUR'}])assert.throws(()=>configCheck({...c,pricing}));
  assert.throws(()=>configCheck({...c,limits:{...c.limits,max_cost:null}}));
  assert.throws(()=>configCheck({...c,limits:{...c.limits,max_cost_usd:1}}),/only valid for USD/);
  const usd={...c,pricing:{...c.pricing,currency:'USD'}};configCheck(usd);
  assert.throws(()=>configCheck({...usd,limits:{...usd.limits,max_cost_usd:2}}),/Conflicting/);
}));
test('USD pricing still populates legacy cost fields with the same amount',()=>temp(dir=>{
  const {out}=fixture(dir,{currency:'USD'}),{runs}=verifyRuns(root,out);
  assert.equal(runs.reserved_cost_upper_bound_usd,.208);
  for(const r of runs.records){assert.equal(r.cost_currency,'USD');assert.equal(r.cost_usd,.00024);assert.equal(r.cost_amount,r.cost_usd);}
  for(const s of Object.values(score(root,out,template(root,out)).conditions))assert.equal(s.cost_known_subtotal_usd,s.cost_known_subtotal);
  // Historical nonzero USD receipts have only the old cost_usd fields.
  for(const r of runs.records){delete r.cost_currency;delete r.cost_amount;}
  delete runs.cost_currency;delete runs.reserved_cost_upper_bound;write(path.join(out,'runs.json'),runs);
  assert(verifyRuns(root,out).complete);
  for(const s of Object.values(score(root,out,template(root,out)).conditions)){assert.equal(s.cost_known_subtotal,.00024);assert.equal(s.cost_unknown_runs,0);}
}));
test('old USD-only scripted records verify without migration and remain free',()=>temp(dir=>{
  const out=path.join(dir,'run');runPlan(root,createPlan(root,offline(),repo),out,path.join(root,'adapters/scripted.cjs'),path.join(root,'.cache/production.cjs'));
  const runs=read(path.join(out,'runs.json'));
  for(const r of runs.records){assert.equal(r.cost_currency,'USD');assert.equal(r.cost_amount,0);delete r.cost_currency;delete r.cost_amount;}
  delete runs.cost_currency;delete runs.reserved_cost_upper_bound;write(path.join(out,'runs.json'),runs);
  assert(verifyRuns(root,out).complete);
  for(const s of Object.values(score(root,out,template(root,out)).conditions)){assert.equal(s.cost_currency,'USD');assert.equal(s.cost_known_subtotal_usd,0);assert.equal(s.cost_known_subtotal,0);}
}));
