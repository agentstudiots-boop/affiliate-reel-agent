// Load test of the task ledger (B-03) and the budget guard (B-05/B-09) under real parallelism (task J-04).
//
// PGlite runs every query on one connection, so the J-01/J-03 tests cannot show races between transactions. This file runs
// the real modules against a real Postgres with a connection pool and many concurrent workers. It is skipped unless
// J04_DATABASE_URL is set, and it refuses any server that is not local (Unix socket or localhost): it must never reach Neon
// or Production. It needs a fresh, throwaway database (the migrations write to schema public) and refuses one that already
// holds tasks. Only tests; nothing is wired in.
//
//   J04_DATABASE_URL='postgresql://postgres@/postgres?host=/tmp/j04-pg' node --test tests/enterprise-load-postgres.test.cjs
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {Pool}=require('pg');

const URL_ENV=process.env.J04_DATABASE_URL;
const skip=URL_ENV?false:'J04_DATABASE_URL nicht gesetzt (Lasttest nur gegen eine lokale Postgres-Instanz)';

function assertLocal(url){
  // Same parser as pg itself, so the check sees exactly the host pg connects to.
  const host=String(require('pg-connection-string').parse(url).host??'');
  const local=host.startsWith('/')||['localhost','127.0.0.1','::1'].includes(host);
  if(!local)throw new Error('J-04 läuft nur gegen eine lokale Instanz (Unix-Socket oder localhost)');
}

const WORKERS=16;
let pool,db,M,R,B,D,plan,contract;

function database(p){
  return {
    query:(sql,values)=>p.query(sql,values),
    exec:sql=>p.query(sql),
    async transaction(fn){
      const client=await p.connect();
      try{
        await client.query('BEGIN');
        const result=await fn({query:(sql,values)=>client.query(sql,values),exec:sql=>client.query(sql)});
        await client.query('COMMIT');
        return result;
      }catch(error){await client.query('ROLLBACK');throw error;}
      finally{client.release();}
    },
  };
}

before(async()=>{
  if(skip)return;
  assertLocal(URL_ENV);
  M=require('../.test-build/lib/memory/migrations');
  R=require('../.test-build/lib/enterprise/tasks/repository');
  B=require('../.test-build/lib/enterprise/tasks/budget');
  D=require('../.test-build/lib/enterprise/decisions');
  plan=require('../.test-build/lib/enterprise/plan');
  contract=require('../.test-build/lib/enterprise/contract');
  pool=new Pool({connectionString:URL_ENV,max:WORKERS+4});
  db=database(pool);
  await M.applyMigrations(db);
  const existing=Number((await db.query('SELECT count(*) AS n FROM enterprise_tasks')).rows[0].n);
  if(existing>0)throw new Error('J-04 braucht eine frische Datenbank (enterprise_tasks ist nicht leer)');
});
after(async()=>{if(pool)await pool.end();});

const LIMITS={maxSteps:5,maxDepth:3,budgetCents:1_000_000};
const OPERATOR='491701234567';
let counter=0;
async function enqueue({maxCostCents=0,maxAttempts=1}={}){
  const p=plan.validatePlan({goal:'l',steps:[{id:'s',department:'opportunity',taskKind:'opportunity.research',dependsOn:[],maxCostCents,maxModelCalls:10}],
    expectedValue:null,costCapCents:maxCostCents},LIMITS);
  const built=contract.envelopeFromStep(p.executable[0],{messageId:`m${++counter}`,correlationId:'load',from:'executive',idempotencyKey:`load-${counter}`,
    createdAt:new Date().toISOString()});
  return (await R.enqueueTask(db,{envelope:built.envelope,createdBy:'executive',maxAttempts})).id;
}
async function approveBudget(limitCents){
  const period=(await db.query("SELECT to_char(now() AT TIME ZONE 'Europe/Berlin','YYYY-MM') AS p")).rows[0].p;
  const step=plan.validatePlan({goal:'b',steps:[{id:'b',department:'executive',taskKind:'executive.budget_change',dependsOn:[],maxCostCents:0,maxModelCalls:0}],
    expectedValue:null,costCapCents:0},LIMITS).decisionRequests[0];
  const r=await D.requestDecision(db,{step,budget:{department:'opportunity',period,limitCents},subject:'Budget',options:[{id:'yes',label:'Ja'},{id:'no',label:'Nein'}]});
  const requestMessageId=`wamid.req.${crypto.randomUUID()}`;
  await D.attachRequestMessage(db,r.id,requestMessageId);
  const decided=await D.recordDecision(db,{authority:'whatsapp_operator',trustedWaId:OPERATOR,evidence:{channel:'whatsapp',messageId:`wamid.reply.${crypto.randomUUID()}`,
    replyToMessageId:requestMessageId,senderWaId:OPERATOR,body:'Freigeben'}});
  assert.equal(decided.ok,true);
  await db.query("INSERT INTO budgets(id,department,period,limit_cents,kind,approved_decision_id) VALUES($1,'opportunity',$2,$3,'hard',$4)",[crypto.randomUUID(),period,limitCents,r.id]);
  return period;
}
const ok=(usedCostCents=0)=>({status:'succeeded',output:{},usedCostCents,usedModelCalls:0,evidence:[]});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const parallel=(n,fn)=>Promise.all(Array.from({length:n},(_,i)=>fn(i)));
async function clearQueue(){await db.query("UPDATE enterprise_tasks SET status='cancelled',lease_holder=NULL,lease_until=NULL WHERE status IN ('queued','leased','running')");}

