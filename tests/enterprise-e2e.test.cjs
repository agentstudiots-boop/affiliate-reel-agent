// End-to-end scenarios of the executive kernel (task J-01) with PGlite and the real modules: plan → task → department →
// decision request → rejection/approval. The invariant under test: nothing has an effect without the operator's approval,
// and even an approval executes nothing yet (no task, no outbox entry, no publish attempt, no reservation).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const {envelopeFromStep}=require('../.test-build/lib/enterprise/contract');
const R=require('../.test-build/lib/enterprise/tasks/repository');
const B=require('../.test-build/lib/enterprise/tasks/budget');
const D=require('../.test-build/lib/enterprise/decisions');
const {runExecutiveCycle}=require('../.test-build/lib/enterprise/cycle');
const {affiliateDepartment,affiliateContext}=require('../.test-build/lib/enterprise/departments/affiliate');

const LIMITS={maxSteps:10,maxDepth:3,budgetCents:10_000};
const OPTIONS=[{id:'yes',label:'Freigeben'},{id:'no',label:'Ablehnen'}];
// Tables in which an effect would show up: kernel side effects and the studio's publishing paths.
const EFFECT_TABLES=['enterprise_outbox','budget_reservations','publication_requests','publish_attempts','instagram_image_posts','content_jobs'];
let counter=0;

// The operator's request "Status melden und Beitrag 7 veröffentlichen" as the planner would propose it.
const operatorPlan=()=>validatePlan({goal:'Status melden und Beitrag 7 veröffentlichen',
  evidence:[{claim:'Beitrag 7 ist inhaltlich freigegeben',kind:'fact',source:'content_approval_requests'}],
  steps:[{id:'status',department:'affiliate',taskKind:'affiliate.status_report',dependsOn:[],maxCostCents:0,maxModelCalls:0},
    {id:'publish',department:'affiliate',taskKind:'affiliate.publication_request',dependsOn:['status'],maxCostCents:0,maxModelCalls:0}],
  expectedValue:null,costCapCents:0},LIMITS);

