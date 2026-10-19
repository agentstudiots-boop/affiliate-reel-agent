const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const {envelopeFromStep}=require('../.test-build/lib/enterprise/contract');
const R=require('../.test-build/lib/enterprise/tasks/repository');

const T0=new Date('2026-11-02T08:00:00Z');
const at=minutes=>new Date(T0.getTime()+minutes*60_000);
const LEASE=5*60_000;
let counter=0;
function envelope(taskKind='controlling.monthly_close',extra={}){
  const department=taskKind.split('.')[0];
  const plan=validatePlan({goal:'x',steps:[{id:'s',department,taskKind,dependsOn:[],maxCostCents:300,maxModelCalls:2}],expectedValue:null,costCapCents:300},{maxSteps:5,maxDepth:3,budgetCents:1000});
  const built=envelopeFromStep(plan.executable[0],{messageId:`m${++counter}`,correlationId:'c',from:'executive',idempotencyKey:`k${counter}`,createdAt:T0.toISOString(),...extra});
  assert.equal(built.ok,true,built.reason);return built.envelope;
}
const ok={status:'succeeded',output:{rows:3},usedCostCents:100,usedModelCalls:1,evidence:[]};
const events=async(db,id)=>(await db.query('SELECT seq,kind FROM enterprise_task_events WHERE task_id=$1 ORDER BY seq',[id])).rows.map(r=>`${r.seq}:${r.kind}`);
const task=async(db,id)=>(await db.query('SELECT status,attempts,fencing_token,lease_holder,failure_class,output FROM enterprise_tasks WHERE id=$1',[id])).rows[0];

test('enqueue accepts only checked L0–L2 envelopes and is idempotent (AC-1)',async()=>{
  const db=await pgliteDatabase();
  const env=envelope();
  const first=await R.enqueueTask(db,{envelope:env,createdBy:'executive'},T0);
  assert.equal(first.created,true);
  assert.deepEqual(await R.enqueueTask(db,{envelope:env,createdBy:'executive'},T0),{id:first.id,created:false});
  assert.deepEqual(await events(db,first.id),['1:created']);
  await assert.rejects(R.enqueueTask(db,{envelope:{...envelope('opportunity.research'),idempotencyKey:env.idempotencyKey},createdBy:'executive'},T0),/anderen Aufgabe/);
  await assert.rejects(R.enqueueTask(db,{envelope:{...envelope(),permissionLevel:'L3b'},createdBy:'executive'},T0),R.RepositoryError);
  await assert.rejects(R.enqueueTask(db,{envelope:{...envelope(),taskKind:'affiliate.publication_request',to:'affiliate',handlerId:'affiliate.publicationRequest',permissionLevel:'L3b'},createdBy:'executive'},T0),/nie als Aufgabe ausführbar/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM enterprise_tasks')).rows[0].n,1);
  await db.close();
});

test('a lease is exclusive, fenced and needed for every state change (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const {id}=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'},T0);
  const lease=await R.leaseNext(db,'worker-a',T0,LEASE);
  assert.deepEqual([lease.id,lease.fencingToken,lease.attempts,lease.envelope.taskKind],[id,1,1,'controlling.monthly_close']);
  assert.equal(await R.leaseNext(db,'worker-b',T0,LEASE),null,'nothing else to lease');
  assert.equal(await R.startTask(db,{...lease,holder:'worker-b'},at(1)),false,'foreign holder');
  assert.equal(await R.startTask(db,{...lease,fencingToken:0},at(1)),false,'old token');
  assert.equal(await R.startTask(db,lease,at(1)),true);
  assert.equal(await R.heartbeat(db,lease,at(4),LEASE),true);
  assert.deepEqual(await R.completeTask(db,{...lease,fencingToken:2},ok,at(5)),{ok:false,reason:'stale_lease'});
  assert.deepEqual(await R.completeTask(db,lease,ok,at(6)),{ok:true,outcome:'succeeded'});
  const done=await task(db,id);
  assert.deepEqual([done.status,done.lease_holder,done.output.output],['succeeded',null,{rows:3}]);
  assert.deepEqual(await R.completeTask(db,lease,ok,at(6)),{ok:false,reason:'stale_lease'},'second completion changes nothing');
  assert.deepEqual(await events(db,id),['1:created','2:leased','3:started','4:succeeded']);
  for(const bad of [0,-1,NaN,16*60_000])await assert.rejects(R.leaseNext(db,'w',T0,bad),R.RepositoryError);
  await db.close();
});

