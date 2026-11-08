'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {read,write,hash,load,inputFor,implementationHash}=require('./data.cjs');
const {verifyPlan}=require('./plan.cjs');
function validateResult(r, config) {
  assert.equal(r.provider_kind,config.provider_kind);
  assert(['COMPLETE','PARTIAL','FAILED','NOT_APPLICABLE'].includes(r.analysis_status));
  assert(Array.isArray(r.findings) && Array.isArray(r.omissions) && Array.isArray(r.raw));
  const ids=new Set();
  for (const f of r.findings) {
    assert(typeof f.id==='string' && f.id && !ids.has(f.id));ids.add(f.id);
    assert(typeof f.message==='string' && f.message.trim());assert(typeof f.file==='string' && f.file);
    assert(['LEFT','RIGHT'].includes(f.side));assert(f.line===null || (Number.isInteger(f.line)&&f.line>0));
    assert(['low','medium','high'].includes(f.severity));
  }
  assert(r.metrics && Number.isInteger(r.metrics.calls) && r.metrics.calls>=0 && r.metrics.calls<=config.budget.maxCalls);
  for(const k of ['inputTokens','outputTokens']) assert(r.metrics[k]===null || (Number.isInteger(r.metrics[k]) && r.metrics[k]>=0));
  assert(typeof r.metrics.model==='string' && r.metrics.model);
  if (r.analysis_status==='FAILED' || r.analysis_status==='NOT_APPLICABLE') assert.equal(r.findings.length,0);
}
function runPlan(root, plan, output, adapter, bridge, allowLive=false) {
  verifyPlan(plan,root);
  assert.equal(implementationHash(path.dirname(root)),plan.implementation_sha256,'Implementation changed after plan freeze');
  assert(!fs.existsSync(output),'Output directory already exists; use a fresh run directory');
  assert(fs.existsSync(bridge),'Run node evaluation/build-adapter.cjs first');
  const c=plan.config;
  assert(c.provider_kind!=='live'||allowLive,'Live run requires --live and a frozen live plan');
  const bridgeReceipt=read(path.join(path.dirname(bridge),'receipt.json'));
  assert.equal(bridgeReceipt.implementation_sha256,plan.implementation_sha256,'Rebuild stale bridge');
  assert.equal(bridgeReceipt.bundle_sha256,hash(fs.readFileSync(bridge)),'Bridge bundle changed');
  if(c.provider_kind==='live') assert.equal(hash(fs.readFileSync(adapter)),c.adapter_sha256,'Freeze live adapter hash in config');
  const rows=new Map(load(root).map(row=>[row.case.case_id,row]));
  fs.mkdirSync(output,{recursive:true});write(path.join(output,'plan.json'),plan);
  const result={schema_version:1,plan_id:plan.plan_id,dataset_sha256:plan.dataset_sha256,code_sha:plan.code_sha,
    bridge_sha256:hash(fs.readFileSync(bridge)),adapter_sha256:hash(fs.readFileSync(adapter)),provider_kind:c.provider_kind,
    evaluation_scope:c.evaluation_scope,output_boundary:c.output_boundary,implementation_sha256:plan.implementation_sha256,records:[]};
  const start=Date.now();let reservedTokens=0,reservedCost=0,startedRuns=0;
  const tokensPerRun=c.budget.maxCalls*(c.budget.maxInputTokens+c.budget.reservedOutputTokens);
  const costPerRun=c.provider_kind==='live'?tokensPerRun*Math.max(c.pricing.input_per_million,c.pricing.output_per_million)/1e6:0;
  let index=0;
  for(const pair of plan.pairs) {
    const row=rows.get(pair.case_id);assert(row,'Unknown case');
    const canRun=startedRuns+2<=c.limits.max_runs && reservedTokens+2*tokensPerRun<=c.limits.max_tokens
      && reservedCost+2*costPerRun<=c.limits.max_cost_usd && Date.now()-start+2*c.limits.worker_timeout_ms<=c.limits.max_wall_ms;
    if(canRun){reservedTokens+=2*tokensPerRun;reservedCost+=2*costPerRun;}
    for(const condition of pair.conditions) {
      const input=inputFor(root,row),record={run_key:`${pair.case_id}/${condition}/${pair.trial_id}`,case_id:pair.case_id,
        family_id:row.case.family_id,category:row.family.category,code_variant:row.case.code_variant,label_status:row.case.label_status,
        review_condition:condition,trial_id:pair.trial_id,input_sha256:hash(input),status:'not_executed',
        stop_reason:canRun?null:'pair_budget_reservation',started_at:null,ended_at:null,latency_ms:null,
        calls:null,input_tokens:null,output_tokens:null,cost_usd:null,raw_file:null,raw_sha256:null,findings:[],error:null};
      if(canRun) {
        startedRuns++;record.started_at=new Date().toISOString();const now=Date.now();
        const child=spawnSync(process.execPath,[path.join(__dirname,'worker.cjs'),path.resolve(adapter),path.resolve(bridge)],{
          input:JSON.stringify({input,condition,opaque_id:`sample-${hash(pair.case_id).slice(0,12)}`,config:c}),
          encoding:'utf8',timeout:c.limits.worker_timeout_ms,killSignal:'SIGKILL',maxBuffer:10*1024*1024,
          // No user-provided source is executed; only the explicit trusted adapter is run.
          cwd:path.dirname(path.resolve(bridge)),env:process.env,
        });
        record.latency_ms=Date.now()-now;record.ended_at=new Date().toISOString();
        record.raw_file=`raw/${String(++index).padStart(4,'0')}.json`;
        let raw;
        try {
          assert(!child.error && child.status===0,'Worker failed');
          raw=JSON.parse(child.stdout);validateResult(raw,c);
          assert.equal(raw.context_kind,condition==='B2'?'actual-retrieval':condition==='B1'?'none':'oracle');
          record.status=raw.analysis_status.toLowerCase();record.findings=raw.findings;
          record.calls=raw.metrics.calls;record.input_tokens=raw.metrics.inputTokens;record.output_tokens=raw.metrics.outputTokens;
          if(c.provider_kind==='scripted')record.cost_usd=0;
          else if(record.input_tokens!==null&&record.output_tokens!==null)record.cost_usd=(record.input_tokens*c.pricing.input_per_million+record.output_tokens*c.pricing.output_per_million)/1e6;
        }catch(e){
          record.status='failed';record.error=child.error?.code==='ETIMEDOUT'?'worker_timeout':'adapter_or_output_error';
          // Deliberately do not save arbitrary stderr: adapters may log credentials there.
          raw={failure:record.error,exit_status:child.status,signal:child.signal,usage_unknown:true};
        }
        write(path.join(output,record.raw_file),raw);record.raw_sha256=hash(fs.readFileSync(path.join(output,record.raw_file)));
      }
      result.records.push(record);
      // Checkpoint after every started or unexecuted run; interrupted sets remain explicitly incomplete.
      write(path.join(output,'runs.json'),result);
    }
  }
  result.reserved_token_upper_bound=reservedTokens;result.reserved_cost_upper_bound_usd=reservedCost;
  result.completed_plan=true;write(path.join(output,'runs.json'),result);return result;
}
function verifyRuns(root,dir) {
  const plan=read(path.join(dir,'plan.json'));verifyPlan(plan,root);
  const runs=read(path.join(dir,'runs.json'));
  assert.equal(runs.plan_id,plan.plan_id);assert.equal(runs.dataset_sha256,plan.dataset_sha256);
  assert.equal(runs.implementation_sha256,plan.implementation_sha256);assert.equal(runs.code_sha,plan.code_sha);
  assert.equal(runs.provider_kind,plan.config.provider_kind);assert.equal(runs.output_boundary,plan.config.output_boundary);
  assert.equal(runs.evaluation_scope,plan.config.evaluation_scope);
  const expected=new Set(plan.pairs.flatMap(p=>p.conditions.map(c=>`${p.case_id}/${c}/${p.trial_id}`))),seen=new Set();
  const cases=new Map(load(root).map(x=>[x.case.case_id,x]));
  for(const r of runs.records){
    assert(expected.has(r.run_key) && !seen.has(r.run_key),'Unexpected/duplicate run');seen.add(r.run_key);
    assert.equal(r.run_key,`${r.case_id}/${r.review_condition}/${r.trial_id}`);
    const data=cases.get(r.case_id);assert(data);
    assert.equal(r.family_id,data.case.family_id);assert.equal(r.code_variant,data.case.code_variant);assert.equal(r.category,data.family.category);
    assert.equal(r.label_status,data.case.label_status);assert.equal(r.input_sha256,hash(inputFor(root,data)));
    assert(['not_executed','complete','partial','failed','not_applicable'].includes(r.status));
    if(r.status!=='not_executed'){assert(Number.isFinite(r.latency_ms)&&r.latency_ms>=0);assert(Number.isFinite(Date.parse(r.started_at))&&Number.isFinite(Date.parse(r.ended_at)));}
    if(r.status==='not_executed'){assert.equal(r.raw_file,null);assert.equal(r.findings.length,0);continue;}
    assert(/^raw\/[0-9]+\.json$/.test(r.raw_file));assert.equal(hash(fs.readFileSync(path.join(dir,r.raw_file))),r.raw_sha256,'Raw output changed');
    const raw=read(path.join(dir,r.raw_file));
    if(!r.error){validateResult(raw,plan.config);assert.equal(raw.analysis_status.toLowerCase(),r.status);assert.deepEqual(raw.findings,r.findings);
      assert.equal(raw.metrics.calls,r.calls);assert.equal(raw.metrics.inputTokens,r.input_tokens);assert.equal(raw.metrics.outputTokens,r.output_tokens);
      const c=plan.config;const expectedCost=c.provider_kind==='scripted'?0:r.input_tokens===null||r.output_tokens===null?null:(r.input_tokens*c.pricing.input_per_million+r.output_tokens*c.pricing.output_per_million)/1e6;
      assert.equal(r.cost_usd,expectedCost,'Cost record does not match usage/pricing');
    } else {assert.equal(r.status,'failed');assert.equal(r.findings.length,0);assert.equal(r.cost_usd,null);}
  }
  return {plan,runs,complete:seen.size===expected.size&&runs.records.every(r=>r.status!=='not_executed')};
}
module.exports={runPlan,verifyRuns,validateResult};
