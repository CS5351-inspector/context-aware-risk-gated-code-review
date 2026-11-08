'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {read,write,hash,load,inputFor}=require('../lib/data.cjs');
const {createPlan}=require('../lib/plan.cjs');
const {runPlan,verifyRuns,validateResult}=require('../lib/runner.cjs');
const bridge=require('../.cache/production.cjs');
const scripted=require('../adapters/scripted.cjs');
const root=path.resolve(__dirname,'..'),repo=path.dirname(root);
const config=()=>({...read(path.join(root,'config/offline.json')),case_ids:['DEV-001','DEV-002']});
const source=()=>inputFor(root,load(root)[0]);
function liveConfig(){
 return {...config(),provider_kind:'live',model:'frozen-model',tokenizer_id:'test-tokenizer',
  prompt_version:'inspector-c-v1+public-requirement-v1',
  effective_parameters:{model:'frozen-model',maxRetries:0,max_tokens:1000}};
}
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inspector-run-integrity-'));try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
function fixture(dir,c=config()){
 const output=path.join(dir,'run');
 runPlan(root,createPlan(root,c,repo),output,path.join(root,'adapters/scripted.cjs'),path.join(root,'.cache/production.cjs'));
 return output;
}

test('provider cannot rewrite the frozen model/config to pass pre-invocation checks',async()=>{
 const c=liveConfig(),original=structuredClone(c);let calls=0;
 const plugin={...scripted,metadata:{kind:'live',version:'test',tokenizer_id:'test-tokenizer'},createClient(config){
  // This mutation previously changed both sides of the verification comparison.
  try {config.model='switched-model';config.effective_parameters.model='switched-model';}catch{}
  return {effectiveParameters:{model:'switched-model'},completeReview:async()=>{calls++;return scripted.createClient().completeReview('');}};
 }};
 await assert.rejects(()=>bridge.evaluate({input:source(),condition:'B1',config:c,opaque_id:'probe'},plugin),/before invocation/);
 assert.equal(calls,0);assert.deepEqual(c,original);assert.equal(Object.isFrozen(c),false);
});

test('retrieval gets immutable patch/budget snapshots without freezing caller objects',async()=>{
 const input=source(),c=config(),original=structuredClone(input),prompts=[];
 const plugin={...scripted,metadata:{...scripted.metadata,context_kind:'actual-retrieval',context_version:'test'},
  collectContext:async(i,_read,budget)=>{
   assert(Object.isFrozen(i));assert(Object.isFrozen(i.changedFiles));assert(Object.isFrozen(i.changedFiles[0]));
   assert.throws(()=>{i.changedFiles[0].patch='fake clean patch';},TypeError);
   assert.throws(()=>{budget.maxInputTokens=999999;},TypeError);
   return {snippets:[],omissions:[]};
  },
  createClient:()=>({...scripted.createClient(),completeReview:async prompt=>{prompts.push(prompt);return scripted.createClient().completeReview(prompt);}}),
 };
 const result=await bridge.evaluate({input,condition:'B2',config:c,opaque_id:'probe'},plugin);
 assert.equal(result.analysis_status,'COMPLETE');assert(prompts[0].includes(JSON.stringify(input.diff)));
 assert.deepEqual(input,original);assert.equal(Object.isFrozen(input),false);assert.equal(Object.isFrozen(c.budget),false);
});

test('saved completion cannot be relabelled as worker failure without matching raw evidence',()=>temp(dir=>{
 const out=fixture(dir),runs=read(path.join(out,'runs.json')),record=runs.records[0];
 Object.assign(record,{status:'failed',error:'adapter_or_output_error',findings:[],calls:null,input_tokens:null,output_tokens:null,cost_usd:null});
 write(path.join(out,'runs.json'),runs);
 assert.throws(()=>verifyRuns(root,out),/contradicts raw output/);
}));

test('saved context treatment must match its planned condition',()=>temp(dir=>{
 const out=fixture(dir),runs=read(path.join(out,'runs.json')),record=runs.records.find(r=>r.review_condition==='B1');
 const file=path.join(out,record.raw_file),raw=read(file);raw.context_kind='oracle';write(file,raw);
 record.raw_sha256=hash(fs.readFileSync(file));write(path.join(out,'runs.json'),runs);
 assert.throws(()=>verifyRuns(root,out),/context differs/);
}));

test('unexecuted records cannot claim calls or measured cost',()=>temp(dir=>{
 const c=config();c.limits.max_tokens=1;const out=fixture(dir,c),runs=read(path.join(out,'runs.json'));
 runs.records[0].calls=1;runs.records[0].cost_usd=1;write(path.join(out,'runs.json'),runs);
 assert.throws(()=>verifyRuns(root,out),/Unexecuted run has calls/);
}));

test('live raw metrics must bind model, prompt and effective parameters to the frozen config',async()=>{
 const raw=await bridge.evaluate({input:source(),condition:'B1',config:config(),opaque_id:'probe'},scripted);
 const c=liveConfig();raw.provider_kind='live';
 raw.metrics={...raw.metrics,model:c.model,promptVersion:c.prompt_version,effectiveParameters:c.effective_parameters};
 validateResult(raw,c);
 for(const key of ['model','promptVersion','effectiveParameters']){
  const bad=structuredClone(raw);bad.metrics[key]=key==='effectiveParameters'?{...c.effective_parameters,max_tokens:999}:'different';
  assert.throws(()=>validateResult(bad,c),/differ(?:s)? from frozen plan/);
 }
});

test('hunk code starting with ++ or -- counts as changed source, not file headers',async()=>{
 const input=source();
 input.diff='--- a/review.js\n+++ b/review.js\n@@ -1,3 +1,3 @@\n let i = 0;\n---i;\n+++i;\n exports.run = () => i;\n';
 input.files={'review.js':'let i = 0;\n++i;\nexports.run = () => i;\n'};
 input.headSha=hash(input.files);input.changedFiles=['review.js'];
 const plugin={...scripted,metadata:{...scripted.metadata,context_kind:'actual-retrieval',context_version:'test'},
  collectContext:async(i)=>{
   assert.equal(i.changedFiles[0].additions,1);assert.equal(i.changedFiles[0].deletions,1);
   return {snippets:[],omissions:[]};
  }};
 const result=await bridge.evaluate({input,condition:'B2',config:config(),opaque_id:'probe'},plugin);
 assert.equal(result.analysis_status,'COMPLETE');assert.equal(result.metrics.calls,1);
});

test('saved live execution must retain the frozen adapter identity',()=>temp(dir=>{
 const out=fixture(dir),c=liveConfig();
 c.adapter_sha256='0'.repeat(64);
 c.pricing={model:c.model,currency:'USD',checked_at:'2026-11-08T00:00:00Z',input_per_million:1,output_per_million:1};
 const plan=createPlan(root,c,repo),runs=read(path.join(out,'runs.json'));
 Object.assign(runs,{plan_id:plan.plan_id,provider_kind:'live'});
 write(path.join(out,'plan.json'),plan);write(path.join(out,'runs.json'),runs);
 // These synthetic records still identify the scripted adapter, so must fail before scoring.
 assert.throws(()=>verifyRuns(root,out),/Recorded adapter differs/);
}));
