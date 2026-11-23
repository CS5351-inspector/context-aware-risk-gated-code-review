'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {prepare}=require('../adapters/sprint2-prepare.cjs');
const {configCheck}=require('../lib/plan.cjs');
const {load,inputFor}=require('../lib/data.cjs');
const root=path.resolve(__dirname,'..');
const output=path.join(root,'.cache/sprint2-test-provider.cjs');
const draft=prepare('pilot',null,output);
const plugin=require(output);
// Test-only prices below are synthetic; never export them as an experiment configuration.
const approval={max_cost_usd:1,pricing_source:'UNIT TEST ONLY synthetic rates',pricing:{model:draft.model,currency:'USD',checked_at:'2026-11-22',input_per_million:1,output_per_million:1}};
test('draft cannot become a live plan until cost assumptions are supplied',()=>{
 assert.equal(draft.pricing,null);assert.equal(draft.limits.max_cost_usd,null);
 assert.throws(()=>configCheck(draft));
 const ready=prepare('pilot',approval,output);configCheck(ready);
 assert.equal(ready.case_ids.length,6);assert.deepEqual(ready.conditions,['B1','B2']);
 assert.equal(ready.token_count_is_exact,false);
 for(const profile of ['pilot','development']){
  const c=prepare(profile,approval,output);const runs=profile==='pilot'?12:40;
  assert.equal(c.limits.max_tokens,runs*c.budget.maxCalls*(c.budget.maxInputTokens+c.budget.reservedOutputTokens));
  assert(c.limits.max_wall_ms>runs*c.limits.worker_timeout_ms);
 }
 assert.throws(()=>prepare('pilot',{...approval,pricing_source:''},output));
});
test('C tokenizer counts content with explicit allowance; client fails before network when unconfigured',()=>{
 assert.equal(plugin.metadata.token_count_is_exact,false);
 assert(plugin.countInputTokens('A message about code')>=64);
 assert.throws(()=>plugin.createClient({...draft,base_url:'https://unapproved.invalid'}),/endpoint/);
 const saved=process.env.INSPECTOR_MODEL_API_KEY;
 try {delete process.env.INSPECTOR_MODEL_API_KEY;assert.throws(()=>plugin.createClient(draft),/not configured/);}
 finally {if(saved!==undefined)process.env.INSPECTOR_MODEL_API_KEY=saved;}
});
test('actual B/C bridge processes all 20 cases; scripted completions are not quality evidence',async()=>{
 const {evaluate}=require('../.cache/production.cjs');
 const config=prepare('development',approval,output);
 let crossfile=0;
 for(const row of load(root)){
  const input=inputFor(root,row);
  let calls=0;
  const offline={...plugin,createClient:()=>({effectiveParameters:config.effective_parameters,
   completeReview:async(prompt)=>{calls++;assert(prompt.includes('Public behavioral requirement'));return {choices:[{finish_reason:'stop',message:{content:'{"reviews":[]}'}}],usage:{prompt_tokens:1,completion_tokens:1}};}})};
  for(const condition of ['B1','B2']){
   const result=await evaluate({input,condition,config,opaque_id:row.case.case_id},offline);
   assert.equal(result.analysis_status,'COMPLETE',`${row.case.case_id}/${condition}: ${JSON.stringify(result.omissions)}`);
   assert.equal(result.metrics.calls,1);assert.equal(result.findings.length,0);
   for(const key of ['durationMs','modelDurationMs','contextDurationMs'])assert(Number.isFinite(result.metrics[key])&&result.metrics[key]>=0,key);
   assert(result.metrics.modelDurationMs<=result.metrics.durationMs);
   if(condition==='B1')assert.equal(result.snippets.length,0);
   else {assert(result.snippets.length>0);if(result.snippets.some(s=>s.reason==='direct-definition'))crossfile++;}
  }
  assert.equal(calls,2);
 }
 assert.equal(crossfile,8,'Four cross-file families, buggy and fixed variants');
});

test('real worker cwd resolves verified tokenizer assets without network inference',()=>{
 const {spawnSync}=require('node:child_process');
 const config=prepare('pilot',approval,output);
 const wrapper=path.join(root,'.cache/sprint2-worker-scripted.cjs');
 // Only in this offline test, replace network completion with a scripted envelope.
 fs.writeFileSync(wrapper,`const plugin=require('./sprint2-test-provider.cjs');module.exports={...plugin,createClient:config=>({effectiveParameters:config.effective_parameters,completeReview:async()=>({choices:[{finish_reason:'stop',message:{content:'{"reviews":[]}'}}],usage:{prompt_tokens:1,completion_tokens:1}})})};`);
 try {
 const result=spawnSync(process.execPath,[path.join(root,'lib/worker.cjs'),wrapper,path.join(root,'.cache/production.cjs')],{
  cwd:path.join(root,'.cache'),encoding:'utf8',input:JSON.stringify({input:inputFor(root,load(root)[0]),condition:'B2',config,opaque_id:'worker-offline-check'}),timeout:30000});
 assert.equal(result.status,0,result.stderr);
 const response=JSON.parse(result.stdout);assert.equal(response.analysis_status,'COMPLETE');
 assert(response.snippets.some(s=>s.reason==='direct-definition'));
 assert(response.metrics.attempts[0].estimatedInputTokens>=64);
 } finally {fs.unlinkSync(wrapper);}
});
