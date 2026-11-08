'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {read,write,hash,load,inputFor}=require('../lib/data.cjs');
const {createPlan,verifyPlan}=require('../lib/plan.cjs');
const {runPlan,verifyRuns}=require('../lib/runner.cjs');
const {score,template}=require('../lib/score.cjs');
const root=path.resolve(__dirname,'..'),repo=path.dirname(root);
const bridgePath=path.join(root,'.cache/production.cjs');
const bridge=require(bridgePath);
const scripted=require('../adapters/scripted.cjs');
const config=()=>({...read(path.join(root,'config/offline.json')),case_ids:['DEV-001','DEV-002']});
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inspector-eval-check-'));try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
function fixture(dir,c=config()){
 const plan=createPlan(root,c,repo),out=path.join(dir,'run');
 runPlan(root,plan,out,path.join(root,'adapters/scripted.cjs'),bridgePath);return out;
}
function injectFinding(out,runKey,findings,status='complete'){
 const runs=read(path.join(out,'runs.json')),r=runs.records.find(r=>r.run_key===runKey),raw=read(path.join(out,r.raw_file));
 raw.findings=findings;raw.analysis_status=status.toUpperCase();write(path.join(out,r.raw_file),raw);
 r.findings=findings;r.status=status;r.raw_sha256=hash(fs.readFileSync(path.join(out,r.raw_file)));write(path.join(out,'runs.json'),runs);
}
const finding=(id='f1')=>({id,file:'review.js',side:'RIGHT',line:2,severity:'high',message:'Synthetic scoring control: enum coercion reverses access.',evidenceIds:[],validation:'VERIFIED'});
function adjudicate(labels,j,verdict,gold=null){return {...j,verdict,gold_issue_id:gold,evidence:'Synthetic unit-test judgment, not a human dataset sign-off',location_acceptable:true,severity_acceptable:true};}
function reviewedTemplate(out){const labels=template(root,out);labels.reviewer='synthetic-test-reviewer';labels.reviewed_at='2026-11-08T00:00:00Z';return labels;}

