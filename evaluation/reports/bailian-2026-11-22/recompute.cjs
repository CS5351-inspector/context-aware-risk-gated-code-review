'use strict';
// Recompute engineering measurements only; pending semantic judgments stay pending.
const fs=require('node:fs'),path=require('node:path');
const {verifyRuns}=require('../../lib/runner.cjs');
const root=path.resolve(__dirname,'../..');
const quantile=(xs,p)=>{const a=[...xs].sort((x,y)=>x-y);return a.length?a[Math.ceil(a.length*p)-1]:null;};
const output={currency:'CNY',cost_basis:'published peak uncached list-rate estimate; not account invoice',quality_review_status:'pending',experiments:{}};
for(const phase of ['pilot','development']){
 const dir=path.join(__dirname,phase),{plan,runs,complete}=verifyRuns(root,dir);
 const records=runs.records,read=x=>JSON.parse(fs.readFileSync(path.join(dir,x.raw_file),'utf8'));
 const raw=records.filter(x=>x.raw_file).map(read);
 const responses=raw.flatMap(x=>x.raw||[]).map(x=>x.response).filter(Boolean);
 const sum=(xs,k)=>xs.reduce((a,x)=>a+(x[k]??0),0);
 const groups={};
 for(const condition of plan.config.conditions){
  const xs=records.filter(x=>x.review_condition===condition),rs=xs.filter(x=>x.raw_file).map(read);
  const attempts=rs.flatMap(x=>x.metrics?.attempts||[]);
  groups[condition]={runs:xs.length,statuses:Object.fromEntries(['complete','partial','failed','not_executed'].map(s=>[s,xs.filter(x=>x.status===s).length])),
   validated_findings:xs.reduce((n,x)=>n+x.findings.length,0),calls:sum(xs,'calls'),input_tokens:sum(xs,'input_tokens'),output_tokens:sum(xs,'output_tokens'),
   usage_unknown_runs:xs.filter(x=>x.input_tokens===null||x.output_tokens===null).length,cost_estimate:sum(xs,'cost_amount'),
   worker_p50_ms:quantile(xs.map(x=>x.latency_ms).filter(x=>x!==null),0.5),worker_p95_ms:quantile(xs.map(x=>x.latency_ms).filter(x=>x!==null),0.95),
   request_p50_ms:quantile(attempts.map(x=>x.durationMs),0.5)};
 }
 output.experiments[phase]={plan_id:plan.plan_id,paired_complete:complete,model:plan.config.model,
  returned_models:[...new Set(responses.map(x=>x.model))],responses:responses.length,
  nonempty_reasoning_responses:responses.filter(x=>x.choices?.some(c=>Boolean(c.message?.reasoning_content?.trim()))).length,
  spending_cap:plan.config.limits.max_cost,reserved_cost_upper_bound:runs.reserved_cost_upper_bound,
  cost_estimate:sum(records,'cost_amount'),conditions:groups,
  exceptions:records.filter(x=>x.status!=='complete').map(x=>({run_key:x.run_key,status:x.status,omissions:x.raw_file?read(x).omissions??[]:[]}))};
}
output.total_cost_estimate=Object.values(output.experiments).reduce((s,x)=>s+x.cost_estimate,0);
output.total_spending_cap=30;
console.log(JSON.stringify(output,null,2));
