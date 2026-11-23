'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {prepare}=require('../adapters/bailian-prepare.cjs');
const {validateBaseURL,REGIONS}=require('../adapters/bailian-config.cjs');
const {configCheck}=require('../lib/plan.cjs');
const {load,inputFor}=require('../lib/data.cjs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'.cache/bailian-test-provider.cjs');
// DNS-shaped fixture only: transport below is an in-memory fetch, never a model call.
const baseURL='https://offline-test.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const draft=prepare('pilot',baseURL,null,output),plugin=require(output);
const options=()=>({signal:new AbortController().signal,timeout:30000,maxRetries:0,maxOutputTokens:800});
const envelope={id:'offline-only',model:draft.model,choices:[{finish_reason:'stop',message:{content:'{"reviews":[]}',reasoning_content:'provider extension retained'}}],usage:{prompt_tokens:12,completion_tokens:3}};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});

test('only explicit official workspace endpoints pass, before credential lookup',()=>{
 for (const region of REGIONS) assert.equal(validateBaseURL(`https://offline-test.${region}.maas.aliyuncs.com/compatible-mode/v1/`).region,region);
 for (const endpoint of [undefined,'','https://api.relaycore.cn/v1','https://dashscope.aliyuncs.com/compatible-mode/v1',
   baseURL.replace('https:','http:'),baseURL.replace('offline-test.','user:secret@offline-test.'),
   baseURL+'?key=x',baseURL+'#x',baseURL.replace('.com/','.com:443/'),baseURL.replace('.com/','.com.evil.invalid/'),
   baseURL.replace('cn-beijing','invalid-region'),baseURL.replace('/v1','/%76%31'),baseURL.replace('offline-test.','a.b.')]) {
  assert.throws(()=>validateBaseURL(endpoint),/endpoint/);
  assert.throws(()=>plugin.createClient({...draft,base_url:endpoint}),/endpoint/);
 }
 assert.throws(()=>plugin.createClient({...draft,model:'deepseek-flash'}),/snapshot model/);
 assert.throws(()=>plugin.createClient({...draft,budget:{...draft.budget,maxRetries:2}}),/budget/);
 // Child environment is explicit and contains no inherited credential; never inspect parent's secret.
 const missing=spawnSync(process.execPath,['-e',`const p=require(${JSON.stringify(output)});try{p.createClient(${JSON.stringify(draft)})}catch(e){console.log(e.message);process.exit(0)}process.exit(1)`],
  {encoding:'utf8',env:{PATH:process.env.PATH}});
 assert.equal(missing.status,0,missing.stderr);assert.match(missing.stdout,/DASHSCOPE_API_KEY is not configured/);
});

test('prepare pins model, parameters, regional CNY list estimate; draft has no approved cap',()=>{
 assert.equal(draft.limits.max_cost,null);assert.equal(draft.pricing.currency,'CNY');assert.throws(()=>configCheck(draft));
 assert.equal(draft.effective_parameters.enable_thinking,false);assert.equal(draft.effective_parameters.thinking,undefined);
 assert.equal(draft.effective_parameters.max_tokens,800);assert.equal(draft.effective_parameters.maxRetries,0);
 assert.equal(draft.budget.maxRetries,1);assert.equal(draft.budget.requestTimeoutMs,30000);
 for (const profile of ['pilot','development']) {
  const c=prepare(profile,baseURL,{max_cost:1},output);configCheck(c);
  const runs=profile==='pilot'?12:40;
  assert.equal(c.limits.max_runs,runs);assert.equal(c.limits.max_tokens,runs*c.budget.maxCalls*(c.budget.maxInputTokens+800));
  assert(c.limits.max_wall_ms>runs*c.limits.worker_timeout_ms);
 }
 assert.equal(draft.case_ids.length,6);
 const sg=prepare('pilot',baseURL.replace('cn-beijing','ap-southeast-1'),null,output);
 assert.equal(sg.pricing.input_per_million,2.188);assert.equal(sg.pricing.output_per_million,8.75);
 assert.equal(draft.pricing.input_per_million,2);assert.equal(draft.pricing.output_per_million,8);
 assert.throws(()=>prepare('pilot',baseURL,{max_cost:0},output),/positive/);
 assert(plugin.countInputTokens('Review this change')>=64);assert.equal(plugin.metadata.token_count_is_exact,false);
});