test('an expired lease cannot commit after reclaim; the next worker gets a higher token (AC-3)',async()=>{
  const db=await pgliteDatabase();
  const {id}=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',maxAttempts:2},T0);
  const slow=await R.leaseNext(db,'worker-a',T0,LEASE);
  assert.equal(await R.startTask(db,slow,at(1)),true);
  assert.deepEqual(await R.completeTask(db,slow,ok,at(6)),{ok:false,reason:'stale_lease'},'expired even before reclaim');
  assert.deepEqual(await R.reclaimExpired(db,at(6)),{requeued:[id],dead:[],expired:[]});
  const fresh=await R.leaseNext(db,'worker-b',at(7),LEASE);
  assert.ok(fresh.fencingToken>slow.fencingToken);
  assert.equal(fresh.attempts,2);
  assert.deepEqual(await R.completeTask(db,slow,ok,at(8)),{ok:false,reason:'stale_lease'});
  assert.equal(await R.heartbeat(db,slow,at(8),LEASE),false);
  // Second expiry with no attempts left: dead for manual review.
  assert.deepEqual(await R.reclaimExpired(db,at(20)),{requeued:[],dead:[id],expired:[]});
  assert.deepEqual([(await task(db,id)).status,(await task(db,id)).failure_class],['dead','internal']);
  assert.equal(await R.leaseNext(db,'worker-c',at(21),LEASE),null);
  await db.close();
});

test('outcome_unknown is never retried; provider errors retry while attempts remain (AC-4)',async()=>{
  const db=await pgliteDatabase();
  const unknown=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',maxAttempts:3},T0);
  const lease=await R.leaseNext(db,'w',T0,LEASE);
  const outcome={status:'failed',failureClass:'outcome_unknown',reason:'Antwort unklar',usedCostCents:300,usedModelCalls:2};
  assert.deepEqual(await R.completeTask(db,lease,outcome,at(1)),{ok:true,outcome:'outcome_unknown'});
  assert.equal((await task(db,unknown.id)).status,'outcome_unknown');
  assert.equal(await R.leaseNext(db,'w',at(2),LEASE),null,'never leased again');

  const flaky=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',maxAttempts:2},T0);
  const provider={status:'failed',failureClass:'provider_error',reason:'HTTP 503',usedCostCents:0,usedModelCalls:1};
  assert.deepEqual(await R.completeTask(db,await R.leaseNext(db,'w',at(3),LEASE),provider,at(3)),{ok:true,outcome:'requeued'});
  assert.deepEqual(await R.completeTask(db,await R.leaseNext(db,'w',at(4),LEASE),provider,at(4)),{ok:true,outcome:'failed'});
  assert.deepEqual([(await task(db,flaky.id)).status,(await task(db,flaky.id)).failure_class,(await task(db,flaky.id)).attempts],['failed','provider_error',2]);

  const invalid=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',maxAttempts:3},T0);
  assert.deepEqual(await R.completeTask(db,await R.leaseNext(db,'w',at(5),LEASE),{...provider,failureClass:'invalid_input'},at(5)),{ok:true,outcome:'failed'});
  assert.equal((await task(db,invalid.id)).status,'failed','invalid input is not retried');
  await db.close();
});

