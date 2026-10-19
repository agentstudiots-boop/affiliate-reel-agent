const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const loadRoute=require('./helpers/load-route.cjs');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const {envelopeFromStep}=require('../.test-build/lib/enterprise/contract');
const R=require('../.test-build/lib/enterprise/tasks/repository');
const {runExecutiveCycle}=require('../.test-build/lib/enterprise/cycle');
const {affiliateDepartment,affiliateContext}=require('../.test-build/lib/enterprise/departments/affiliate');

let counter=0;
async function enqueue(db,department,taskKind,priority=0){
  const plan=validatePlan({goal:'x',steps:[{id:'s',department,taskKind,dependsOn:[],maxCostCents:0,maxModelCalls:0}],expectedValue:null,costCapCents:0},{maxSteps:5,maxDepth:3,budgetCents:0});
  const built=envelopeFromStep(plan.executable[0],{messageId:`m${++counter}`,correlationId:'c',from:'executive',idempotencyKey:`k${counter}`,createdAt:new Date().toISOString()});
  assert.equal(built.ok,true,built.reason);
  return (await R.enqueueTask(db,{envelope:built.envelope,createdBy:'executive',priority})).id;
}
const status=async(db,id)=>(await db.query('SELECT status,failure_class FROM enterprise_tasks WHERE id=$1',[id])).rows[0];
const options=(db,departments,extra={})=>({holder:'test',leaseMs:60_000,maxTasks:5,departments,contextFor:()=>affiliateContext(db),...extra});

test('a cycle runs queued tasks through their department and records the result (AC-1)',async()=>{
  const db=await pgliteDatabase();
  await db.query("INSERT INTO daily_slot_runs(id,invoked_at,outcome,whatsapp) VALUES($1,now() - interval '3 hours','awaiting_approval','approval_sent')",[crypto.randomUUID()]);
  const report=await enqueue(db,'affiliate','affiliate.status_report');
  const orphan=await enqueue(db,'controlling','controlling.monthly_close');
  const result=await runExecutiveCycle(db,options(db,{affiliate:affiliateDepartment}));
  assert.deepEqual(result.ran.map(r=>[r.taskKind,r.outcome]).sort(),[['affiliate.status_report','succeeded'],['controlling.monthly_close','failed']]);
  assert.deepEqual(await status(db,report),{status:'succeeded',failure_class:null});
  assert.deepEqual(await status(db,orphan),{status:'failed',failure_class:'internal'},'no runtime module ⇒ failed, not waiting forever');
  const output=(await db.query('SELECT output FROM enterprise_tasks WHERE id=$1',[report])).rows[0].output;
  assert.equal(output.output.drafts,1);
  await db.close();
});

test('a throwing or misbehaving department never succeeds; module ids must match (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const thrown=await enqueue(db,'affiliate','affiliate.status_report');
  await runExecutiveCycle(db,options(db,{affiliate:{...affiliateDepartment,handle:async()=>{throw new Error('kaputt');}}}));
  assert.deepEqual(await status(db,thrown),{status:'failed',failure_class:'internal'});
  const spoofed=await enqueue(db,'affiliate','affiliate.status_report');
  await runExecutiveCycle(db,options(db,{affiliate:{...affiliateDepartment,id:'controlling'}}));
  assert.deepEqual(await status(db,spoofed),{status:'failed',failure_class:'internal'});
  const greedy=await enqueue(db,'affiliate','affiliate.status_report');
  await runExecutiveCycle(db,options(db,{affiliate:{...affiliateDepartment,handle:async()=>({status:'succeeded',output:{},usedCostCents:1,usedModelCalls:0,evidence:[]})}}));
  assert.deepEqual(await status(db,greedy),{status:'failed',failure_class:'budget_exhausted'},'a status report has a zero budget');
  await db.close();
});

