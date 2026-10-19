const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const {envelopeFromStep}=require('../.test-build/lib/enterprise/contract');
const R=require('../.test-build/lib/enterprise/tasks/repository');

const LEASE=5*60_000;
let counter=0;
function envelope(taskKind='controlling.monthly_close',extra={},{maxCostCents=300,maxModelCalls=2}={}){
  const department=taskKind.split('.')[0];
  const plan=validatePlan({goal:'x',steps:[{id:'s',department,taskKind,dependsOn:[],maxCostCents,maxModelCalls}],expectedValue:null,costCapCents:maxCostCents},{maxSteps:5,maxDepth:3,budgetCents:Math.max(1000,maxCostCents)});
  const built=envelopeFromStep(plan.executable[0],{messageId:`m${++counter}`,correlationId:'c',from:'executive',idempotencyKey:`k${counter}`,createdAt:new Date().toISOString(),...extra});
  assert.equal(built.ok,true,built.reason);return built.envelope;
}
const ok={status:'succeeded',output:{rows:3},usedCostCents:100,usedModelCalls:1,evidence:[]};
const events=async(db,id)=>(await db.query('SELECT seq,kind FROM enterprise_task_events WHERE task_id=$1 ORDER BY seq',[id])).rows.map(r=>`${r.seq}:${r.kind}`);
const task=async(db,id)=>(await db.query('SELECT status,attempts,fencing_token,lease_holder,failure_class,output FROM enterprise_tasks WHERE id=$1',[id])).rows[0];
// Time passes by the database clock: the lease (or deadline) is moved into the past.
const expire=(db,id)=>db.query("UPDATE enterprise_tasks SET lease_until=now() - interval '1 second' WHERE id=$1",[id]);
// A database whose event insert fails once inside a transaction, to prove that nothing of the change is kept.
const failingEvents=db=>({...db,transaction:fn=>db.transaction(sql=>fn({...sql,query:(text,values)=>/INSERT INTO enterprise_task_events/.test(text)?Promise.reject(new Error('Ereignis fehlgeschlagen')):sql.query(text,values)}))});

test('enqueue accepts only checked L0–L2 envelopes and is idempotent for the same task only (AC-1)',async()=>{
  const db=await pgliteDatabase();
  const env=envelope();
  const first=await R.enqueueTask(db,{envelope:env,createdBy:'executive'});
  assert.equal(first.created,true);
  assert.deepEqual(await R.enqueueTask(db,{envelope:{...env,messageId:'other-message'},createdBy:'executive'}),{id:first.id,created:false});
  assert.deepEqual(await events(db,first.id),['1:created']);
  await assert.rejects(R.enqueueTask(db,{envelope:{...envelope('opportunity.research'),idempotencyKey:env.idempotencyKey},createdBy:'executive'}),/anderen Aufgabe/);
  // Review #90 minor 5: same key with another budget or payload is a different task.
  await assert.rejects(R.enqueueTask(db,{envelope:{...env,payload:{month:'2026-12'}},createdBy:'executive'}),/anderen Aufgabe/);
  await assert.rejects(R.enqueueTask(db,{envelope:{...env,budget:{...env.budget,maxCostCents:299}},createdBy:'executive'}),/anderen Aufgabe/);
  await assert.rejects(R.enqueueTask(db,{envelope:{...envelope(),permissionLevel:'L3b'},createdBy:'executive'}),R.RepositoryError);
  await assert.rejects(R.enqueueTask(db,{envelope:{...envelope(),taskKind:'affiliate.publication_request',to:'affiliate',handlerId:'affiliate.publicationRequest',permissionLevel:'L3b'},createdBy:'executive'}),/nie als Aufgabe ausführbar/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM enterprise_tasks')).rows[0].n,1);
  await db.close();
});

test('a lease is exclusive, fenced and needed for every state change (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const {id}=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'});
  const lease=await R.leaseNext(db,'worker-a',LEASE);
  assert.deepEqual([lease.id,lease.fencingToken,lease.attempts,lease.envelope.taskKind],[id,1,1,'controlling.monthly_close']);
  assert.equal(await R.leaseNext(db,'worker-b',LEASE),null,'nothing else to lease');
  assert.equal(await R.startTask(db,{...lease,holder:'worker-b'}),false,'foreign holder');
  assert.equal(await R.startTask(db,{...lease,fencingToken:0}),false,'old token');
  assert.equal(await R.startTask(db,lease),true);
  assert.equal(await R.heartbeat(db,lease,LEASE),true);
  assert.deepEqual(await R.completeTask(db,{...lease,fencingToken:2},ok),{ok:false,reason:'stale_lease'});
  assert.deepEqual(await R.completeTask(db,lease,ok),{ok:true,outcome:'succeeded'});
  const done=await task(db,id);
  assert.deepEqual([done.status,done.lease_holder,done.output.output],['succeeded',null,{rows:3}]);
  assert.deepEqual(await R.completeTask(db,lease,ok),{ok:false,reason:'stale_lease'},'second completion changes nothing');
  assert.deepEqual(await events(db,id),['1:created','2:leased','3:started','4:succeeded']);
  for(const bad of [0,-1,NaN,16*60_000])await assert.rejects(R.leaseNext(db,'w',bad),R.RepositoryError);
  await db.close();
});