test('real SDK sends top-level enable_thinking and preserves full provider response',async()=>{
 let calls=0;
 const client=new plugin.BailianModelClient('synthetic-offline-key',baseURL,async(url,init)=>{
  calls++;assert.equal(String(url),baseURL+'/chat/completions');
  const body=JSON.parse(init.body);
  assert.deepEqual(body,{model:draft.model,enable_thinking:false,response_format:{type:'json_object'},max_tokens:800,messages:[{role:'user',content:'JSON review'}]});
  assert.equal(body.thinking,undefined);assert.equal(body.extra_body,undefined);
  return response(envelope);
 });
 const raw=await client.completeReview('JSON review',options());assert.deepEqual(raw,envelope);assert.equal(calls,1);
 await assert.rejects(()=>client.completeReview('x',{...options(),maxRetries:1}),/budget/);assert.equal(calls,1);
});

test('SDK has zero hidden retries; production C owns one transient retry',async()=>{
 let calls=0;
 const client=new plugin.BailianModelClient('synthetic-offline-key',baseURL,async()=>{calls++;return response({error:{message:'offline failure'}},503);});
 await assert.rejects(()=>client.completeReview('JSON review',options()));assert.equal(calls,1);
 calls=0;
 const {evaluate}=require('../.cache/production.cjs');
 const result=await evaluate({input:inputFor(root,load(root)[0]),condition:'B1',config:draft,opaque_id:'offline-retry'},
  {...plugin,createClient:()=>client});
 assert.equal(calls,2);assert.equal(result.metrics.calls,2);assert.notEqual(result.analysis_status,'COMPLETE');
 assert.equal(result.raw.length,2);
});

test('actual B/C bridge uses all 20 development cases and preserves model/reasoning evidence',async()=>{
 const {evaluate}=require('../.cache/production.cjs');
 const config=prepare('development',baseURL,null,output);let crossfile=0;
 for (const row of load(root)) {
  let calls=0;
  const client=new plugin.BailianModelClient('synthetic-offline-key',baseURL,async(_url,init)=>{
   calls++;assert(JSON.parse(init.body).messages[0].content.includes('Public behavioral requirement'));return response(envelope);
  });
  for (const condition of ['B1','B2']) {
   const result=await evaluate({input:inputFor(root,row),condition,config,opaque_id:row.case.case_id},{...plugin,createClient:()=>client});
   assert.equal(result.analysis_status,'COMPLETE',JSON.stringify(result.omissions));assert.equal(result.metrics.calls,1);
   assert.equal(result.raw[0].response.model,draft.model);assert.equal(result.raw[0].response.choices[0].message.reasoning_content,envelope.choices[0].message.reasoning_content);
   assert.equal(result.metrics.effectiveParameters.enable_thinking,false);
   if(condition==='B1')assert.equal(result.snippets.length,0);
   else {assert(result.snippets.length>0);if(result.snippets.some(s=>s.reason==='direct-definition'))crossfile++;}
  }
  assert.equal(calls,2);
 }
 assert.equal(crossfile,8);
});

test('real worker uses cached tokenizer and real SDK with in-memory fetch only',()=>{
 const wrapper=path.join(root,'.cache/bailian-worker-scripted.cjs');
 fs.writeFileSync(wrapper,`const p=require('./bailian-test-provider.cjs');module.exports={...p,createClient:c=>new p.BailianModelClient('synthetic-offline-key',c.base_url,async()=>new Response(${JSON.stringify(JSON.stringify(envelope))},{headers:{'content-type':'application/json'}}))};`);
 try {
  const run=spawnSync(process.execPath,[path.join(root,'lib/worker.cjs'),wrapper,path.join(root,'.cache/production.cjs')],{
   cwd:path.join(root,'.cache'),encoding:'utf8',env:{PATH:process.env.PATH},
   input:JSON.stringify({input:inputFor(root,load(root)[0]),condition:'B2',config:draft,opaque_id:'bailian-worker-offline'}),timeout:30000});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.equal(result.analysis_status,'COMPLETE');assert(result.snippets.some(s=>s.reason==='direct-definition'));
  assert(result.metrics.attempts[0].estimatedInputTokens>=64);assert.equal(result.raw[0].response.model,draft.model);
 } finally {fs.unlinkSync(wrapper);}
});