test('paired schedule deterministic, complete, and frozen against edits',()=>{
 const a=createPlan(root,config(),repo),b=createPlan(root,config(),repo);assert.deepEqual(a,b);assert.equal(a.pairs.length,2);
 const bad=structuredClone(a);bad.config.trials=2;assert.throws(()=>verifyPlan(bad,root),/changed/);
 const shorter=structuredClone(a);shorter.pairs.pop();delete shorter.plan_id;shorter.plan_id=hash(shorter);assert.throws(()=>verifyPlan(shorter,root),/Incomplete/);
});
test('formal protocol cannot run provisional development labels',()=>{
 const c=config();c.purpose='formal';assert.throws(()=>createPlan(root,c,repo));
});
test('actual B2 never silently falls back to oracle context',async()=>{
 const item=load(root)[0],payload={input:inputFor(root,item),condition:'B2',config:config(),opaque_id:'opaque'};
 await assert.rejects(()=>bridge.evaluate(payload,scripted),/actual B/);
});
test('bridge invokes real C with requirement in both modes and no labels in prompts',async()=>{
 const prompts=[];const plugin={...scripted,createClient:()=>({...scripted.createClient(),completeReview:async p=>{prompts.push(p);return scripted.createClient().completeReview(p);}})};
 const input=inputFor(root,load(root)[0]);
 for(const condition of ['B1','B2-oracle']){
   const r=await bridge.evaluate({input,condition,config:config(),opaque_id:'opaque'},plugin);
   assert.equal(r.analysis_status,'COMPLETE');assert.equal(r.metrics.calls,1);assert.deepEqual(r.findings,[]);
 }
 assert(prompts.every(p=>p.includes(input.requirement)));
 assert(prompts.every(p=>!p.includes('gold_issue_id')&&!p.includes('family_id')&&!p.includes('faulty')));
 assert(prompts[0].includes('"context":[]'));assert(prompts[1].includes('policy.js'));
});
test('B read port blocks sibling versions and rejects fabricated source snippets',async()=>{
 const input=inputFor(root,load(root)[0]);
 let blocked=false;
 const plugin={...scripted,metadata:{...scripted.metadata,context_kind:'actual-retrieval',context_version:'test-only'},collectContext:async(i,readFile)=>{
   await assert.rejects(()=>readFile('../gold/DEV-001.json',i.headSha));
   await assert.rejects(()=>readFile('policy.js',i.diffBaseSha));blocked=true;
   return {snippets:[{id:'x',file:'policy.js',ref:i.headSha,startLine:1,endLine:1,code:'invented',reason:'direct-definition'}],omissions:[]};
 }};
 await assert.rejects(()=>bridge.evaluate({input,condition:'B2',config:config(),opaque_id:'opaque'},plugin),/contradicts/);assert(blocked);
});
test('end-to-end offline C control keeps buggy misses and clean successes, never model evidence',()=>temp(dir=>{
 const out=fixture(dir),s=score(root,out,template(root,out));
 assert.equal(s.evidence_status,'PLUMBING_CONTROL_NOT_MODEL_EVIDENCE');assert.equal(s.paired_plan_complete,true);
 assert.equal(s.conditions.B1.micro_recall,0);assert.equal(s.conditions.B1.clean_success,1);assert.equal(s.conditions.B1.precision,null);
 assert.equal(s.conditions.B1.status_counts.complete,2);
}));
test('pair budget exhaustion creates not_executed for both modes, not false misses',()=>temp(dir=>{
 const c=config();c.limits.max_tokens=1;const out=fixture(dir,c),s=score(root,out,template(root,out));
 assert.equal(s.paired_plan_complete,false);assert.equal(s.conditions.B1.started,0);assert.equal(s.conditions.B1.micro_recall,null);
 assert.equal(s.conditions.B1.not_executed,2);assert.equal(s.paired_recall.all.delta,null);
}));
test('worker failure is recorded with unknown cost and retained in recall denominator',()=>temp(dir=>{
 const file=path.join(dir,'bad.cjs');fs.writeFileSync(file,"throw new Error('synthetic worker failure')");
 const out=path.join(dir,'run');runPlan(root,createPlan(root,config(),repo),out,file,bridgePath);
 const s=score(root,out,template(root,out));assert.equal(s.conditions.B1.status_counts.failed,2);assert.equal(s.conditions.B1.micro_recall,0);
 assert.equal(s.conditions.B1.clean_success,0);assert.equal(s.conditions.B1.cost_unknown_runs,2);
}));
test('raw output tamper and stale human judgments are rejected',()=>temp(dir=>{
 const out=fixture(dir),labels=template(root,out);injectFinding(out,'DEV-001/B1/1',[finding()]);
 assert.throws(()=>score(root,out,labels),/different run/);
 const r=read(path.join(out,'runs.json')).records[0];fs.appendFileSync(path.join(out,r.raw_file),' ');assert.throws(()=>verifyRuns(root,out),/changed/);
}));
test('same gold root duplicates count once, unresolved outputs create precision bounds',()=>temp(dir=>{
 const out=fixture(dir);injectFinding(out,'DEV-001/B1/1',[finding('f1'),finding('f2'),finding('f3')]);
 const labels=reviewedTemplate(out);labels.judgments=labels.judgments.map((j,i)=>i<2?adjudicate(labels,j,'gold','grant-enum-001'):j);
 const s=score(root,out,labels),b=s.conditions.B1;
 assert.equal(b.hits,1);assert.equal(b.tp,1);assert.equal(b.unresolved,1);assert.equal(b.duplicate_atoms,1);
 assert.equal(b.precision,null);assert.deepEqual(b.precision_bounds,[.5,1]);assert.equal(b.micro_recall,1);
}));
test('a novel clean-case defect triggers reclassification, not an automatic false positive',()=>temp(dir=>{
 const out=fixture(dir);injectFinding(out,'DEV-002/B1/1',[finding()]);const labels=reviewedTemplate(out);
 labels.judgments=labels.judgments.map(j=>adjudicate(labels,j,'novel'));
 const s=score(root,out,labels);assert.equal(s.conditions.B1.novel,1);assert.equal(s.conditions.B1.clean_reclassification_needed,1);
 assert.equal(s.conditions.B1.clean_success,null);assert.equal(s.conditions.B1.precision,1);
}));
test('out-of-scope claims count against actionable precision; missing labels stay unresolved',()=>temp(dir=>{
 const out=fixture(dir);injectFinding(out,'DEV-001/B1/1',[finding('f1'),finding('f2')]);const labels=reviewedTemplate(out);
 labels.judgments=[adjudicate(labels,labels.judgments[0],'out_of_scope')];
 const s=score(root,out,labels);assert.equal(s.conditions.B1.fp,1);assert.equal(s.conditions.B1.unresolved,1);assert.deepEqual(s.conditions.B1.precision_bounds,[0,.5]);
}));
test('repeat trials are averaged, never unioned into best-of-k recall',()=>temp(dir=>{
 const c=config();c.trials=3;const out=fixture(dir,c);injectFinding(out,'DEV-001/B1/1',[finding()]);const labels=reviewedTemplate(out);
 labels.judgments=labels.judgments.map(j=>adjudicate(labels,j,'gold','grant-enum-001'));
 const s=score(root,out,labels);assert.equal(s.conditions.B1.micro_recall,1/3);assert.equal(s.conditions.B1.macro_recall,1/3);
}));
test('blind packets hide condition/provider, and mapping round-trip preserves run identity',()=>temp(dir=>{
 const out=fixture(dir);injectFinding(out,'DEV-001/B1/1',[finding()]);const dest=path.join(dir,'blind');
 const cli=path.join(root,'cli.cjs');let r=spawnSync(process.execPath,[cli,'blind','--runs',out,'--out',dest],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const packets=fs.readFileSync(path.join(dest,'review/packets.json'),'utf8');assert(!packets.includes('/B1/')&&!packets.includes('B2-oracle')&&!packets.includes('provider_kind'));
 const labels=path.join(dir,'labels.json');r=spawnSync(process.execPath,[cli,'unblind','--mapping',path.join(dest,'private/mapping.json'),'--packets',path.join(dest,'review/packets.json'),'--out',labels],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 assert.equal(read(labels).judgments[0].run_key,'DEV-001/B1/1');assert.equal(score(root,out,read(labels)).conditions.B1.unresolved,1);
}));

test('paired recall interval resamples families within category and preserves condition pairing',()=>temp(dir=>{
 const c=config();c.case_ids=['DEV-001','DEV-003','DEV-005','DEV-007'];const out=fixture(dir,c);
 for(const id of ['DEV-001','DEV-003'])injectFinding(out,`${id}/B2-oracle/1`,[finding()]);
 const labels=reviewedTemplate(out);labels.judgments=labels.judgments.map(j=>adjudicate(labels,j,'gold',j.run_key.startsWith('DEV-001')?'grant-enum-001':'scheduler-units-001'));
 const s=score(root,out,labels);assert.equal(s.paired_recall.all.family_count,4);assert.equal(s.paired_recall.all.delta,.5);
 assert.deepEqual(s.paired_recall.all.ci95,[.5,.5]);assert.equal(s.paired_recall['cross-file'].delta,1);assert.equal(s.paired_recall['diff-sufficient'].delta,0);
}));
test('C invalid-response failures are never counted as clean successes',async()=>{
 const plugin={...scripted,createClient:()=>({...scripted.createClient(),completeReview:async()=>({choices:[{finish_reason:'stop',message:{content:'not JSON'}}],usage:{prompt_tokens:0,completion_tokens:0}})})};
 const input=inputFor(root,load(root)[1]);const r=await bridge.evaluate({input,condition:'B1',config:config(),opaque_id:'opaque'},plugin);
 assert.equal(r.analysis_status,'FAILED');assert.equal(r.findings.length,0);assert(r.omissions.some(o=>o.required));
});
test('live parameter mismatches are rejected before any provider request',async()=>{
 let calls=0;const c=config();c.provider_kind='live';c.tokenizer_id='test-tokenizer';c.prompt_version='inspector-c-v1+public-requirement-v1';c.model='requested-model';c.effective_parameters={model:'requested-model'};
 const plugin={...scripted,metadata:{kind:'live',version:'test-only',tokenizer_id:'test-tokenizer'},createClient:()=>({...scripted.createClient(),completeReview:async()=>{calls++;throw new Error('must not call');}})};
 await assert.rejects(()=>bridge.evaluate({input:inputFor(root,load(root)[0]),condition:'B1',config:c,opaque_id:'opaque'},plugin),/before invocation/);assert.equal(calls,0);
});