test('expiry is judged by the database clock: no caller time can commit late or steal a valid lease (AC-3, review #90 major 1)',async()=>{
  const db=await pgliteDatabase();
  // The API takes no time at all.
  for(const fn of ['leaseNext','startTask','heartbeat','completeTask','reclaimExpired','cancelTask'])assert.doesNotMatch(String(R[fn]).split(')')[0],/\bnow\b/,fn);
  const {id}=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',maxAttempts:2});
  const lease=await R.leaseNext(db,'worker-a',LEASE);
  assert.deepEqual(await R.reclaimExpired(db),{requeued:[],dead:[],unknown:[],expired:[]},'a valid lease is never taken away');
  await expire(db,id);
  assert.deepEqual(await R.completeTask(db,lease,ok),{ok:false,reason:'stale_lease'},'expired, even before any reclaim');
  assert.equal(await R.heartbeat(db,lease,LEASE),false);
  assert.equal(await R.startTask(db,lease),false);
  assert.deepEqual(await R.reclaimExpired(db),{requeued:[id],dead:[],unknown:[],expired:[]},'never started ⇒ back to the queue');
  const fresh=await R.leaseNext(db,'worker-b',LEASE);
  assert.ok(fresh.fencingToken>lease.fencingToken);
  assert.equal(fresh.attempts,2);
  assert.deepEqual(await R.completeTask(db,lease,ok),{ok:false,reason:'stale_lease'});
  await expire(db,id);
  assert.deepEqual(await R.reclaimExpired(db),{requeued:[],dead:[id],unknown:[],expired:[]},'no attempts left ⇒ dead');
  assert.deepEqual([(await task(db,id)).status,(await task(db,id)).failure_class],['dead','internal']);
  await db.close();
});

test('a running task whose lease expired becomes outcome_unknown and is never leased again (AC-3, review #90 major 2)',async()=>{
  const db=await pgliteDatabase();
  const {id}=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',maxAttempts:3});
  const lease=await R.leaseNext(db,'worker-a',LEASE);
  assert.equal(await R.startTask(db,lease),true);
  await expire(db,id);
  assert.deepEqual(await R.reclaimExpired(db),{requeued:[],dead:[],unknown:[id],expired:[]});
  assert.deepEqual([(await task(db,id)).status,(await task(db,id)).failure_class],['outcome_unknown','outcome_unknown']);
  assert.equal(await R.leaseNext(db,'worker-b',LEASE),null);
  assert.deepEqual(await R.completeTask(db,lease,ok),{ok:false,reason:'stale_lease'});
  await db.close();
});

test('outcome_unknown is never retried; provider errors retry while attempts remain (AC-4)',async()=>{
  const db=await pgliteDatabase();
  const unknown=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',maxAttempts:3});
  const lease=await R.leaseNext(db,'w',LEASE);
  const outcome={status:'failed',failureClass:'outcome_unknown',reason:'Antwort unklar',usedCostCents:300,usedModelCalls:2};
  assert.deepEqual(await R.completeTask(db,lease,outcome),{ok:true,outcome:'outcome_unknown'});
  assert.equal((await task(db,unknown.id)).status,'outcome_unknown');
  assert.equal(await R.leaseNext(db,'w',LEASE),null,'never leased again');

  const flaky=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',maxAttempts:2});
  const provider={status:'failed',failureClass:'provider_error',reason:'HTTP 503',usedCostCents:0,usedModelCalls:1};
  assert.deepEqual(await R.completeTask(db,await R.leaseNext(db,'w',LEASE),provider),{ok:true,outcome:'requeued'});
  assert.deepEqual(await R.completeTask(db,await R.leaseNext(db,'w',LEASE),provider),{ok:true,outcome:'failed'});
  assert.deepEqual([(await task(db,flaky.id)).status,(await task(db,flaky.id)).failure_class,(await task(db,flaky.id)).attempts],['failed','provider_error',2]);

  const invalid=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',maxAttempts:3});
  assert.deepEqual(await R.completeTask(db,await R.leaseNext(db,'w',LEASE),{...provider,failureClass:'invalid_input'}),{ok:true,outcome:'failed'});
  assert.equal((await task(db,invalid.id)).status,'failed','invalid input is not retried');
  await db.close();
});

