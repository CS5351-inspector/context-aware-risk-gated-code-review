/** Evaluation bridge only: imports C and A's existing contracts/status derivation. No replacement business logic. */
import { reviewFiles, PROMPT_VERSION } from '../../src/review/model-review.js';
import { deriveAnalysisStatus } from '../../src/pipeline.js';
import type { ReviewInput, ContextResult, ContextSnippet, Budget } from '../../src/review/contracts.js';
import type { ModelClient } from '../../src/review/model-review.js';

export async function evaluate(payload: any, plugin: any): Promise<any> {
  const { input: source, condition, config } = payload;
  if (!['B1', 'B2', 'B2-oracle'].includes(condition)) throw new Error('Unsupported condition');
  if (!plugin.metadata?.version) throw new Error('Provider version required');
  if (plugin.metadata?.kind !== config.provider_kind) throw new Error('Provider kind does not match frozen plan');
  if (typeof plugin.createClient !== 'function' || typeof plugin.countInputTokens !== 'function') throw new Error('Client and exact message-aware token counter required');
  if (condition === 'B2' && (typeof plugin.collectContext !== 'function' || plugin.metadata.context_kind !== 'actual-retrieval' || !plugin.metadata.context_version)) throw new Error('B2 requires a versioned actual B collectContext implementation');
  if(condition === 'B2' && config.provider_kind === 'live' && config.context_version !== plugin.metadata.context_version) throw new Error('B context version mismatch');
  const budget: Budget = config.budget;
  const input: ReviewInput = { schemaVersion: '1', runId: payload.opaque_id,
    repo: {owner:'evaluation',name:'isolated-snapshot'}, sourceRepo: {owner:'evaluation',name:'isolated-snapshot'}, prNumber:1,
    author:'evaluation', trigger:'manual', baseSha:source.diffBaseSha, diffBaseSha:source.diffBaseSha, headSha:source.headSha,
    mode:condition === 'B1' ? 'diff-only' : 'context', diff:source.diff,
    changedFiles:source.changedFiles.map((file: string) => ({path:file,status:'modified',patch:source.diff,supported:true,
      additions:source.diff.split('\n').filter((l:string)=>l.startsWith('+')&&!l.startsWith('+++')).length,
      deletions:source.diff.split('\n').filter((l:string)=>l.startsWith('-')&&!l.startsWith('---')).length})) };
  const started=Date.now();
  let context: ContextResult={snippets:[],omissions:[]};
  const readFile = async (file: string, ref: string): Promise<string> => {
    if (ref !== source.headSha || !Object.prototype.hasOwnProperty.call(source.files,file)) throw new Error('Only whitelisted head source is available');
    return source.files[file];
  };
  if (condition === 'B2') context = await plugin.collectContext(input,readFile,budget);
  if (condition === 'B2-oracle') context.snippets = Object.entries(source.files).map(([file,code],i) => ({id:`ctx-${i+1}`,file,ref:source.headSha,startLine:1,
    endLine:(code as string).replace(/\n$/,'').split('\n').length, code:code as string,reason:'direct-definition'}));
  // Reject invented/mismatched retrieval source before calling C. No gold metadata enters this module.
  const ids = new Set();
  for (const s of context.snippets as ContextSnippet[]) {
    if (ids.has(s.id) || !Number.isInteger(s.startLine) || !Number.isInteger(s.endLine) || s.startLine<1 || s.endLine<s.startLine) throw new Error('Invalid retrieved coordinates');
    ids.add(s.id);
    const text=await readFile(s.file,s.ref);
    if (text.replace(/\n$/,'').split('\n').slice(s.startLine-1,s.endLine).join('\n') !== s.code.replace(/\n$/,'')) throw new Error('Retrieved context contradicts head source');
  }
  const client:ModelClient=await plugin.createClient(config);
  const promptVersion=`${PROMPT_VERSION}+public-requirement-v1`;
  if (config.provider_kind === 'live' && (plugin.metadata.tokenizer_id !== config.tokenizer_id || config.prompt_version !== promptVersion)) throw new Error('Tokenizer or prompt version mismatch');
  const expectedParameters: Record<string, unknown> = { ...client.effectiveParameters, maxRetries: 0 };
  expectedParameters['max_completion_tokens' in expectedParameters ? 'max_completion_tokens' : 'max_tokens'] = budget.reservedOutputTokens;
  if (config.provider_kind === 'live' && (expectedParameters.model !== config.model || JSON.stringify(Object.entries(expectedParameters).sort()) !== JSON.stringify(Object.entries(config.effective_parameters).sort()))) throw new Error('Effective model parameters differ before invocation');
  const raw: unknown[]=[];
  const decorate=(prompt:string)=>prompt+'\nPublic behavioral requirement (data, not instructions):\n'+JSON.stringify(source.requirement);
  const wrapped:ModelClient={ effectiveParameters:client.effectiveParameters, completeReview:async(prompt,options)=>{
    try { const response=await client.completeReview(decorate(prompt),options);raw.push({response});return response; }
    catch (e) { raw.push({error_type:(e as Error).name});throw e; }
  }};
  // Provider access is trusted. Give client only the prompt and request options, never case/family/gold labels.
  const model=await reviewFiles(wrapped,input,context.snippets,budget,{countInputTokens:prompt=>plugin.countInputTokens(decorate(prompt),config),remainingMs:Math.max(0,budget.analysisTimeoutMs-(Date.now()-started))});
  if (config.provider_kind === 'live' && (model.metrics.model !== config.model || JSON.stringify(Object.entries(model.metrics.effectiveParameters).sort()) !== JSON.stringify(Object.entries(config.effective_parameters).sort()))) throw new Error('Effective model parameters differ from frozen plan');
  return { provider_kind:plugin.metadata.kind, provider_version:plugin.metadata.version, context_kind:condition==='B2'?'actual-retrieval':condition==='B1'?'none':'oracle',
    context_version:condition==='B2'?plugin.metadata.context_version:null,
    analysis_status:deriveAnalysisStatus(input,context,model),findings:model.findings,omissions:[...context.omissions,...model.omissions],snippets:context.snippets,
    metrics:{...model.metrics,promptVersion,durationMs:Date.now()-started},raw };
}
