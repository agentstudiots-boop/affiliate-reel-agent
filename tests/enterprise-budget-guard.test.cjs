const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const {envelopeFromStep}=require('../.test-build/lib/enterprise/contract');
const R=require('../.test-build/lib/enterprise/tasks/repository');
const B=require('../.test-build/lib/enterprise/tasks/budget');

const T0=new Date('2026-11-02T08:00:00Z');
const at=minutes=>new Date(T0.getTime()+minutes*60_000);
const PERIOD='2026-11';
let counter=0;
async function runningTask(db,{maxCostCents=500,maxAttempts=1,now=T0,priority=0}={}){
  const plan=validatePlan({goal:'x',steps:[{id:'s',department:'opportunity',taskKind:'opportunity.research',dependsOn:[],maxCostCents,maxModelCalls:5}],expectedValue:null,costCapCents:maxCostCents},{maxSteps:5,maxDepth:3,budgetCents:10_000});
  const built=envelopeFromStep(plan.executable[0],{messageId:`m${++counter}`,correlationId:'c',from:'executive',idempotencyKey:`k${counter}`,createdAt:now.toISOString()});
  const {id}=await R.enqueueTask(db,{envelope:built.envelope,createdBy:'executive',maxAttempts,priority},now);
  const lease=await R.leaseNext(db,'w',now,5*60_000);
  assert.equal(lease.id,id,'leased the new task');
  assert.equal(await R.startTask(db,lease,now),true);
  return lease;
}
const reservations=async db=>(await db.query('SELECT status,amount_cents,settled_amount_cents FROM budget_reservations ORDER BY created_at,id')).rows
  .map(r=>[r.status,r.amount_cents,r.settled_amount_cents]);

test('period is the Berlin calendar month (AC-1)',()=>{
  assert.equal(B.periodOf(new Date('2026-10-31T22:30:00Z')),'2026-10'); // 23:30 in Berlin (winter time)
  assert.equal(B.periodOf(new Date('2026-10-31T23:30:00Z')),'2026-11'); // already 1 November in Berlin
  assert.equal(B.periodOf(new Date('2026-12-31T23:30:00Z')),'2027-01');
});

test('a reservation needs a running task, a valid request and room in both budgets (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const lease=await runningTask(db,{maxCostCents:500});
  for(const bad of [{amountCents:0},{amountCents:-5},{amountCents:1.5},{limitCents:NaN},{limitCents:-1},{period:'2026-13'},{period:'11/2026'}])
    assert.equal((await B.reserveBudget(db,{taskId:lease.id,amountCents:100,limitCents:1000,period:PERIOD,...bad},T0)).reason,'invalid_request',JSON.stringify(bad));
  assert.equal((await B.reserveBudget(db,{taskId:'00000000-0000-4000-8000-000000000000',amountCents:100,limitCents:1000,period:PERIOD},T0)).reason,'task_not_running');
  const first=await B.reserveBudget(db,{taskId:lease.id,amountCents:300,limitCents:1000,period:PERIOD},T0);
  assert.deepEqual([first.ok,first.reservation.department,first.committedCents],[true,'opportunity',300]);
  const overTask=await B.reserveBudget(db,{taskId:lease.id,amountCents:201,limitCents:1000,period:PERIOD},T0);
  assert.deepEqual([overTask.ok,overTask.reason],[false,'budget_exhausted'],'task budget 500');
  const other=await runningTask(db,{maxCostCents:5000});
  const overMonth=await B.reserveBudget(db,{taskId:other.id,amountCents:701,limitCents:1000,period:PERIOD},T0);
  assert.deepEqual([overMonth.ok,overMonth.reason,overMonth.committedCents,overMonth.limitCents],[false,'budget_exhausted',300,1000]);
  assert.equal((await B.reserveBudget(db,{taskId:other.id,amountCents:700,limitCents:1000,period:PERIOD},T0)).ok,true,'exactly up to the limit');
  assert.equal(await B.committedBudget(db,'opportunity',PERIOD),1000);
  assert.equal(await B.committedBudget(db,'opportunity','2026-12'),0);
  await db.close();
});

test('settled amounts count as spent, released ones free the budget, overspend stays visible (AC-3)',async()=>{
  const db=await pgliteDatabase();
  const lease=await runningTask(db,{maxCostCents:5000});
  const a=(await B.reserveBudget(db,{taskId:lease.id,amountCents:400,limitCents:1000,period:PERIOD},T0)).reservation;
  const b=(await B.reserveBudget(db,{taskId:lease.id,amountCents:400,limitCents:1000,period:PERIOD},T0)).reservation;
  assert.equal(await B.settleReservation(db,a.id,650,at(1)),true,'real cost above the reservation is recorded');
  assert.equal(await B.settleReservation(db,a.id,10,at(1)),false,'only once');
  assert.equal(await B.releaseReservation(db,b.id,at(1)),true);
  assert.equal(await B.committedBudget(db,'opportunity',PERIOD),650);
  assert.equal((await B.reserveBudget(db,{taskId:lease.id,amountCents:351,limitCents:1000,period:PERIOD},T0)).ok,false);
  assert.equal(await B.settleReservation(db,b.id,1,at(2)),false,'released cannot be settled');
  await db.close();
});

