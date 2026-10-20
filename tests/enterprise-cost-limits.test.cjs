// Cost limits under retries and repetition (task J-03) with PGlite and the real modules: a task's budget covers all of its
// attempts at their real cost, the monthly budget holds across tasks and retries, and repeated or parallel calls never
// double-book. Only tests; the guard itself is lib/enterprise/tasks/budget.ts (B-05/B-09).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const {envelopeFromStep}=require('../.test-build/lib/enterprise/contract');
const R=require('../.test-build/lib/enterprise/tasks/repository');
const B=require('../.test-build/lib/enterprise/tasks/budget');
const D=require('../.test-build/lib/enterprise/decisions');

const LIMITS={maxSteps:5,maxDepth:3,budgetCents:100_000};
const OPERATOR='491701234567';
let counter=0;

async function approveBudget(db,limitCents,department='opportunity'){
  const period=(await db.query("SELECT to_char(now() AT TIME ZONE 'Europe/Berlin','YYYY-MM') AS p")).rows[0].p;
  const step=validatePlan({goal:'b',steps:[{id:'b',department:'executive',taskKind:'executive.budget_change',dependsOn:[],maxCostCents:0,maxModelCalls:0}],
    expectedValue:null,costCapCents:0},LIMITS).decisionRequests[0];
  const r=await D.requestDecision(db,{step,subjectKey:B.budgetSubjectKey(department,period,limitCents),subject:'Budget',options:[{id:'yes',label:'Ja'},{id:'no',label:'Nein'}]});
  const requestMessageId=`wamid.req.${crypto.randomUUID()}`;
  await D.attachRequestMessage(db,r.id,requestMessageId);
  const decided=await D.recordDecision(db,{authority:'whatsapp_operator',trustedWaId:OPERATOR,evidence:{channel:'whatsapp',messageId:`wamid.reply.${crypto.randomUUID()}`,
    replyToMessageId:requestMessageId,senderWaId:OPERATOR,body:'Freigeben'}});
  assert.equal(decided.ok,true);
  await db.query("INSERT INTO budgets(id,department,period,limit_cents,kind,approved_decision_id) VALUES($1,$2,$3,$4,'hard',$5)",[crypto.randomUUID(),department,period,limitCents,r.id]);
}
async function enqueue(db,{maxCostCents,maxAttempts=1}){
  const plan=validatePlan({goal:'r',steps:[{id:'s',department:'opportunity',taskKind:'opportunity.research',dependsOn:[],maxCostCents,maxModelCalls:10}],
    expectedValue:null,costCapCents:maxCostCents},LIMITS);
  const built=envelopeFromStep(plan.executable[0],{messageId:`m${++counter}`,correlationId:'c',from:'executive',idempotencyKey:`k${counter}`,createdAt:new Date().toISOString()});
  return (await R.enqueueTask(db,{envelope:built.envelope,createdBy:'executive',maxAttempts})).id;
}
async function startNext(db,holder='w'){
  const lease=await R.leaseNext(db,holder,60_000);
  assert.ok(lease,'a task is available');
  assert.equal(await R.startTask(db,lease),true);
  return lease;
}
const failed=(usedCostCents)=>({status:'failed',failureClass:'provider_error',reason:'Anbieter nicht erreichbar',usedCostCents,usedModelCalls:1});
const realSpend=async(db,taskId)=>Number((await db.query(`SELECT coalesce(sum(CASE WHEN status='settled' THEN settled_amount_cents ELSE amount_cents END),0)::bigint AS c
  FROM budget_reservations WHERE task_id=$1 AND status<>'released'`,[taskId])).rows[0].c);

test('a retried task can never spend more than its budget across all attempts, at real cost (J-03)',async()=>{
  const db=await pgliteDatabase();
  await approveBudget(db,10_000);
  const id=await enqueue(db,{maxCostCents:500,maxAttempts:3});
  // Attempt 1 reserves 100 but the provider bills 400 before failing; the task is requeued.
  const first=await startNext(db);
  assert.equal((await B.reserveBudget(db,first,{amountCents:100})).ok,true);
  assert.deepEqual(await R.completeTask(db,first,failed(400)),{ok:true,outcome:'requeued'});
  // Attempt 2 may only use what is really left: 500 - 400 = 100.
  const second=await startNext(db);
  assert.equal(second.id,id);
  const tooMuch=await B.reserveBudget(db,second,{amountCents:101});
  assert.deepEqual([tooMuch.ok,tooMuch.reason],[false,'budget_exhausted'],'the overspend of attempt 1 counts at its real amount');
  assert.equal((await B.reserveBudget(db,second,{amountCents:100})).ok,true);
  assert.deepEqual(await R.completeTask(db,second,failed(100)),{ok:true,outcome:'requeued'});
  const third=await startNext(db);
  assert.deepEqual([(await B.reserveBudget(db,third,{amountCents:1})).reason],['budget_exhausted'],'nothing left for attempt 3');
  assert.ok(await realSpend(db,id)<=500);
  await db.close();
});

test('the monthly budget holds across many tasks and retries; released amounts become free again (J-03)',async()=>{
  const db=await pgliteDatabase();
  await approveBudget(db,1_000);
  let reserved=0;
  for(let i=0;i<6;i++){
    await enqueue(db,{maxCostCents:400,maxAttempts:2});
    const lease=await startNext(db,`w${i}`);
    const result=await B.reserveBudget(db,lease,{amountCents:300});
    if(result.ok){reserved+=300;await R.completeTask(db,lease,failed(300));}
    else{assert.equal(result.reason,'budget_exhausted');await R.completeTask(db,lease,{status:'succeeded',output:{},usedCostCents:0,usedModelCalls:0,evidence:[]});}
  }
  assert.equal(reserved,900,'three reservations of 300 fit, the fourth would exceed 1 000');
  const period=(await db.query("SELECT to_char(now() AT TIME ZONE 'Europe/Berlin','YYYY-MM') AS p")).rows[0].p;
  assert.ok(await B.committedBudget(db,'opportunity',period)<=1_000);
  // A reservation released before the call (the call never happened) frees its amount again.
  await enqueue(db,{maxCostCents:100});
  const lease=await startNext(db,'w-release');
  const r=await B.reserveBudget(db,lease,{amountCents:100});
  assert.equal(r.ok,true);
  assert.equal(await B.releaseReservation(db,lease,r.reservation.id),true);
  assert.equal(await B.committedBudget(db,'opportunity',period),900);
  await db.close();
});

test('repeating a completion or reserving in parallel never double-books (J-03)',async()=>{
  const db=await pgliteDatabase();
  await approveBudget(db,1_000);
  const id=await enqueue(db,{maxCostCents:1_000});
  const lease=await startNext(db);
  // Parallel reservations against one task budget: never more than the budget in total.
  const results=await Promise.all(Array.from({length:8},()=>B.reserveBudget(db,lease,{amountCents:200})));
  assert.equal(results.filter(r=>r.ok).length,5);
  assert.ok(results.filter(r=>!r.ok).every(r=>r.reason==='budget_exhausted'));
  const done=await R.completeTask(db,lease,{status:'succeeded',output:{},usedCostCents:900,usedModelCalls:3,evidence:[]});
  assert.deepEqual(done,{ok:true,outcome:'succeeded'});
  const again=await R.completeTask(db,lease,{status:'succeeded',output:{},usedCostCents:900,usedModelCalls:3,evidence:[]});
  assert.equal(again.ok,false,'a second completion with the same lease is refused');
  assert.equal(await realSpend(db,id),900,'settled once: 900 on the first reservation, 0 on the rest');
  await db.close();
});
