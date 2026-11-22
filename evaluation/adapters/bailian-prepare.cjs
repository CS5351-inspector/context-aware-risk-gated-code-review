'use strict';
const fs=require('node:fs'),path=require('node:path');
const {hash}=require('../lib/data.cjs');
const {configCheck}=require('../lib/plan.cjs');
const {MODEL,EFFECTIVE_PARAMETERS,validateBaseURL}=require('./bailian-config.cjs');
const repo=path.resolve(__dirname,'../..');
function prepare(profile,baseURL,approval=null,output=path.join(repo,'evaluation/.cache/bailian-provider.cjs')) {
  if (!['pilot','development'].includes(profile)) throw new Error('Use pilot or development');
  const endpoint=validateBaseURL(baseURL);
  const assetDir=path.join(path.dirname(output),'assets/deepseek');
  fs.mkdirSync(assetDir,{recursive:true});
  for (const name of ['tokenizer.json.gz','tokenizer_config.json.gz'])
    fs.copyFileSync(path.join(repo,'assets/deepseek',name),path.join(assetDir,name));
  const contextVersion='sha256:'+hash(fs.readFileSync(path.join(repo,'src/review/context.ts')));
  require('esbuild').buildSync({entryPoints:[path.join(__dirname,'bailian-provider.ts')],bundle:true,
    platform:'node',format:'cjs',packages:'external',target:'node18',outfile:output,
    define:{BAILIAN_CONTEXT_VERSION:JSON.stringify(contextVersion)}});
  delete require.cache[require.resolve(output)];
  const provider=require(output),budget={...provider.sprintConfig.budget};
  const n=profile==='pilot'?6:20;
  const singapore=endpoint.region==='ap-southeast-1';
  const config={
    protocol_version:'eval-v0.2',purpose:'development',split:'development',conditions:['B1','B2'],
    trials:1,seed:5351,evaluation_scope:'component',output_boundary:'C.reviewFiles.validated-findings',
    provider_kind:'live',model:MODEL,base_url:endpoint.baseURL,
    effective_parameters:structuredClone(EFFECTIVE_PARAMETERS),tokenizer_id:provider.metadata.tokenizer_id,
    token_count_method:provider.metadata.token_count_method,token_count_is_exact:false,
    prompt_version:provider.PROMPT_VERSION+'+public-requirement-v1',context_version:contextVersion,
    adapter_sha256:hash(fs.readFileSync(output)),budget,
    limits:{max_runs:n*2,max_wall_ms:n*2*250000+60000,worker_timeout_ms:250000,
      max_tokens:n*2*budget.maxCalls*(budget.maxInputTokens+budget.reservedOutputTokens),max_cost:null},
    pricing:{model:MODEL,currency:'CNY',checked_at:'2026-11-22',
      input_per_million:singapore?2.188:2,output_per_million:singapore?8.75:8},
    pricing_source:'https://help.aliyun.cn/zh/model-studio/deepseek-v4-1-flash',
    pricing_basis:'Published regional peak uncached list rates; conservative estimate, not account billing or actual charges',
    formal_approval:null,
    ...(profile==='pilot'?{case_ids:['DEV-001','DEV-002','DEV-005','DEV-006','DEV-009','DEV-010']}:{}),
  };
  if (approval) {
    if (!(Number.isFinite(approval.max_cost)&&approval.max_cost>0)) throw new Error('Explicit positive approved max_cost in CNY required');
    config.limits.max_cost=approval.max_cost;
    configCheck(config);
  }
  return config;
}
if (require.main===module) {
  const [profile,baseURL,destination,approvalFile]=process.argv.slice(2);
  if (!destination) throw new Error('Usage: node evaluation/adapters/bailian-prepare.cjs pilot|development BASE_URL OUTPUT.json [APPROVED_CNY_CAP.json]');
  if (fs.existsSync(destination)) throw new Error('Refusing to overwrite configuration');
  const config=prepare(profile,baseURL,approvalFile?JSON.parse(fs.readFileSync(approvalFile,'utf8')):null);
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(config,null,2)+'\n');
  console.log(approvalFile?'Configuration prepared; freeze plan after review. No model call.':'DRAFT ONLY: CNY spending cap unset; planner rejects until supplied. No model call.');
}
module.exports={prepare};