async function counts(db){
  const out={};
  for(const table of EFFECT_TABLES){
    const exists=(await db.query('SELECT to_regclass($1) IS NOT NULL AS ok',[`public.${table}`])).rows[0].ok;
    out[table]=exists?(await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n:null;
  }
  out.tasks=(await db.query('SELECT count(*)::int AS n FROM enterprise_tasks')).rows[0].n;
  return out;
}
async function enqueueExecutable(db,plan){
  const ids=[];
  for(const step of plan.executable){
    const built=envelopeFromStep(step,{messageId:`m${++counter}`,correlationId:'op-1',from:'operator',idempotencyKey:`op-1:${step.id}`,createdAt:new Date().toISOString()});
    assert.equal(built.ok,true,built.reason);
    ids.push((await R.enqueueTask(db,{envelope:built.envelope,createdBy:'operator'})).id);
  }
  return ids;
}
const cycle=db=>runExecutiveCycle(db,{holder:'e2e',leaseMs:60_000,maxTasks:5,departments:{affiliate:affiliateDepartment},contextFor:()=>affiliateContext(db)});
async function requestPublication(db,plan){
  const step=plan.decisionRequests[0];
  const request=await D.requestDecision(db,{step,subjectKey:'affiliate:post:7',subject:'Beitrag 7 auf Facebook veröffentlichen',options:OPTIONS,
    recommendation:{optionId:'yes',reason:'Inhalt freigegeben'}});
  const requestMessageId=`wamid.req.${crypto.randomUUID()}`;
  assert.equal(await D.attachRequestMessage(db,request.id,requestMessageId),true);
  return {request,requestMessageId};
}
const reply=(r,requestMessageId,extra={})=>({id:r.id,fingerprint:r.fingerprint,decision:'approved',authority:'whatsapp_operator',requestMessageId,
  decidedMessageId:`wamid.reply.${crypto.randomUUID()}`,...extra});
const status=async(db,id)=>(await db.query('SELECT status FROM enterprise_decisions WHERE id=$1',[id])).rows[0].status;

test('scenario 1: the plan splits into an executable read and a publication that waits for the operator (J-01)',async()=>{
  const db=await pgliteDatabase();
  const before=await counts(db);
  const plan=operatorPlan();
  assert.equal(plan.ok,true,plan.violations.join('|'));
  assert.deepEqual(plan.executable.map(s=>s.id),['status']);
  assert.deepEqual(plan.decisionRequests.map(s=>[s.id,s.level]),[['publish','L3b']]);
  const [taskId]=await enqueueExecutable(db,plan);
  const {request}=await requestPublication(db,plan);
  const report=await cycle(db);
  assert.deepEqual(report.ran.map(r=>[r.taskId,r.outcome]),[[taskId,'succeeded']],'only the read ran');
  assert.equal(await status(db,request.id),'pending');
  const after=await counts(db);
  assert.deepEqual({...after,tasks:0},{...before,tasks:0},'no effect anywhere');
  assert.equal(after.tasks,1,'the publication never became a task');
  await db.close();
});

test('scenario 2: rejection, a wrong sender, a reply to another message or a changed request never approve (J-01)',async()=>{
  const db=await pgliteDatabase();
  const plan=operatorPlan();
  const {request,requestMessageId}=await requestPublication(db,plan);
  assert.deepEqual(await D.recordDecision(db,reply(request,requestMessageId,{authority:'executive_agent'})),{ok:false,reason:'not_operator'});
  assert.deepEqual(await D.recordDecision(db,reply(request,'wamid.other')),{ok:false,reason:'wrong_message'});
  assert.deepEqual(await D.recordDecision(db,reply(request,requestMessageId,{fingerprint:'0'.repeat(64)})),{ok:false,reason:'fingerprint_mismatch'});
  // The request changes (new version): an answer to the old version no longer counts.
  const changed=await D.requestDecision(db,{step:plan.decisionRequests[0],subjectKey:'affiliate:post:7',subject:'Beitrag 7 auf Facebook und Instagram veröffentlichen',options:OPTIONS});
  assert.notEqual(changed.id,request.id);
  assert.equal(await status(db,request.id),'superseded');
  assert.equal((await D.recordDecision(db,reply(request,requestMessageId))).ok,false);
  const newMessage=`wamid.req.${crypto.randomUUID()}`;
  await D.attachRequestMessage(db,changed.id,newMessage);
  assert.deepEqual(await D.recordDecision(db,reply(changed,newMessage,{decision:'rejected'})),{ok:true,status:'rejected'});
  assert.equal((await D.recordDecision(db,reply(changed,newMessage))).ok,false,'a rejection is final');
  const effects=await counts(db);
  assert.deepEqual(Object.values(effects).filter(n=>n),[],'no task, no outbox entry, no publish attempt');
  await db.close();
});

test('scenario 3: missing answers expire and never become approvals; an approval executes nothing yet (J-01)',async()=>{
  const db=await pgliteDatabase();
  const plan=operatorPlan();
  const {request}=await requestPublication(db,plan);
  await db.query("UPDATE enterprise_decisions SET created_at=now() - interval '2 hours', expires_at=now() - interval '1 second' WHERE id=$1",[request.id]);
  assert.equal((await cycle(db)).expiredDecisions,1,'the cycle expires it');
  assert.equal(await status(db,request.id),'expired');

  const next=await D.requestDecision(db,{step:plan.decisionRequests[0],subjectKey:'affiliate:post:8',subject:'Beitrag 8 veröffentlichen',options:OPTIONS});
  const message=`wamid.req.${crypto.randomUUID()}`;
  await D.attachRequestMessage(db,next.id,message);
  assert.deepEqual(await D.recordDecision(db,reply(next,message)),{ok:true,status:'approved'});
  await cycle(db);
  const effects=await counts(db);
  assert.deepEqual(Object.values(effects).filter(n=>n),[],'approval alone starts nothing: execution of approvals is a separate, later step');
  await db.close();
});

test('scenario 4: a paid step needs an approved budget; lost workers end in outcome_unknown and are not re-run (J-01)',async()=>{
  const db=await pgliteDatabase();
  const research=validatePlan({goal:'Recherche',steps:[{id:'r',department:'opportunity',taskKind:'opportunity.research',dependsOn:[],maxCostCents:300,maxModelCalls:3}],
    expectedValue:null,costCapCents:300},LIMITS);
  const [id]=await enqueueExecutable(db,research);
  const lease=await R.leaseNext(db,'w',60_000);
  assert.equal(await R.startTask(db,lease),true);
  assert.equal((await B.reserveBudget(db,lease,{amountCents:100})).reason,'no_approved_budget','no paid call without an approved monthly budget');
  await db.query("UPDATE enterprise_tasks SET lease_until=now() - interval '1 second' WHERE id=$1",[id]);
  assert.equal((await cycle(db)).reclaimed.unknown,1);
  assert.equal((await db.query('SELECT status FROM enterprise_tasks WHERE id=$1',[id])).rows[0].status,'outcome_unknown');
  const again=await cycle(db);
  assert.deepEqual([again.ran.length,again.reclaimed.requeued],[0,0],'never silently retried');
  assert.equal((await counts(db)).budget_reservations,0);
  await db.close();
});