test('unclear outcomes dispute the reservation; it keeps counting and is never released (AC-4)',async()=>{
  const db=await pgliteDatabase();
  const lease=await runningTask(db);
  const r=(await B.reserveBudget(db,{taskId:lease.id,amountCents:300,limitCents:1000,period:PERIOD},T0)).reservation;
  assert.deepEqual(await R.completeTask(db,lease,{status:'failed',failureClass:'outcome_unknown',reason:'Antwort unklar',usedCostCents:300,usedModelCalls:1},at(1)),{ok:true,outcome:'outcome_unknown'});
  assert.deepEqual(await reservations(db),[['disputed',300,null]]);
  assert.equal(await B.releaseReservation(db,r.id,at(2)),false);
  assert.equal(await B.committedBudget(db,'opportunity',PERIOD),300);
  assert.equal(await B.resolveDispute(db,r.id,120,at(3)),true,'only a real amount resolves it');
  assert.equal(await B.committedBudget(db,'opportunity',PERIOD),120);

  // A manually reserved row of a task that ended in outcome_unknown can never be released.
  const lease2=await runningTask(db);
  const r2=(await B.reserveBudget(db,{taskId:lease2.id,amountCents:100,limitCents:1000,period:PERIOD},T0)).reservation;
  await db.query("UPDATE budget_reservations SET status='reserved' WHERE id=$1",[r2.id]);
  await db.query("UPDATE enterprise_tasks SET status='outcome_unknown',failure_class='outcome_unknown',lease_holder=NULL,lease_until=NULL WHERE id=$1",[lease2.id]);
  assert.equal(await B.releaseReservation(db,r2.id,at(4)),false);
  await db.close();
});

test('task results settle open reservations in the same transaction; lost workers dispute them (AC-5)',async()=>{
  const db=await pgliteDatabase();
  const lease=await runningTask(db,{maxCostCents:500});
  await B.reserveBudget(db,{taskId:lease.id,amountCents:200,limitCents:1000,period:PERIOD},at(0.1));
  await B.reserveBudget(db,{taskId:lease.id,amountCents:100,limitCents:1000,period:PERIOD},at(0.2));
  assert.deepEqual(await R.completeTask(db,lease,{status:'succeeded',output:{n:1},usedCostCents:180,usedModelCalls:2,evidence:[]},at(1)),{ok:true,outcome:'succeeded'});
  assert.deepEqual(await reservations(db),[['settled',200,180],['settled',100,0]]);

  const over=await runningTask(db,{maxCostCents:500});
  await B.reserveBudget(db,{taskId:over.id,amountCents:500,limitCents:5000,period:PERIOD},at(0.3));
  await R.completeTask(db,over,{status:'succeeded',output:{},usedCostCents:900,usedModelCalls:1,evidence:[]},at(2));
  assert.deepEqual((await reservations(db))[2],['settled',500,900],'overspend is settled at the real amount');

  const lost=await runningTask(db,{maxAttempts:2});
  await B.reserveBudget(db,{taskId:lost.id,amountCents:50,limitCents:5000,period:PERIOD},at(0.4));
  assert.deepEqual((await R.reclaimExpired(db,at(10))).requeued,[lost.id]);
  assert.deepEqual((await reservations(db))[3],['disputed',50,null]);

  // A failing transaction leaves the reservation untouched.
  const rolled=await runningTask(db,{now:at(11),priority:10});
  await B.reserveBudget(db,{taskId:rolled.id,amountCents:70,limitCents:5000,period:PERIOD},at(11));
  const draft=[{kind:'x.y',payload:{},idempotencyKey:'dup'},{kind:'x.y',payload:{},idempotencyKey:'dup'}];
  await assert.rejects(R.completeTask(db,rolled,{status:'succeeded',output:{},usedCostCents:70,usedModelCalls:1,evidence:[]},at(12),draft));
  assert.deepEqual((await reservations(db))[4],['reserved',70,null]);
  await db.close();
});

test('budget guard is not wired into app code (AC-6)',()=>{
  const source=fs.readFileSync('lib/enterprise/tasks/budget.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../../memory/db','node:crypto']);
  assert.doesNotMatch(source,/process\.env|fetch\(|getDatabase|new Date\(\)/);
});
