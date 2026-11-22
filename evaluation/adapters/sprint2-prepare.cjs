'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { hash } = require('../lib/data.cjs');
const { configCheck } = require('../lib/plan.cjs');
const repo = path.resolve(__dirname, '../..');
function prepare(profile = 'pilot', approval = null, output = path.join(repo, 'evaluation/.cache/sprint2-provider.cjs')) {
  if (!['pilot', 'development'].includes(profile)) throw new Error('Use pilot or development');
  const frozen = JSON.parse(fs.readFileSync(path.join(repo, 'docs/SPRINT2_MODEL_RELAYCORE_CONFIG.json'), 'utf8'));
  // The existing worker runs from the bridge directory, while C resolves assets from cwd.
  const assetDir=path.join(repo,'evaluation/.cache/assets/deepseek');
  fs.mkdirSync(assetDir,{recursive:true});
  for(const name of ['tokenizer.json.gz','tokenizer_config.json.gz'])
    fs.copyFileSync(path.join(repo,'assets/deepseek',name),path.join(assetDir,name));
  // C verifies the decompressed asset SHA-256 before use; never fabricate a tokenizer.
  const contextVersion = 'sha256:' + hash(fs.readFileSync(path.join(repo, 'src/review/context.ts')));
  require('esbuild').buildSync({entryPoints:[path.join(__dirname,'sprint2-provider.ts')], bundle:true,
    platform:'node',format:'cjs',packages:'external',target:'node18',outfile:output,
    define:{SPRINT2_CONTEXT_VERSION:JSON.stringify(contextVersion)}});
  const n = profile === 'pilot' ? 6 : 20;
  const config = {
    protocol_version:'eval-v0.2', purpose:'development', split:'development', conditions:['B1','B2'],
    trials:1,seed:5351,evaluation_scope:'component',output_boundary:'C.reviewFiles.validated-findings',
    provider_kind:'live', model:frozen.request.model, base_url:frozen.baseURL,
    effective_parameters:{...frozen.request,response_format:{type:frozen.responseFormat},maxRetries:0,max_tokens:frozen.budget.reservedOutputTokens},
    tokenizer_id:frozen.tokenizer, token_count_method:'model-content-tokenizer-plus-64-framing-allowance',
    token_count_is_exact:false,prompt_version:frozen.promptVersion+'+public-requirement-v1',
    context_version:contextVersion, adapter_sha256:hash(fs.readFileSync(output)),budget:frozen.budget,
    limits:{max_runs:n*2,max_wall_ms:n*2*250000+60000,worker_timeout_ms:250000,max_tokens:n*2*frozen.budget.maxCalls*(frozen.budget.maxInputTokens+frozen.budget.reservedOutputTokens),max_cost_usd:null},
    pricing:null,formal_approval:null,
    ...(profile === 'pilot' ? {case_ids:['DEV-001','DEV-002','DEV-005','DEV-006','DEV-009','DEV-010']} : {}),
  };
  if (approval) {
    if (!(Number.isFinite(approval.max_cost_usd) && approval.max_cost_usd > 0)) throw new Error('Explicit positive approved max_cost_usd required');
    if (!approval.pricing_source?.trim()) throw new Error('Record the account-specific pricing source; do not invent prices');
    config.pricing=approval.pricing;
    config.pricing_source=approval.pricing_source;
    config.limits.max_cost_usd=approval.max_cost_usd;
    configCheck(config);
  }
  return config;
}
if (require.main === module) {
  const [profile, destination, pricingFile] = process.argv.slice(2);
  if (!destination) throw new Error('Usage: node evaluation/adapters/sprint2-prepare.cjs pilot|development OUTPUT.json [APPROVED_PRICING.json]');
  if (fs.existsSync(destination)) throw new Error('Refusing to overwrite configuration');
  const config=prepare(profile,pricingFile?JSON.parse(fs.readFileSync(pricingFile,'utf8')):null);
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(config,null,2)+'\n');
  console.log(pricingFile?'Configuration prepared; freeze plan after review. No model call.':'DRAFT ONLY: pricing and spending cap unset; planner will reject until supplied. No model call.');
}
module.exports={prepare};