test('the cycle is bounded and does housekeeping first (AC-3)',async()=>{
  const db=await pgliteDatabase();
  for(let i=0;i<14;i++)await enqueue(db,'affiliate','affiliate.status_report');
  assert.equal((await runExecutiveCycle(db,options(db,{affiliate:affiliateDepartment},{maxTasks:2}))).ran.length,2);
  assert.equal((await runExecutiveCycle(db,options(db,{affiliate:affiliateDepartment},{maxTasks:100}))).ran.length,10,'hard cap 10 per cycle');
  assert.equal((await runExecutiveCycle(db,options(db,{affiliate:affiliateDepartment},{maxTasks:NaN}))).ran.length,1);
  const stuck=await enqueue(db,'affiliate','affiliate.status_report',50);
  const lease=await R.leaseNext(db,'other',60_000);
  assert.equal(lease.id,stuck);
  await R.startTask(db,lease);
  await db.query("UPDATE enterprise_tasks SET lease_until=now() - interval '1 second' WHERE id=$1",[stuck]);
  const report=await runExecutiveCycle(db,options(db,{affiliate:affiliateDepartment},{maxTasks:0}));
  assert.deepEqual([report.reclaimed.unknown,report.ran.length],[1,0]);
  await db.close();
});

function route(overrides={}){
  const calls={db:0};
  const mod=loadRoute('app/api/cron/executive-cycle/route.ts',{
    '@/lib/memory/db':{getDatabase:()=>{calls.db++;return overrides.db;}},
    ...(overrides.guard?{'@/lib/security/runtime-guard':{effectDecision:()=>({ok:true})}}:{}),
  });
  return {GET:mod.GET,calls};
}
const withEnv=async(env,fn)=>{const saved={};for(const k of Object.keys(env)){saved[k]=process.env[k];if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}
  try{return await fn();}finally{for(const k of Object.keys(saved)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}};
const call=(GET,secret='s3cret')=>GET(new Request('https://example.test/api/cron/executive-cycle',{headers:{authorization:`Bearer ${secret}`}}));

test('route: secret required; switch off by default ⇒ no database access; preview never runs (AC-4)',async()=>{
  await withEnv({CRON_SECRET:'s3cret',EXECUTIVE_ENABLED:undefined},async()=>{
    const {GET,calls}=route();
    assert.equal((await call(GET,'wrong')).status,401);
    assert.deepEqual(await (await call(GET)).json(),{status:'disabled'});
    assert.equal(calls.db,0);
  });
  await withEnv({CRON_SECRET:'s3cret',EXECUTIVE_ENABLED:'1'},async()=>{
    const {GET,calls}=route();
    assert.deepEqual(await (await call(GET)).json(),{status:'disabled'},'only the exact value true enables it');
    assert.equal(calls.db,0);
  });
  await withEnv({CRON_SECRET:'s3cret',EXECUTIVE_ENABLED:'true',VERCEL_ENV:'preview'},async()=>{
    const {GET,calls}=route();
    assert.deepEqual(await (await call(GET)).json(),{status:'skipped_non_production_environment'});
    assert.equal(calls.db,0);
  });
});

test('route: enabled in production runs one cycle (AC-4)',async()=>{
  const db=await pgliteDatabase();
  await enqueue(db,'affiliate','affiliate.status_report');
  await withEnv({CRON_SECRET:'s3cret',EXECUTIVE_ENABLED:'true'},async()=>{
    const {GET}=route({db,guard:true});
    const body=await (await call(GET)).json();
    assert.equal(body.status,'ok');
    assert.deepEqual(body.ran.map(r=>r.outcome),['succeeded']);
  });
  await db.close();
});

test('the route is not scheduled and nothing else calls the cycle (AC-5)',()=>{
  const crons=JSON.parse(fs.readFileSync('vercel.json','utf8')).crons.map(c=>c.path);
  assert.ok(!crons.includes('/api/cron/executive-cycle'),'scheduling is a separate operator decision');
  const source=fs.readFileSync('lib/enterprise/cycle.ts','utf8');
  assert.doesNotMatch(source,/process\.env|fetch\(|getDatabase|sendWhatsApp|publish\(/);
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=`${dir}/${entry.name}`;
    if(entry.isDirectory()){if(!full.startsWith('lib/enterprise'))walk(full);}else if(/\.(ts|tsx)$/.test(entry.name)&&/enterprise\/cycle/.test(fs.readFileSync(full,'utf8')))users.push(full);}};
  walk('app');walk('lib');
  assert.deepEqual(users,['app/api/cron/executive-cycle/route.ts']);
});
