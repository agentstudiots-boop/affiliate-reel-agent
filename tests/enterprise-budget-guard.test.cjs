const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const {envelopeFromStep}=require('../.test-build/lib/enterprise/contract');
const R=require('../.test-build/lib/enterprise/tasks/repository');
const B=require('../.test-build/lib/enterprise/tasks/budget');

let counter=0;
async function runningTask(db,{maxCostCents=500,maxAttempts=1,priority=0}={}){
  const plan=validatePlan({goal:'x',steps:[{id:'s',department:'opportunity',taskKind:'opportunity.research',dependsOn:[],maxCostCents,maxModelCalls:5}],expectedValue:null,costCapCents:maxCostCents},{maxSteps:5,maxDepth:3,budgetCents:10_000});
  const built=envelopeFromStep(plan.executable[0],{messageId:`m${++counter}`,correlationId:'c',from:'executive',idempotencyKey:`k${counter}`,createdAt:new Date().toISOString()});
  const {id}=await R.enqueueTask(db,{envelope:built.envelope,createdBy:'executive',maxAttempts,priority});
  const lease=await R.leaseNext(db,'w',5*60_000);
  assert.equal(lease.id,id,'leased the new task');
  assert.equal(await R.startTask(db,lease),true);
  return lease;
}
const reserve=(db,lease,amountCents,limitCents=1000)=>B.reserveBudget(db,lease,{amountCents,limitCents});
const dbPeriod=async db=>(await db.query("SELECT to_char(now() AT TIME ZONE 'Europe/Berlin','YYYY-MM') AS p")).rows[0].p;
const reservations=async db=>(await db.query('SELECT status,amount_cents,settled_amount_cents FROM budget_reservations ORDER BY created_at,id')).rows
  .map(r=>[r.status,Number(r.amount_cents),r.settled_amount_cents===null?null:Number(r.settled_amount_cents)]);
const expire=(db,id)=>db.query("UPDATE enterprise_tasks SET lease_until=now() - interval '1 second' WHERE id=$1",[id]);
const failingEvents=db=>({...db,transaction:fn=>db.transaction(sql=>fn({...sql,query:(text,values)=>/INSERT INTO enterprise_task_events/.test(text)?Promise.reject(new Error('Ereignis fehlgeschlagen')):sql.query(text,values)}))});

test('period is the Berlin calendar month (AC-1)',()=>{
  assert.equal(B.periodOf(new Date('2026-10-31T22:30:00Z')),'2026-10'); // 23:30 in Berlin (winter time)
  assert.equal(B.periodOf(new Date('2026-10-31T23:30:00Z')),'2026-11'); // already 1 November in Berlin
  assert.equal(B.periodOf(new Date('2026-12-31T23:30:00Z')),'2027-01');
});

test('a reservation needs the current lease of a running task, a valid request and room in both budgets (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const lease=await runningTask(db,{maxCostCents:500});
  for(const bad of [{amountCents:0},{amountCents:-5},{amountCents:1.5},{limitCents:NaN},{limitCents:-1}])
    assert.equal((await B.reserveBudget(db,lease,{amountCents:100,limitCents:1000,...bad})).reason,'invalid_request',JSON.stringify(bad));
  assert.equal((await reserve(db,{id:'00000000-0000-4000-8000-000000000000',holder:'w',fencingToken:1},100)).reason,'task_not_running');
  const first=await reserve(db,lease,300);
  assert.deepEqual([first.ok,first.reservation.department,first.committedCents],[true,'opportunity',300]);
  const period=first.reservation.period;
  assert.equal(period,await dbPeriod(db),'the budget month comes from the database clock (Europe/Berlin)');
  const overTask=await reserve(db,lease,201);
  assert.deepEqual([overTask.ok,overTask.reason],[false,'budget_exhausted'],'task budget 500');
  const other=await runningTask(db,{maxCostCents:5000});
  const overMonth=await B.reserveBudget(db,other,{amountCents:701,limitCents:1000,period:'2031-01'});
  assert.deepEqual([overMonth.ok,overMonth.reason,overMonth.committedCents,overMonth.limitCents],[false,'budget_exhausted',300,1000],'a period from the caller is ignored');
  assert.equal((await reserve(db,other,700)).ok,true,'exactly up to the limit');
  assert.equal(await B.committedBudget(db,'opportunity',period),1000);
  assert.equal(await B.committedBudget(db,'opportunity','2031-01'),0);
  const third=await runningTask(db,{maxCostCents:5000});
  await expire(db,third.id);
  assert.equal((await reserve(db,third,1,5000)).reason,'task_not_running','an expired lease cannot reserve');
  await db.close();
});

