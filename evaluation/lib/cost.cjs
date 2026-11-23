'use strict';
const assert=require('node:assert/strict');
// Scripted controls do not incur provider charges. Live rates retain their native currency.
const costCurrency=c=>c.provider_kind==='scripted'?'USD':c.pricing?.currency;
function costLimit(c){
  const currency=costCurrency(c),limits=c.limits;
  assert(['USD','CNY'].includes(currency),'Pricing currency must be USD or CNY');
  const generic=Object.hasOwn(limits,'max_cost'),legacy=Object.hasOwn(limits,'max_cost_usd');
  assert(generic||legacy,'A cost limit is required');
  if(generic)assert(Number.isFinite(limits.max_cost)&&limits.max_cost>=0,'max_cost must be a nonnegative number');
  if(legacy){
    assert.equal(currency,'USD','max_cost_usd is only valid for USD pricing; use max_cost');
    assert(Number.isFinite(limits.max_cost_usd)&&limits.max_cost_usd>=0,'max_cost_usd must be a nonnegative number');
    if(generic)assert.equal(limits.max_cost,limits.max_cost_usd,'Conflicting cost limits');
  }
  return generic?limits.max_cost:limits.max_cost_usd;
}
const usageCost=(c,input,output)=>c.provider_kind==='scripted'?0:input===null||output===null?null:
  (input*c.pricing.input_per_million+output*c.pricing.output_per_million)/1e6;
function verifyCost(record,c,expected){
  const currency=costCurrency(c);
  // Old USD receipts predate generic fields; no rewriting is needed to verify them.
  if(currency!=='USD'||Object.hasOwn(record,'cost_currency')||Object.hasOwn(record,'cost_amount')){
    assert.equal(record.cost_currency,currency,'Cost currency differs from frozen pricing');
    assert.equal(record.cost_amount,expected,'Cost record does not match usage/pricing');
  }
  assert.equal(record.cost_usd,currency==='USD'?expected:null,'USD cost record does not match usage/pricing');
}
module.exports={costCurrency,costLimit,usageCost,verifyCost};
