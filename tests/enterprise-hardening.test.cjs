const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const plan=require('../.test-build/lib/enterprise/plan');
const C=require('../.test-build/lib/enterprise/contract');
const I=require('../.test-build/lib/enterprise/controlling/import-model-calls');

// Hardening from the security review J-02 ("beim Einbinden beachten") and the review of #108.
const LIMITS={maxSteps:10,maxDepth:4,budgetCents:10000};
const META={messageId:'msg_1',correlationId:'cor_1',from:'executive',idempotencyKey:'k',createdAt:'2026-11-01T07:00:00Z'};
const planWith=extra=>plan.validatePlan({goal:'x',steps:[{id:'s',department:'opportunity',taskKind:'opportunity.research',dependsOn:[],maxCostCents:0,maxModelCalls:0,...extra}],expectedValue:null,costCapCents:5000},LIMITS);
const envelope=()=>{const built=C.envelopeFromStep(planWith({maxCostCents:300,maxModelCalls:5}).executable[0],META);assert.equal(built.ok,true);return built.envelope;};
const ok=(extra={})=>({status:'succeeded',output:{},usedCostCents:0,usedModelCalls:0,evidence:[],...extra});

test('model calls per step are bounded, the same bound in plan and contract (J-02 H-1)',()=>{
  assert.equal(plan.MAX_MODEL_CALLS,C.MAX_MODEL_CALLS);
  assert.equal(planWith({maxModelCalls:plan.MAX_MODEL_CALLS}).ok,true);
  assert.equal(planWith({maxModelCalls:plan.MAX_MODEL_CALLS+1}).ok,false);
  const env=envelope();
  assert.equal(C.checkEnvelope({...env,budget:{...env.budget,maxModelCalls:C.MAX_MODEL_CALLS+1}}).ok,false);
  assert.equal(C.checkEnvelope({...env,budget:{...env.budget,maxCostCents:2**53}}).ok,false,'unsafe integer amount');
  assert.equal(C.checkEnvelope(env).ok,true);
});

test('task results: safe integers, bounded evidence and reason, at most 64 KiB – usage is kept for settling (J-02 H-2)',()=>{
  const env=envelope();
  assert.equal(C.checkResult(ok(),env).ok,true);
  assert.equal(C.checkResult(ok({usedCostCents:2**53}),env).ok,false);
  assert.equal(C.checkResult(ok({evidence:Array.from({length:C.MAX_EVIDENCE+1},()=>({claim:'x',kind:'assumption'}))}),env).ok,false);
  assert.equal(C.checkResult({status:'failed',failureClass:'provider_error',reason:'x'.repeat(2001),usedCostCents:0,usedModelCalls:0},env).ok,false);
  const big=C.checkResult(ok({output:{text:'ä'.repeat(C.MAX_OUTPUT_BYTES)},usedCostCents:120,usedModelCalls:1}),env);
  assert.equal(big.ok,false);
  assert.match(big.reason,/größer als 65536 Byte/);
  assert.deepEqual(big.usage,{usedCostCents:120,usedModelCalls:1},'the real usage still settles the reservation');
  assert.equal(C.checkResult(ok({output:{text:'a'.repeat(C.MAX_OUTPUT_BYTES-100)}}),env).ok,true,'just below the limit is accepted');
});

test('the importer takes the price catalogue lock of E-02 for every provider and model, sorted, before reading a price (review #108)',async()=>{
  assert.equal(I.priceCatalogLockKey('replicate','openai/gpt-4.1'),'price-catalog:replicate:openai/gpt-4.1','same key as addPrice/endPrice in E-02');
  const db=await pgliteDatabase();
  for(const [provider,model] of [['replicate','zeta'],['replicate','alpha'],['replicate','zeta']])
    await db.query(`INSERT INTO model_calls(agent,model,provider,ok,latency_ms,input_tokens,output_tokens,created_at) VALUES('content_text',$1,$2,true,1,10,1,'2026-10-19T08:00:00Z')`,[model,provider]);
  await db.query(`INSERT INTO price_catalog(id,provider,item,unit,price_micros,valid_from,source_url,entered_by) VALUES($1,'replicate','alpha','input_token',2,'2026-10-01','https://x.example','op')`,[crypto.randomUUID()]);
  const seen=[];
  const recording={...db,transaction:fn=>db.transaction(sql=>fn({...sql,query:(text,values)=>{seen.push([text,values]);return sql.query(text,values);}}))};
  const result=await I.importModelCalls(recording);
  assert.equal(result.calls,3);
  const locks=seen.filter(([text])=>/pg_advisory_xact_lock/.test(text)).map(([,values])=>values[0]);
  assert.deepEqual(locks,['price-catalog:replicate:alpha','price-catalog:replicate:zeta'],'one lock per pair, sorted');
  const firstPrice=seen.findIndex(([text])=>/FROM price_catalog/.test(text));
  const lastLock=seen.map(([text])=>/pg_advisory_xact_lock/.test(text)).lastIndexOf(true);
  assert.ok(lastLock<firstPrice,'all locks before the first price lookup');
  seen.length=0;
  await db.query(`INSERT INTO price_catalog(id,provider,item,unit,price_micros,valid_from,source_url,entered_by) VALUES($1,'replicate','zeta','input_token',3,'2026-10-01','https://x.example','op')`,[crypto.randomUUID()]);
  assert.equal((await I.repriceModelCallEntries(recording)).repriced,2);
  assert.deepEqual(seen.filter(([text])=>/pg_advisory_xact_lock/.test(text)).map(([,values])=>values[0]),['price-catalog:replicate:zeta']);
  await db.close();
});
