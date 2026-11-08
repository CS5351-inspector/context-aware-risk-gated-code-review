'use strict';
const assert=require('node:assert/strict');
const {load,hash}=require('./data.cjs');
const {verifyRuns}=require('./runner.cjs');
const {random}=require('./plan.cjs');
const ratio=(a,b)=>b?a/b:null;
const mean=xs=>{const a=xs.filter(x=>x!==null);return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;};
function template(root,dir){
  const {plan,runs}=verifyRuns(root,dir);
  return {schema_version:1,plan_id:plan.plan_id,runs_sha256:hash(runs),reviewer:null,reviewed_at:null,
    instructions:'Split multi-issue comments into atomic claims; assign a shared root_id only for true duplicates. Verdicts need human evidence. Unmatched is unresolved, not automatically false_positive.',
    judgments:runs.records.flatMap(r=>r.findings.map(f=>({run_key:r.run_key,finding_id:f.id,atom_id:'1',root_id:f.id,verdict:'unresolved',gold_issue_id:null,evidence:'',location_acceptable:null,severity_acceptable:null}))) };
}
function score(root,dir,labels){
  const {plan,runs,complete}=verifyRuns(root,dir);assert.equal(labels.plan_id,plan.plan_id);assert.equal(labels.runs_sha256,hash(runs),'Labels refer to different run records');
  assert(Array.isArray(labels.judgments));
  const rowMap=new Map(runs.records.map(r=>[r.run_key,r]));const cases=new Map(load(root).map(x=>[x.case.case_id,x]));
  const seen=new Set();const groups=new Map();
  for(const j of labels.judgments){
    const r=rowMap.get(j.run_key);assert(r && r.findings.some(f=>f.id===j.finding_id),'Unknown finding in judgment');
    const key=`${j.run_key}/${j.finding_id}/${j.atom_id}`;assert(j.atom_id && !seen.has(key),'Duplicate atom');seen.add(key);
    assert(typeof j.root_id==='string'&&j.root_id);assert(['gold','novel','false_positive','out_of_scope','unresolved'].includes(j.verdict));
    if(j.verdict!=='unresolved')assert(labels.reviewer?.trim() && Number.isFinite(Date.parse(labels.reviewed_at)) && j.evidence?.trim(),'Adjudication requires reviewer, date and evidence');
    const gold=cases.get(r.case_id).gold.issues;
    if(j.verdict==='gold')assert(gold.some(g=>g.gold_issue_id===j.gold_issue_id),'Unknown gold root');
    else assert.equal(j.gold_issue_id,null);
    for(const k of ['location_acceptable','severity_acceptable'])assert(j[k]===null||typeof j[k]==='boolean');
    if(!groups.has(j.run_key))groups.set(j.run_key,[]);groups.get(j.run_key).push(j);
  }
  const rows=[];
  for(const r of runs.records){
    if(r.status==='not_executed')continue;
    const gold=cases.get(r.case_id).gold.issues;
    const atoms=[...(groups.get(r.run_key)||[])];
    for(const f of r.findings)if(!atoms.some(a=>a.finding_id===f.id))atoms.push({finding_id:f.id,root_id:`unjudged:${f.id}`,verdict:'unresolved',gold_issue_id:null,location_acceptable:null,severity_acceptable:null});
    const declaredRoots=new Map();
    for(const a of atoms){const label=`${a.verdict}/${a.gold_issue_id}`;if(declaredRoots.has(a.root_id))assert.equal(declaredRoots.get(a.root_id),label,'Same declared root has conflicting verdicts');else declaredRoots.set(a.root_id,label);}
    const roots=new Map();
    for(const a of atoms){
      // A known gold cause is one root even if the annotator gave duplicates different local root IDs.
      const key=a.verdict==='gold'?`gold:${a.gold_issue_id}`:`other:${a.root_id}`;
      if(roots.has(key))assert.equal(roots.get(key).verdict,a.verdict,'Duplicate root has conflicting judgments');else roots.set(key,a);
    }
    const claims=[...roots.values()],tp=claims.filter(x=>x.verdict==='gold'||x.verdict==='novel').length;
    const unresolved=claims.filter(x=>x.verdict==='unresolved').length;
    const hits=claims.filter(x=>x.verdict==='gold').length,novel=claims.filter(x=>x.verdict==='novel').length;
    const clean=gold.length===0;
    rows.push({run_key:r.run_key,case_id:r.case_id,family_id:r.family_id,category:r.category,condition:r.review_condition,trial:r.trial_id,status:r.status,
      frozen_gold:gold.length,hits,tp,fp:claims.length-tp-unresolved,unresolved,claims:claims.length,duplicates:atoms.length-claims.length,novel,
      recall:ratio(hits,gold.length),precision_lower:ratio(tp,claims.length),precision_upper:ratio(tp+unresolved,claims.length),
      clean_eligible:clean&&novel===0&&unresolved===0,clean_reclassification_needed:clean&&novel>0,
      clean_success:clean&&novel===0&&unresolved===0?(r.status==='complete'&&claims.length===0?1:0):null,
      latency_ms:r.latency_ms,cost_usd:r.cost_usd,input_tokens:r.input_tokens,output_tokens:r.output_tokens,
      location:claims.filter(x=>x.verdict==='gold'||x.verdict==='novel').map(x=>x.location_acceptable),severity:claims.filter(x=>x.verdict==='gold'||x.verdict==='novel').map(x=>x.severity_acceptable)});
  }
  const conditions={};
  for(const condition of plan.config.conditions){
    const rs=rows.filter(r=>r.condition===condition);const sum=k=>rs.reduce((a,r)=>a+r[k],0);
    const caseMacro=k=>mean([...new Set(rs.map(r=>r.case_id))].map(id=>mean(rs.filter(r=>r.case_id===id).map(r=>r[k]))));
    const lat=rs.map(r=>r.latency_ms).sort((a,b)=>a-b),quant=p=>lat.length?lat[Math.ceil(p*lat.length)-1]:null;
    conditions[condition]={started:rs.length,not_executed:runs.records.filter(r=>r.review_condition===condition&&r.status==='not_executed').length,
      calls_known_subtotal:rs.reduce((n,r)=>n+(rowMap.get(r.run_key).calls??0),0),calls_unknown_runs:rs.filter(r=>rowMap.get(r.run_key).calls===null).length,
      status_counts:Object.fromEntries(['complete','partial','failed','not_applicable'].map(s=>[s,rs.filter(r=>r.status===s).length])),
      frozen_gold:sum('frozen_gold'),hits:sum('hits'),tp:sum('tp'),fp:sum('fp'),unresolved:sum('unresolved'),novel:sum('novel'),duplicate_atoms:sum('duplicates'),
      micro_recall:ratio(sum('hits'),sum('frozen_gold')),macro_recall:caseMacro('recall'),
      precision:sum('unresolved')?null:ratio(sum('tp'),sum('claims')),
      precision_bounds:[ratio(sum('tp'),sum('claims')),ratio(sum('tp')+sum('unresolved'),sum('claims'))],
      macro_precision_lower:caseMacro('precision_lower'),macro_precision_upper:caseMacro('precision_upper'),
      clean_success:caseMacro('clean_success'),clean_eligible_runs:rs.filter(r=>r.clean_eligible).length,clean_unresolved_runs:rs.filter(r=>!r.frozen_gold&&r.unresolved>0).length,clean_reclassification_needed:rs.filter(r=>r.clean_reclassification_needed).length,
      latency_p50_ms:quant(.5),latency_p95_ms:quant(.95),timeout_rate:ratio(rs.filter(r=>rowMap.get(r.run_key).error==='worker_timeout'||rowMap.get(r.run_key).raw_file&&require('./data.cjs').read(require('node:path').join(dir,rowMap.get(r.run_key).raw_file)).omissions?.some(o=>o.reason==='TIMEOUT')).length,rs.length),
      cost_basis:'configured-rate estimate; not provider invoice',cost_known_subtotal_usd:rs.reduce((a,r)=>a+(r.cost_usd??0),0),cost_unknown_runs:rs.filter(r=>r.cost_usd===null).length,
      input_tokens_known_subtotal:rs.reduce((a,r)=>a+(r.input_tokens??0),0),input_tokens_unknown_runs:rs.filter(r=>r.input_tokens===null).length,
      output_tokens_known_subtotal:rs.reduce((a,r)=>a+(r.output_tokens??0),0),output_tokens_unknown_runs:rs.filter(r=>r.output_tokens===null).length,
      location_accuracy:mean(rs.flatMap(r=>r.location).filter(x=>x!==null).map(Number)),severity_agreement:mean(rs.flatMap(r=>r.severity).filter(x=>x!==null).map(Number))};
  }
  const bootstrap={};
  for(const category of ['all','cross-file','diff-sufficient']){
    const families=[...new Set(rows.filter(r=>r.frozen_gold>0&&(category==='all'||r.category===category)).map(r=>r.family_id))];
    const diffs=families.map(f=>{
      const r=rows.filter(x=>x.family_id===f&&x.frozen_gold>0);
      const a=r.filter(x=>x.condition===plan.config.conditions[0]),b=r.filter(x=>x.condition===plan.config.conditions[1]);
      if(a.length!==plan.config.trials||b.length!==plan.config.trials)return null;
      return mean(b.map(x=>x.recall))-mean(a.map(x=>x.recall));
    });
    if(!complete || diffs.includes(null)||families.length<2){bootstrap[category]={family_count:families.length,delta:null,ci95:null,reason:'Incomplete paired plan or fewer than two faulty families'};continue;}
    const rng=random(plan.config.seed),samples=[];
    const strata=new Map();
    families.forEach((f,i)=>{const key=rows.find(r=>r.family_id===f).category;if(!strata.has(key))strata.set(key,[]);strata.get(key).push(diffs[i]);});
    for(let i=0;i<2000;i++){const sampled=[];for(const group of strata.values())sampled.push(...group.map(()=>group[Math.floor(rng()*group.length)]));samples.push(mean(sampled));}
    samples.sort((a,b)=>a-b);bootstrap[category]={family_count:families.length,delta:mean(diffs),ci95:[samples[49],samples[1949]],method:'paired family bootstrap within category strata, trial means first; 2000 resamples',warning:'Small synthetic family count; interval does not prove generalization'};
  }
  return {schema_version:1,plan_id:plan.plan_id,provider_kind:runs.provider_kind,purpose:plan.config.purpose,evaluation_scope:runs.evaluation_scope,output_boundary:runs.output_boundary,
    evidence_status:runs.provider_kind==='scripted'?'PLUMBING_CONTROL_NOT_MODEL_EVIDENCE':plan.config.purpose==='formal'&&complete&&!rows.some(r=>r.unresolved||r.clean_reclassification_needed)?'FORMAL_COMPONENT_RESULTS':'EXPLORATORY_OR_INCOMPLETE',
    paired_plan_complete:complete,conditions,paired_recall:bootstrap,rows,
    limitations:['Synthetic cases only; no real-PR generalization','Family labels may remain provisional; see run records','No product gate/UX/human-efficiency conclusions','No mixed-scope F1; novel precision and frozen recall are intentionally separate']};
}
module.exports={score,template};
