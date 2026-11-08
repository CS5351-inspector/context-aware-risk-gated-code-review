#!/usr/bin/env node
'use strict';
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {read,write,hash,load,inputFor}=require('./lib/data.cjs');
const {createPlan,random}=require('./lib/plan.cjs');
const {runPlan,verifyRuns}=require('./lib/runner.cjs');
const {score,template}=require('./lib/score.cjs');
const root=__dirname,repo=path.dirname(root);
const [command,...args]=process.argv.slice(2);
function arg(name,required=true){const i=args.indexOf(name);if(i<0){if(required)throw new Error(`Missing ${name}`);return null;}assert(args[i+1]&&!args[i+1].startsWith('--'),`Missing value for ${name}`);return args[i+1];}
function save(file,value){assert(!fs.existsSync(file),'Refusing to overwrite existing evidence file');write(file,value);console.log(file);}
function report(s){
  const lines=['# Evaluation result',`Evidence: **${s.evidence_status}**`, `Scope: ${s.evaluation_scope}; boundary: ${s.output_boundary}`,`Paired plan complete: ${s.paired_plan_complete}`,'',
    '| Condition | Started | Recall (micro) | Precision | Precision bounds | Clean success | Known cost USD | Unknown cost runs |','| --- | --- | --- | --- | --- | --- | --- | --- |'];
  const fmt=n=>n===null?'N/A':typeof n==='number'?Number(n.toFixed(4)):n;
  for(const [k,v] of Object.entries(s.conditions))lines.push(`| ${k} | ${v.started} | ${fmt(v.micro_recall)} | ${fmt(v.precision)} | ${v.precision_bounds.map(fmt).join(' to ')} | ${fmt(v.clean_success)} | ${fmt(v.cost_known_subtotal_usd)} | ${v.cost_unknown_runs} |`);
  lines.push('','Full per-trial counts, status, latency, cost and family intervals are in summary.json.','',...s.limitations.map(x=>'- '+x),'');return lines.join('\n');
}
try{
 if(command==='plan')save(arg('--out'),createPlan(root,read(arg('--config')),repo));
 else if(command==='run'){
   const output=arg('--out'),adapter=arg('--adapter',false)||path.join(root,'adapters/scripted.cjs');
   const runs=runPlan(root,read(arg('--plan')),output,adapter,path.join(root,'.cache/production.cjs'),args.includes('--live'));
   console.log(JSON.stringify({output,records:runs.records.length,provider_kind:runs.provider_kind}));
 }else if(command==='labels')save(arg('--out'),template(root,arg('--runs')));
 else if(command==='score'){
   const output=arg('--out');assert(!fs.existsSync(output),'Summary output exists');const result=score(root,arg('--runs'),read(arg('--labels')));
   write(path.join(output,'summary.json'),result);fs.writeFileSync(path.join(output,'REPORT.md'),report(result));console.log(output);
 }else if(command==='blind'){
   const dir=arg('--runs'),output=arg('--out');assert(!fs.existsSync(output));
   const {plan,runs}=verifyRuns(root,dir),cases=new Map(load(root).map(r=>[r.case.case_id,r]));
   const rs=runs.records.filter(r=>r.status!=='not_executed'),rng=random(plan.config.seed+1);
   for(let i=rs.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[rs[i],rs[j]]=[rs[j],rs[i]];}
   const mapping={},packets=[];
   rs.forEach((r,i)=>{
     const review_id=`R${String(i+1).padStart(4,'0')}`,item=cases.get(r.case_id);mapping[review_id]=r.run_key;
     const input=inputFor(root,item);
     packets.push({review_id,requirement:input.requirement,diff:input.diff,head_files:input.files,gold_issues:item.gold.issues,
       findings:r.findings.map(f=>({id:f.id,file:f.file,side:f.side,line:f.line,message:f.message})),
       annotations:r.findings.map(f=>({finding_id:f.id,atom_id:'1',root_id:f.id,verdict:'unresolved',gold_issue_id:null,evidence:'',location_acceptable:null,severity_acceptable:null}))});
   });
   write(path.join(output,'private/mapping.json'),{plan_id:plan.plan_id,runs_sha256:hash(runs),mapping});
   write(path.join(output,'review/packets.json'),{reviewer:null,reviewed_at:null,packets});console.log('Share only review/; keep private/ and raw runs from graders.');
 }else if(command==='unblind'){
   const m=read(arg('--mapping')),packet=read(arg('--packets'));const seen=new Set(),judgments=[];
   for(const p of packet.packets){assert(m.mapping[p.review_id]&&!seen.has(p.review_id));seen.add(p.review_id);for(const j of p.annotations)judgments.push({...j,run_key:m.mapping[p.review_id]});}
   assert.equal(seen.size,Object.keys(m.mapping).length,'Missing review packet');
   save(arg('--out'),{schema_version:1,plan_id:m.plan_id,runs_sha256:m.runs_sha256,reviewer:packet.reviewer,reviewed_at:packet.reviewed_at,judgments});
 }else if(command==='review-template'){
   const id=arg('--case'),item=load(root).find(r=>r.case.case_id===id);assert(item,'Unknown case');
   const c=structuredClone(item.case);c.label_status='reviewed';
   save(arg('--out'),{case_id:id,content_sha256:hash({case:c,requirement:item.family.requirement,hashes:item.family.file_hashes,checks:item.family.behavior_checks,issues:item.gold.issues}),
     instructions:'Human reviewers must independently verify requirements, proof, clean/fixed, context necessity and severity. Fill reviewers and evidence, then upgrade ALL cases in this family atomically. Do not invent sign-offs.',
     reviews:[{reviewer:null,is_human:true,decision:'pending',reviewed_at:null,evidence:''},{reviewer:null,is_human:true,decision:'pending',reviewed_at:null,evidence:''}]});
 }else{
  console.log('Commands: plan --config FILE --out FILE; run --plan FILE --out DIR [--adapter FILE --live]; labels --runs DIR --out FILE; blind --runs DIR --out DIR; unblind --mapping FILE --packets FILE --out FILE; score --runs DIR --labels FILE --out DIR; review-template --case ID --out FILE');
  if(command)process.exitCode=1;
 }
}catch(e){console.error(e.message);process.exitCode=1;}
