const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {applyMigrations}=require('../.test-build/lib/memory/migrations');

const SQL=fs.readFileSync('db/migrations/039_enterprise_task_ledger.sql','utf8');
const TABLES=['enterprise_tasks','enterprise_task_events','enterprise_outbox','budget_reservations'];
const id=()=>crypto.randomUUID();
async function task(db,fields={}){
  const row={id:id(),department:'affiliate',task_kind:'affiliate.status_report',handler_id:'affiliate.statusReport',permission_level:'L0',
    correlation_id:'c',idempotency_key:id(),created_by:'executive',...fields};
  const keys=Object.keys(row);
  await db.query(`INSERT INTO enterprise_tasks(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>row[k]));
  return row.id;
}
const rejects=(promise,label)=>assert.rejects(promise,undefined,label);

test('migration is additive and idempotent; ensureAutomationSchema knows it (AC-1)',async()=>{
  assert.doesNotMatch(SQL,/\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|RENAME)\b/i);
  for(const statement of SQL.match(/CREATE (TABLE|INDEX)[^\n]*/g))assert.match(statement,/IF NOT EXISTS/,statement);
  const db=await pgliteDatabase();
  for(const table of TABLES)assert.equal((await db.query('SELECT to_regclass($1) IS NOT NULL AS ok',[`public.${table}`])).rows[0].ok,true,table);
  await db.exec(SQL); // replaying the SQL changes nothing
  const again=await applyMigrations(db);
  assert.deepEqual(again.applied,[]);
  assert.ok(again.alreadyApplied.includes('039_enterprise_task_ledger.sql'));
  assert.match(fs.readFileSync('lib/memory/ensure-automation-schema.ts','utf8'),/budget_reservations'\) IS NOT NULL AS enterprise_ledger/);
  await db.close();
});

test('only executable levels L0–L2 enter the ledger; one task per idempotency key (AC-2)',async()=>{
  const db=await pgliteDatabase();
  for(const level of ['L0','L1','L2'])await task(db,{permission_level:level});
  for(const level of ['L3a','L3b','L4','',null])await rejects(task(db,{permission_level:level}),String(level));
  await task(db,{idempotency_key:'same'});
  await rejects(task(db,{idempotency_key:'same'}),'duplicate idempotency key');
  for(const bad of [{task_kind:'statusreport'},{department:'Affiliate'},{created_by:'model'},{status:'done'},{max_cost_cents:-1},{attempts:2,max_attempts:1},{max_attempts:0}])
    await rejects(task(db,bad),JSON.stringify(bad));
  await db.close();
});

test('lease fields are set exactly while leased or running (AC-3)',async()=>{
  const db=await pgliteDatabase();
  const until=new Date(Date.now()+60_000).toISOString();
  await task(db,{status:'leased',lease_holder:'worker-1',lease_until:until,fencing_token:1,attempts:1});
  await task(db,{status:'running',lease_holder:'worker-1',lease_until:until,fencing_token:2,attempts:1});
  await rejects(task(db,{status:'leased'}),'leased without holder');
  await rejects(task(db,{status:'running',lease_holder:'w'}),'running without lease_until');
  await rejects(task(db,{status:'queued',lease_holder:'w',lease_until:until}),'queued with lease');
  await rejects(task(db,{fencing_token:-1}),'negative fencing token');
  const queued=await task(db);
  await rejects(db.query("UPDATE enterprise_tasks SET status='leased' WHERE id=$1",[queued]),'lease without holder by update');
  await db.close();
});

test('terminal states carry their evidence; outcome_unknown is its own class (AC-4)',async()=>{
  const db=await pgliteDatabase();
  await task(db,{status:'succeeded',output:JSON.stringify({ok:true})});
  await rejects(task(db,{status:'succeeded'}),'succeeded without output');
  await rejects(task(db,{status:'succeeded',output:'{}',failure_class:'internal'}),'succeeded with failure');
  await task(db,{status:'failed',failure_class:'provider_error'});
  await rejects(task(db,{status:'failed'}),'failed without class');
  await rejects(task(db,{status:'dead'}),'dead without class');
  await task(db,{status:'outcome_unknown',failure_class:'outcome_unknown'});
  await rejects(task(db,{status:'outcome_unknown',failure_class:'provider_error'}),'outcome_unknown with other class');
  await rejects(task(db,{status:'failed',failure_class:'timeout'}),'class outside the B-04 contract');
  // Review #89: the class outcome_unknown only on outcome_unknown tasks; no class outside failure states.
  await rejects(task(db,{status:'failed',failure_class:'outcome_unknown'}),'failed with class outcome_unknown');
  for(const status of ['queued','needs_decision','cancelled','succeeded'])await rejects(task(db,{status,failure_class:'provider_error',output:'{}'}),`${status} with a class`);
  const unknown=await task(db,{status:'outcome_unknown',failure_class:'outcome_unknown'});
  await rejects(db.query("UPDATE enterprise_tasks SET status='queued' WHERE id=$1",[unknown]),'outcome_unknown back to queued with its class');
  await rejects(task(db,{handler_id:'Affiliate status'}),'handler id format');
  await task(db,{max_cost_cents:3_000_000_000}); // amounts are bigint like the contract's safe integers
  for(const status of ['queued','needs_decision','cancelled'])await task(db,{status});
  await db.close();
});

test('events are numbered per task; outbox and budget states are consistent (AC-5)',async()=>{
  const db=await pgliteDatabase();
  const t=await task(db);
  const event=seq=>db.query("INSERT INTO enterprise_task_events(task_id,seq,kind,actor) VALUES($1,$2,'created','executive')",[t,seq]);
  await event(1);await event(2);
  await rejects(event(2),'duplicate seq');await rejects(event(0),'seq 0');
  await rejects(db.query("INSERT INTO enterprise_task_events(task_id,seq,kind,actor) VALUES($1,1,'created','executive')",[id()]),'unknown task');

  const outbox=(fields={})=>{const row={id:id(),task_id:t,kind:'whatsapp.notify_operator',idempotency_key:id(),fencing_token:1,...fields};const keys=Object.keys(row);
    return db.query(`INSERT INTO enterprise_outbox(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>row[k]));};
  await outbox();
  await outbox({status:'outcome_unknown',settled_at:new Date().toISOString()});
  await rejects(outbox({status:'sent'}),'sent without settled_at');
  await rejects(outbox({settled_at:new Date().toISOString()}),'pending with settled_at');
  await outbox({idempotency_key:'ext-1'});await rejects(outbox({idempotency_key:'ext-1'}),'duplicate external key');
  await rejects(outbox({fencing_token:null}),'outbox without fencing token');

  const reserve=(fields={})=>{const row={id:id(),task_id:t,department:'affiliate',period:'2026-10',amount_cents:500,...fields};const keys=Object.keys(row);
    return db.query(`INSERT INTO budget_reservations(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>row[k]));};
  const now=new Date().toISOString();
  await reserve();await reserve({status:'disputed'});
  await reserve({status:'settled',settled_amount_cents:420,settled_at:now});await reserve({status:'released',settled_at:now});
  for(const bad of [{amount_cents:0},{period:'2026-13'},{period:'10/2026'},{currency:'eur'},{status:'disputed',settled_at:now},
    {status:'settled',settled_at:now},{status:'released',settled_at:now,settled_amount_cents:1},{status:'reserved',settled_at:now}])
    await rejects(reserve(bad),JSON.stringify(bad));
  await db.close();
});

// The kernel's own modules in lib/enterprise (repository B-03) may use the ledger; their isolation tests make sure they are not wired in.
test('no application code uses the ledger yet (AC-6)',()=>{
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&full!==path.join('lib','enterprise'))walk(full);}
    else if(/\.(ts|tsx)$/.test(entry.name)&&/\b(enterprise_tasks|enterprise_task_events|enterprise_outbox|budget_reservations)\b/.test(fs.readFileSync(full,'utf8')))users.push(full);
  }};
  walk('app');walk('lib');
  // H-01 only counts tasks per department and status (SELECT in a READ ONLY transaction); the WhatsApp answer „Executive“
  // (rollout 24.10.) reads the newest succeeded prioritisation.
  assert.deepEqual(users.sort(),[path.join('lib','architecture','enterprise-snapshot.ts'),path.join('lib','memory','ensure-automation-schema.ts'),path.join('lib','whatsapp','executive-status.ts')].sort());
});
