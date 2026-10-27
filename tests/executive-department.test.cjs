// Executive department (rollout 24.10.2026): deterministic prioritisation from existing evidence, read-only, no model call;
// daily task source idempotent per Berlin day across summer/winter time.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {prioritize,executiveDepartment,executiveContext}=require('../.test-build/lib/enterprise/departments/executive');
const {enqueueDailyTasks,berlinDay}=require('../.test-build/lib/enterprise/daily-tasks');

const now=new Date('2026-10-24T06:20:00Z');

test('priorities: failures before undelivered drafts before waiting approvals before housekeeping; operator actions marked',()=>{
  const report={errorRuns:1,undeliveredDrafts:2,contentApprovalsPending:1,publicationApprovalsPending:0};
  const list=prioritize(report,'2026-10-24T06:00:00Z',{topic_pending:1,cost_approvals_pending:1,decisions_pending:1,cost_entries:10,cost_unknown:10},now);
  assert.deepEqual(list.map(p=>p.area),['Affiliate','Affiliate','Affiliate','Themen','Produktion','Executive','Controlling']);
  assert.deepEqual(list.map(p=>p.rank),[1,2,3,4,5,6,7]);
  assert.equal(list[0].operatorAction,false);assert.equal(list[1].operatorAction,true);
  assert.match(list[6].action,/Preiskatalog/);
});

test('a missing or stale status report is the first priority; an empty week of costs is flagged, never read as zero cost',()=>{
  const list=prioritize(null,null,{cost_entries:0,cost_unknown:0},now);
  assert.match(list[0].finding,/kein aktueller Statusbericht/);
  assert.match(list.at(-1).finding,/keine Kostenzeilen/);
  assert.match(prioritize({},'2026-10-22T06:00:00Z',{},now)[0].finding,/kein aktueller Statusbericht/);
});

test('the module reads only through its read views and never writes, sends or calls a model',()=>{
  const source=fs.readFileSync('lib/enterprise/departments/executive.ts','utf8');
  assert.doesNotMatch(source,/INSERT|UPDATE|DELETE|process\.env|fetch\(|sendWhatsApp|recordModelCall|publish\(/);
  assert.match(source,/SET TRANSACTION READ ONLY/);
});

test('daily tasks: one status report and one prioritisation per Berlin day, also across the DST change',async()=>{
  const db=await pgliteDatabase();
  assert.equal(berlinDay(new Date('2026-10-24T22:30:00Z')),'2026-10-25');
  assert.equal(berlinDay(new Date('2026-10-25T22:30:00Z')),'2026-10-25','winter time: 23:30 Berlin is still the same day');
  assert.deepEqual((await enqueueDailyTasks(db,now)).created,['affiliate.status_report','executive.prioritize']);
  assert.deepEqual((await enqueueDailyTasks(db,new Date(now.getTime()+60_000))).created,[]);
  assert.deepEqual((await enqueueDailyTasks(db,new Date('2026-10-25T06:20:00Z'))).created.length,2);
  const rows=(await db.query("SELECT task_kind, permission_level, max_cost_cents, max_model_calls FROM enterprise_tasks ORDER BY created_at, task_kind")).rows;
  assert.equal(rows.length,4);
  assert.ok(rows.every(r=>Number(r.max_cost_cents)===0&&Number(r.max_model_calls)===0));
  assert.deepEqual([...new Set(rows.map(r=>r.permission_level))].sort(),['L0','L2']);
  await db.close();
});

test('health and prioritisation run against a real schema without existing evidence',async()=>{
  const db=await pgliteDatabase();
  const context=executiveContext(db,()=>now);
  const health=await executiveDepartment.health(context);
  assert.equal(health.status,'degraded');
  const result=await executiveDepartment.handle({to:'executive',taskKind:'executive.prioritize'},context);
  assert.equal(result.status,'succeeded');assert.equal(result.usedModelCalls,0);
  await db.close();
});