test('results over budget are failed with their real usage; outbox only with a success, in the same transaction (AC-5)',async()=>{
  const db=await pgliteDatabase();
  const over=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'},T0);
  const draft=[{kind:'whatsapp.notify_operator',payload:{text:'x'},idempotencyKey:'notify-1'}];
  assert.deepEqual(await R.completeTask(db,await R.leaseNext(db,'w',T0,LEASE),{...ok,usedCostCents:301},at(1),draft),{ok:true,outcome:'failed'});
  const row=await task(db,over.id);
  assert.deepEqual([row.status,row.failure_class,row.output.usage],['failed','budget_exhausted',{usedCostCents:301,usedModelCalls:1}]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM enterprise_outbox')).rows[0].n,0);

  const good=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'},T0);
  const lease=await R.leaseNext(db,'w',at(2),LEASE);
  assert.deepEqual(await R.completeTask(db,lease,ok,at(3),draft),{ok:true,outcome:'succeeded'});
  const outbox=(await db.query('SELECT task_id,status,fencing_token FROM enterprise_outbox')).rows;
  assert.deepEqual(outbox.map(r=>[r.task_id,r.status,Number(r.fencing_token)]),[[good.id,'pending',lease.fencingToken]]);

  // A failing outbox insert rolls back the whole completion.
  const third=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'},T0);
  const lease3=await R.leaseNext(db,'w',at(4),LEASE);
  await assert.rejects(R.completeTask(db,lease3,ok,at(5),draft));
  assert.equal((await task(db,third.id)).status,'leased');
  assert.deepEqual(await events(db,third.id),['1:created','2:leased']);
  await db.close();
});

test('registry changes, deadlines and cancellation stop queued tasks (AC-6)',async()=>{
  const db=await pgliteDatabase();
  const tampered=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',priority:10},T0);
  await db.query(`UPDATE enterprise_tasks SET input=jsonb_set(input,'{handlerId}','"affiliate.publicationRequest"') WHERE id=$1`,[tampered.id]);
  const normal=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'},T0);
  const lease=await R.leaseNext(db,'w',T0,LEASE);
  assert.equal(lease.id,normal.id,'the tampered task is skipped');
  assert.deepEqual([(await task(db,tampered.id)).status,(await task(db,tampered.id)).failure_class],['failed','invalid_input']);
  assert.deepEqual(await events(db,tampered.id),['1:created','2:rejected_on_lease']);

  const late=await R.enqueueTask(db,{envelope:envelope('controlling.monthly_close',{deadline:at(10).toISOString()}),createdBy:'executive'},T0);
  assert.deepEqual((await R.reclaimExpired(db,at(11))).expired,[late.id]);
  assert.equal((await task(db,late.id)).failure_class,'deadline_exceeded');

  const cancel=await R.enqueueTask(db,{envelope:envelope(),createdBy:'operator'},T0);
  assert.equal(await R.cancelTask(db,cancel.id,'operator',at(1)),true);
  assert.equal(await R.cancelTask(db,cancel.id,'operator',at(1)),false);
  assert.equal(await R.cancelTask(db,lease.id,'operator',at(1)),false,'a leased task is not cancelled here');
  await db.close();
});

test('repository is not wired into app code and imports only the contract and the db type (AC-7)',()=>{
  const source=fs.readFileSync('lib/enterprise/tasks/repository.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../../memory/db','../contract','node:crypto']);
  assert.match(source,/import type \{ Database, Sql \} from "\.\.\/\.\.\/memory\/db"/);
  assert.doesNotMatch(source,/process\.env|fetch\(|getDatabase|now\(\)|new Date\(\)/);
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&!full.startsWith(path.join('lib','enterprise')))walk(full);}
    else if(/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)&&/enterprise\/tasks/.test(fs.readFileSync(full,'utf8')))users.push(full);
  }};
  walk('app');walk('lib');if(fs.existsSync('scripts'))walk('scripts');
  assert.deepEqual(users,[]);
});
