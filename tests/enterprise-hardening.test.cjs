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
  assert.equal(plan.MAX_MODEL_CALLS,C.MAX_MODEL_CALLS,'one definition, re-exported by the contract');
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
  // Limits on a result keep its usage (review #112): too many evidence items are rejected with usage, a long reason is shortened.
  const many=C.checkResult(ok({evidence:Array.from({length:C.MAX_EVIDENCE+1},()=>({claim:'x',kind:'assumption'})),usedCostCents:120,usedModelCalls:1}),env);
  assert.equal(many.ok,false);
  assert.deepEqual(many.usage,{usedCostCents:120,usedModelCalls:1});
  const long=C.checkResult({status:'failed',failureClass:'provider_error',reason:'x'.repeat(2506),usedCostCents:120,usedModelCalls:1},env);
  assert.equal(long.ok,true,'a long provider error is still a provider error');
  assert.equal(long.result.reason.length,C.MAX_REASON_CHARS);
  assert.equal(long.result.failureClass,'provider_error');
  const big=C.checkResult(ok({output:{text:'ä'.repeat(C.MAX_OUTPUT_BYTES)},usedCostCents:120,usedModelCalls:1}),env);
  assert.equal(big.ok,false);
  assert.match(big.reason,/größer als 65536 Byte/);
  assert.deepEqual(big.usage,{usedCostCents:120,usedModelCalls:1},'the real usage still settles the reservation');
  assert.equal(C.checkResult(ok({output:{text:'a'.repeat(C.MAX_OUTPUT_BYTES-100)}}),env).ok,true,'just below the limit is accepted');
});

test('a long provider error still settles and is retried, as before the bounds (review #112)',async()=>{
  const pgliteDatabase=require('./helpers/pglite-db.cjs');
  const R=require('../.test-build/lib/enterprise/tasks/repository');
  const B=require('../.test-build/lib/enterprise/tasks/budget');
  const db=await pgliteDatabase();
  const built=C.envelopeFromStep(planWith({maxCostCents:300,maxModelCalls:5}).executable[0],{...META,idempotencyKey:'retry'});
  const {id}=await R.enqueueTask(db,{envelope:built.envelope,createdBy:'executive',maxAttempts:2});
  const lease=await R.leaseNext(db,'w',60_000);
  assert.equal(lease.id,id);
  assert.equal(await R.startTask(db,lease),true);
  const D=require('../.test-build/lib/enterprise/decisions');
  const period=(await db.query("SELECT to_char(now() AT TIME ZONE 'Europe/Berlin','YYYY-MM') AS p")).rows[0].p;
  const step=plan.validatePlan({goal:'x',steps:[{id:'b',department:'executive',taskKind:'executive.budget_change',dependsOn:[],maxCostCents:0,maxModelCalls:0}],expectedValue:null,costCapCents:0},LIMITS).decisionRequests[0];
  const r=await D.requestDecision(db,{step,budget:{department:'opportunity',period,limitCents:1000},subject:'Budget',options:[{id:'y',label:'Ja'},{id:'n',label:'Nein'}]});
  await D.attachRequestMessage(db,r.id,'wamid.req');
  assert.equal((await D.recordDecision(db,{authority:'whatsapp_operator',trustedWaId:'491701234567',evidence:{channel:'whatsapp',messageId:'wamid.rep',replyToMessageId:'wamid.req',senderWaId:'491701234567',body:'Freigeben'}})).ok,true);
  await db.query("INSERT INTO budgets(id,department,period,limit_cents,kind,approved_decision_id) VALUES($1,'opportunity',$2,1000,'hard',$3)",[crypto.randomUUID(),period,r.id]);
  assert.equal((await B.reserveBudget(db,lease,{amountCents:200})).ok,true);
  const done=await R.completeTask(db,lease,{status:'failed',failureClass:'provider_error',reason:'x'.repeat(2506),usedCostCents:120,usedModelCalls:1});
  assert.deepEqual(done,{ok:true,outcome:'requeued'},'retried like any provider error');
  const res=(await db.query('SELECT status,settled_amount_cents FROM budget_reservations')).rows.map(x=>[x.status,Number(x.settled_amount_cents)]);
  assert.deepEqual(res,[['settled',120]],'settled at the real amount, not disputed');
  await db.close();
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