test('J-04 a: every task is leased and completed exactly once by many parallel workers',{skip},async()=>{
  await clearQueue();
  const N=300;
  const ids=new Set();
  for(let i=0;i<N;i++)ids.add(await enqueue());
  const done=[];
  const started=Date.now();
  await parallel(WORKERS,async w=>{
    for(;;){
      const lease=await R.leaseNext(db,`worker-${w}`,60_000);
      if(!lease)return;
      assert.equal(await R.startTask(db,lease),true);
      const result=await R.completeTask(db,lease,ok());
      assert.deepEqual(result,{ok:true,outcome:'succeeded'});
      done.push(lease.id);
    }
  });
  const ms=Date.now()-started;
  assert.equal(done.length,N,'no task lost, none done twice');
  assert.equal(new Set(done).size,N);
  for(const id of done)assert.ok(ids.has(id));
  const rows=(await db.query(`SELECT t.id,t.status,t.attempts,count(e.*) FILTER (WHERE e.kind='leased') AS leased,count(e.*) FILTER (WHERE e.kind='succeeded') AS succeeded,
      count(DISTINCT e.seq)=count(e.*) AS seq_unique FROM enterprise_tasks t JOIN enterprise_task_events e ON e.task_id=t.id WHERE t.id=ANY($1::uuid[]) GROUP BY t.id`,[[...ids]])).rows;
  for(const row of rows){
    assert.deepEqual([row.status,Number(row.attempts),Number(row.leased),Number(row.succeeded),row.seq_unique],['succeeded',1,1,1,true],row.id);
  }
  console.log(`# J-04 a: ${N} Aufgaben, ${WORKERS} Worker, ${ms} ms (${Math.round(N/(ms/1000))} Aufgaben/s)`);
});

test('J-04 b: expired leases are reclaimed in parallel; stale workers are fenced off and nothing completes twice',{skip},async()=>{
  await clearQueue();
  const N=120;
  const ids=[];
  for(let i=0;i<N;i++)ids.push(await enqueue({maxAttempts:5}));
  const outcomes={succeeded:0,stale:0};
  let reclaiming=true;
  const reclaimer=(async()=>{const reclaimed=[];while(reclaiming){const r=await R.reclaimExpired(db);reclaimed.push(...r.requeued,...r.dead,...r.unknown);await sleep(20);}return reclaimed;})();
  await parallel(WORKERS,async w=>{
    for(let idle=0;idle<20;){
      const lease=await R.leaseNext(db,`worker-${w}`,300);
      if(!lease){idle++;await sleep(30);continue;}
      idle=0;
      // Every third worker step is too slow: its lease runs out while it is still "leased", the reclaimer requeues the task.
      if((w+lease.fencingToken)%3===0)await sleep(400);
      const startedOk=await R.startTask(db,lease);
      // Others stall while running: the reclaimer marks the task outcome_unknown (never retried), their result is refused.
      if(startedOk&&(w+lease.fencingToken)%5===0)await sleep(400);
      const result=startedOk?await R.completeTask(db,lease,ok()):{ok:false,reason:'stale_lease'};
      if(result.ok){assert.equal(result.outcome,'succeeded');outcomes.succeeded++;}else outcomes.stale++;
    }
  });
  reclaiming=false;
  await reclaimer;
  const rows=(await db.query(`SELECT t.status,count(e.*) FILTER (WHERE e.kind='succeeded') AS succeeded,
      count(DISTINCT e.fencing_token) FILTER (WHERE e.kind='leased')=count(e.*) FILTER (WHERE e.kind='leased') AS tokens_unique
    FROM enterprise_tasks t JOIN enterprise_task_events e ON e.task_id=t.id WHERE t.id=ANY($1::uuid[]) GROUP BY t.id,t.status`,[ids])).rows;
  assert.equal(rows.length,N);
  const byStatus=rows.reduce((acc,row)=>{acc[row.status]=(acc[row.status]??0)+1;return acc;},{});
  for(const row of rows){
    assert.ok(Number(row.succeeded)<=1,'never two successes for one task');
    assert.equal(row.tokens_unique,true,'every lease has its own fencing token');
  }
  assert.ok(outcomes.stale>0,'the test really produced stale workers');
  assert.ok((byStatus.outcome_unknown??0)>0,'running tasks with an expired lease end as outcome_unknown');
  assert.equal(Number((await db.query(`SELECT count(*) AS n FROM enterprise_tasks WHERE id=ANY($1::uuid[]) AND status='outcome_unknown'
    AND EXISTS (SELECT 1 FROM enterprise_task_events e WHERE e.task_id=enterprise_tasks.id AND e.kind='succeeded')`,[ids])).rows[0].n),0,
    'an outcome_unknown task never also has a success');
  assert.equal(outcomes.succeeded,rows.filter(row=>Number(row.succeeded)===1).length,'each reported success is exactly one recorded success');
  // Running tasks whose lease expired become outcome_unknown (never retried automatically); the rest finish or die after 5 attempts.
  assert.equal(Number((await db.query("SELECT count(*) AS n FROM enterprise_tasks WHERE id=ANY($1::uuid[]) AND status IN ('queued','leased','running')",[ids])).rows[0].n),0);
  console.log(`# J-04 b: ${N} Aufgaben, Ergebnis ${JSON.stringify(byStatus)}, abgewiesene veraltete Worker ${outcomes.stale}`);
});