test('results over budget fail with their real usage; tasks never write to the outbox; failures roll back completely (AC-5, review #90 major 3)',async()=>{
  const db=await pgliteDatabase();
  const over=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'});
  assert.deepEqual(await R.completeTask(db,await R.leaseNext(db,'w',LEASE),{...ok,usedCostCents:301}),{ok:true,outcome:'failed'});
  const row=await task(db,over.id);
  assert.deepEqual([row.status,row.failure_class,row.output.usage],['failed','budget_exhausted',{usedCostCents:301,usedModelCalls:1}]);
  const calls=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'});
  await R.completeTask(db,await R.leaseNext(db,'w',LEASE),{...ok,usedModelCalls:3});
  assert.equal((await task(db,calls.id)).failure_class,'budget_exhausted','model calls over budget, classified without parsing text');
  const malformed=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'});
  await R.completeTask(db,await R.leaseNext(db,'w',LEASE),{status:'done'});
  assert.equal((await task(db,malformed.id)).failure_class,'internal');

  // No outbox parameter exists: a task (L0–L2) cannot record an external effect, whatever it returns.
  assert.equal(R.completeTask.length,3);
  const sneaky=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'});
  await R.completeTask(db,await R.leaseNext(db,'w',LEASE),{...ok,output:{outbox:[{kind:'meta.publish'}]}},[{kind:'meta.publish',payload:{},idempotencyKey:'x'}]);
  assert.equal((await task(db,sneaky.id)).status,'succeeded');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM enterprise_outbox')).rows[0].n,0);

  // A failing event insert rolls back the whole completion.
  const third=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'});
  const lease3=await R.leaseNext(db,'w',LEASE);
  await assert.rejects(R.completeTask(failingEvents(db),lease3,ok),/Ereignis fehlgeschlagen/);
  assert.equal((await task(db,third.id)).status,'leased');
  assert.deepEqual(await events(db,third.id),['1:created','2:leased']);
  await db.close();
});

test('registry changes, deadlines and cancellation stop queued tasks; leases never outlast the deadline (AC-6)',async()=>{
  const db=await pgliteDatabase();
  const tampered=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive',priority:10});
  await db.query(`UPDATE enterprise_tasks SET input=jsonb_set(input,'{handlerId}','"affiliate.publicationRequest"') WHERE id=$1`,[tampered.id]);
  const normal=await R.enqueueTask(db,{envelope:envelope(),createdBy:'executive'});
  const lease=await R.leaseNext(db,'w',LEASE);
  assert.equal(lease.id,normal.id,'the tampered task is skipped');
  assert.deepEqual([(await task(db,tampered.id)).status,(await task(db,tampered.id)).failure_class],['failed','invalid_input']);
  assert.deepEqual(await events(db,tampered.id),['1:created','2:rejected_on_lease']);

  const soon=new Date(Date.now()+60_000).toISOString();
  const bounded=await R.enqueueTask(db,{envelope:envelope('controlling.monthly_close',{deadline:soon}),createdBy:'executive',priority:20});
  const boundedLease=await R.leaseNext(db,'w',LEASE);
  assert.equal(boundedLease.id,bounded.id);
  assert.ok(Date.parse(boundedLease.leaseUntil)<=Date.parse(soon),'lease ends at the deadline');
  assert.equal(await R.heartbeat(db,boundedLease,LEASE),true);
  assert.ok(Date.parse((await db.query('SELECT lease_until FROM enterprise_tasks WHERE id=$1',[bounded.id])).rows[0].lease_until)<=Date.parse(soon));

  const late=await R.enqueueTask(db,{envelope:envelope('controlling.monthly_close',{deadline:soon}),createdBy:'executive'});
  await db.query("UPDATE enterprise_tasks SET deadline=now() - interval '1 second' WHERE id=$1",[late.id]);
  assert.deepEqual((await R.reclaimExpired(db)).expired,[late.id]);
  assert.equal((await task(db,late.id)).failure_class,'deadline_exceeded');

  const cancel=await R.enqueueTask(db,{envelope:envelope(),createdBy:'operator'});
  assert.equal(await R.cancelTask(db,cancel.id,'operator'),true);
  assert.equal(await R.cancelTask(db,cancel.id,'operator'),false);
  assert.equal(await R.cancelTask(db,lease.id,'operator'),false,'a leased task is not cancelled here');
  await db.close();
});

test('repository is not wired into app code and imports only the contract and the db type (AC-7)',()=>{
  const source=fs.readFileSync('lib/enterprise/tasks/repository.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../../memory/db','../contract','node:crypto']);
  assert.match(source,/import type \{ Database, Sql \} from "\.\.\/\.\.\/memory\/db"/);
  assert.doesNotMatch(source,/process\.env|fetch\(|getDatabase|new Date\(\)|Date\.now|INSERT INTO enterprise_outbox/);
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&!full.startsWith(path.join('lib','enterprise')))walk(full);}
    else if(/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)&&/enterprise\/tasks/.test(fs.readFileSync(full,'utf8')))users.push(full);
  }};
  walk('app');walk('lib');if(fs.existsSync('scripts'))walk('scripts');
  assert.deepEqual(users,[]);
});