test('a worker that lost its lease can neither reserve nor settle or release; a leased but unstarted task cannot reserve (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const stale=await runningTask(db,{maxCostCents:5000,maxAttempts:3});
  const held=(await reserve(db,stale,100,5000)).reservation;
  await expire(db,stale.id);
  await R.reclaimExpired(db);
  await db.query("UPDATE enterprise_tasks SET status='queued',failure_class=NULL WHERE id=$1",[stale.id]); // operator re-queued after review
  const fresh=await R.leaseNext(db,'w2',5*60_000);
  assert.equal(fresh.id,stale.id);
  assert.ok(fresh.fencingToken>stale.fencingToken);
  assert.equal((await reserve(db,fresh,10,5000)).reason,'task_not_running','leased, not started');
  assert.equal(await R.startTask(db,fresh),true);
  assert.equal((await reserve(db,stale,10,5000)).reason,'task_not_running','the old worker is fenced off');
  assert.equal((await reserve(db,{...fresh,holder:'w'},10,5000)).reason,'task_not_running','holder must match');
  const mine=(await reserve(db,fresh,10,5000)).reservation;
  assert.equal(await B.settleReservation(db,stale,mine.id,10),false);
  assert.equal(await B.releaseReservation(db,stale,mine.id),false);
  assert.equal(await B.releaseReservation(db,fresh,held.id),false,'the old attempt\'s disputed reservation is not freed');
  assert.equal(await B.settleReservation(db,fresh,mine.id,8),true);
  await db.close();
});

test('settled amounts count as spent, released ones free the budget, overspend stays visible (AC-3)',async()=>{
  const db=await pgliteDatabase();
  const lease=await runningTask(db,{maxCostCents:5000});
  const a=(await reserve(db,lease,400)).reservation;
  const b=(await reserve(db,lease,400)).reservation;
  assert.equal(await B.settleReservation(db,lease,a.id,650),true,'real cost above the reservation is recorded');
  assert.equal(await B.settleReservation(db,lease,a.id,10),false,'only once');
  assert.equal(await B.releaseReservation(db,lease,b.id),true);
  assert.equal(await B.committedBudget(db,'opportunity',a.period),650);
  assert.equal((await reserve(db,lease,351)).ok,false);
  assert.equal(await B.settleReservation(db,lease,b.id,1),false,'released cannot be settled');
  // The task budget counts the real cost of what was settled: 650 of 5000 used, so 4351 no longer fits.
  assert.equal((await reserve(db,lease,4351,100_000)).reason,'budget_exhausted');
  assert.equal((await reserve(db,lease,4350,100_000)).ok,true,'exactly the rest fits');
  await db.close();
});

test('unclear outcomes dispute the reservation; it keeps counting and is never released (AC-4)',async()=>{
  const db=await pgliteDatabase();
  const lease=await runningTask(db);
  const r=(await reserve(db,lease,300)).reservation;
  assert.deepEqual(await R.completeTask(db,lease,{status:'failed',failureClass:'outcome_unknown',reason:'Antwort unklar',usedCostCents:300,usedModelCalls:1}),{ok:true,outcome:'outcome_unknown'});
  assert.deepEqual(await reservations(db),[['disputed',300,null]]);
  assert.equal(await B.releaseReservation(db,lease,r.id),false);
  assert.equal(await B.committedBudget(db,'opportunity',r.period),300);
  assert.equal(await B.resolveDispute(db,r.id,120),true,'only a real amount resolves it');
  assert.equal(await B.committedBudget(db,'opportunity',r.period),120);

  // A still reserved row of a task that ended in outcome_unknown can never be released.
  const lease2=await runningTask(db);
  const r2=(await reserve(db,lease2,100)).reservation;
  await db.query("UPDATE enterprise_tasks SET status='outcome_unknown',failure_class='outcome_unknown',lease_holder=NULL,lease_until=NULL WHERE id=$1",[lease2.id]);
  assert.equal(await B.releaseReservation(db,lease2,r2.id),false);
  await db.close();
});

test('task results settle open reservations in the same transaction; lost workers dispute them (AC-5)',async()=>{
  const db=await pgliteDatabase();
  const lease=await runningTask(db,{maxCostCents:500});
  await reserve(db,lease,200);
  await reserve(db,lease,100);
  assert.deepEqual(await R.completeTask(db,lease,{status:'succeeded',output:{n:1},usedCostCents:180,usedModelCalls:2,evidence:[]}),{ok:true,outcome:'succeeded'});
  assert.deepEqual(await reservations(db),[['settled',200,180],['settled',100,0]]);

  const over=await runningTask(db,{maxCostCents:500});
  await reserve(db,over,500,5000);
  await R.completeTask(db,over,{status:'succeeded',output:{},usedCostCents:900,usedModelCalls:1,evidence:[]});
  assert.deepEqual((await reservations(db))[2],['settled',500,900],'overspend is settled at the real amount');

  const lost=await runningTask(db,{maxAttempts:2});
  await reserve(db,lost,50,5000);
  await expire(db,lost.id);
  assert.deepEqual((await R.reclaimExpired(db)).unknown,[lost.id]);
  assert.deepEqual((await reservations(db))[3],['disputed',50,null]);

  // A failing transaction leaves the reservation untouched.
  const rolled=await runningTask(db,{priority:10});
  await reserve(db,rolled,70,5000);
  await assert.rejects(R.completeTask(failingEvents(db),rolled,{status:'succeeded',output:{},usedCostCents:70,usedModelCalls:1,evidence:[]}),/Ereignis fehlgeschlagen/);
  assert.deepEqual((await reservations(db))[4],['reserved',70,null]);
  await db.close();
});

test('budget guard is not wired into app code and uses only the database clock (AC-6)',()=>{
  const source=fs.readFileSync('lib/enterprise/tasks/budget.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../../memory/db','node:crypto']);
  assert.doesNotMatch(source,/process\.env|fetch\(|getDatabase|new Date\(\)|Date\.now|now: Date/);
});