test('J-04 c: the monthly budget holds under many parallel reservations across tasks',{skip},async()=>{
  await clearQueue();
  const LIMIT=10_000,TASKS=60,AMOUNT=300;
  const period=await approveBudget(LIMIT);
  for(let i=0;i<TASKS;i++)await enqueue({maxCostCents:AMOUNT});
  const leases=[];
  for(let i=0;i<TASKS;i++){const lease=await R.leaseNext(db,`w${i}`,60_000);assert.equal(await R.startTask(db,lease),true);leases.push(lease);}
  const results=await parallel(TASKS,i=>B.reserveBudget(db,leases[i],{amountCents:AMOUNT}));
  const granted=results.filter(r=>r.ok).length;
  assert.equal(granted,Math.floor(LIMIT/AMOUNT),'exactly as many reservations as fit into the limit');
  assert.ok(results.filter(r=>!r.ok).every(r=>r.reason==='budget_exhausted'));
  const committed=await B.committedBudget(db,'opportunity',period);
  assert.ok(committed<=LIMIT,`committed ${committed} <= ${LIMIT}`);
  // Settle every granted reservation below its amount in parallel, then complete all tasks in parallel.
  await parallel(TASKS,async i=>{if(results[i].ok)assert.equal(await B.settleReservation(db,leases[i],results[i].reservation.id,AMOUNT-50),true);});
  await parallel(TASKS,async i=>assert.deepEqual(await R.completeTask(db,leases[i],ok(results[i].ok?AMOUNT-50:0)),{ok:true,outcome:'succeeded'}));
  assert.equal(await B.committedBudget(db,'opportunity',period),granted*(AMOUNT-50));
  console.log(`# J-04 c: ${TASKS} parallele Reservierungen à ${AMOUNT} ct gegen ${LIMIT} ct: ${granted} bewilligt, ${TASKS-granted} abgewiesen`);
});

test('J-04 d: parallel reservations of one task never exceed the task budget; a stale lease cannot reserve',{skip},async()=>{
  await clearQueue();
  const id=await enqueue({maxCostCents:500});
  const lease=await R.leaseNext(db,'w',60_000);
  assert.equal(lease.id,id);
  assert.equal(await R.startTask(db,lease),true);
  const results=await parallel(20,()=>B.reserveBudget(db,lease,{amountCents:100}));
  assert.equal(results.filter(r=>r.ok).length,5,'500 ct task budget / 100 ct = 5');
  const stale={...lease,fencingToken:lease.fencingToken-1};
  const staleResults=await parallel(5,()=>B.reserveBudget(db,stale,{amountCents:1}));
  assert.ok(staleResults.every(r=>!r.ok&&r.reason==='task_not_running'));
  assert.deepEqual(await R.completeTask(db,lease,ok(500)),{ok:true,outcome:'succeeded'});
});
