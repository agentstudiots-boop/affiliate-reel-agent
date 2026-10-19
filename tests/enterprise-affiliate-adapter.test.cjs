const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const {envelopeFromStep,checkHealth,checkResult,checkEnvelope}=require('../.test-build/lib/enterprise/contract');
const {affiliateDepartment,affiliateContext}=require('../.test-build/lib/enterprise/departments/affiliate');

const NOW=new Date('2026-11-01T12:00:00Z');
const hoursAgo=h=>new Date(NOW.getTime()-h*3600*1000).toISOString();
const run=(db,invokedAt,outcome)=>db.query('INSERT INTO daily_slot_runs(id,invoked_at,outcome) VALUES($1,$2,$3)',[crypto.randomUUID(),invokedAt,outcome]);
const evidence=(report,label)=>report.evidence.find(item=>item.label===label)?.value;
const envelopeFor=taskKind=>{
  const plan=validatePlan({goal:'Status',steps:[{id:'s',department:'affiliate',taskKind,dependsOn:[],maxCostCents:0,maxModelCalls:0}],expectedValue:null,costCapCents:0},{maxSteps:5,maxDepth:3,budgetCents:0});
  const built=envelopeFromStep(plan.executable[0],{messageId:'m',correlationId:'c',from:'executive',idempotencyKey:'k',createdAt:NOW.toISOString()});
  assert.equal(built.ok,true,built.reason);return built.envelope;
};

test('no evidence yet: health is unknown, never ok (AC-1)',async()=>{
  const db=await pgliteDatabase();
  const report=await affiliateDepartment.health(affiliateContext(db,()=>NOW));
  assert.equal(report.status,'unknown');
  assert.match(report.reason,/kein Tageslauf/);
  assert.equal(checkHealth(report,'affiliate').ok,true);
  await db.close();
});

test('recent successful daily run: ok with evidence from the real tables (AC-2)',async()=>{
  const db=await pgliteDatabase();
  await run(db,hoursAgo(30),'error');
  await run(db,hoursAgo(5),'drafted');
  await run(db,hoursAgo(200),'drafted'); // outside the 7-day window
  await db.query(`INSERT INTO instagram_image_posts(publication_id,status,updated_at) VALUES($1,'published',$2),($3,'failed',$2)`,[crypto.randomUUID(),hoursAgo(10),crypto.randomUUID()]);
  const report=await affiliateDepartment.health(affiliateContext(db,()=>NOW));
  assert.equal(report.status,'ok',report.reason);
  assert.equal(checkHealth(report,'affiliate').ok,true);
  assert.equal(evidence(report,'Tagesläufe (7 Tage)'),2);
  assert.equal(evidence(report,'davon Fehler'),1);
  assert.equal(evidence(report,'letzter erfolgreicher Tageslauf'),hoursAgo(5));
  assert.equal(evidence(report,'veröffentlicht Instagram (7 Tage)'),1);
  assert.equal(evidence(report,'offene Inhaltsfreigaben'),0);
  await db.close();
});

test('failed or stale daily runs are degraded (AC-3)',async()=>{
  const db=await pgliteDatabase();
  await run(db,hoursAgo(20),'drafted');
  await run(db,hoursAgo(2),'error');
  assert.equal((await affiliateDepartment.health(affiliateContext(db,()=>NOW))).status,'degraded');
  const stale=await pgliteDatabase();
  await run(stale,hoursAgo(60),'drafted');
  const report=await affiliateDepartment.health(affiliateContext(stale,()=>NOW));
  assert.equal(report.status,'degraded');
  assert.match(report.reason,/über zwei Tagen/);
  await db.close();await stale.close();
});

test('unreadable database yields unknown, not an error or ok (AC-4)',async()=>{
  const broken={query:async()=>{throw new Error('down');},exec:async()=>{},transaction:async()=>{throw new Error('down');}};
  const report=await affiliateDepartment.health(affiliateContext(broken,()=>NOW));
  assert.deepEqual([report.status,report.evidence],['unknown',[]]);
  assert.match(report.reason,/nicht lesbar/);
  const result=await affiliateDepartment.handle(envelopeFor('affiliate.status_report'),affiliateContext(broken,()=>NOW));
  assert.equal(result.status,'failed');
});

test('views are read-only SELECTs inside READ ONLY transactions (AC-5)',async()=>{
  const statements=[];
  const fake={query:async()=>({rows:[]}),exec:async()=>{},transaction:async fn=>{const sql={query:async text=>{statements.push(text.trim());return {rows:[{}]};},exec:async()=>{}};return fn(sql);}};
  await affiliateDepartment.health(affiliateContext(fake,()=>NOW));
  assert.ok(statements.length>=6);
  for(let i=0;i<statements.length;i+=2){
    assert.equal(statements[i],'SET TRANSACTION READ ONLY');
    assert.match(statements[i+1],/^SELECT\b/);
    assert.doesNotMatch(statements[i+1],/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
  }
});

test('status report task returns figures within budget; publication requests are never handled (AC-6)',async()=>{
  const db=await pgliteDatabase();
  await run(db,hoursAgo(3),'drafted');
  const envelope=envelopeFor('affiliate.status_report');
  assert.equal(checkEnvelope(envelope).ok,true);
  const result=await affiliateDepartment.handle(envelope,affiliateContext(db,()=>NOW));
  assert.equal(result.status,'succeeded');
  assert.equal(result.output.totalRuns,1);
  assert.equal(checkResult(result,envelope).ok,true);
  const forged={...envelope,taskKind:'affiliate.publication_request',handlerId:'affiliate.publicationRequest',permissionLevel:'L3b'};
  assert.equal(checkEnvelope(forged).ok,false);
  const refused=await affiliateDepartment.handle(forged,affiliateContext(db,()=>NOW));
  assert.deepEqual([refused.status,refused.failureClass],['failed','invalid_input']);
  await db.close();
});

test('adapter changes nothing in the studio and is not wired into app code (AC-7)',()=>{
  const source=fs.readFileSync('lib/enterprise/departments/affiliate.ts','utf8');
  for(const match of source.matchAll(/from\s+"([^"]+)"/g))assert.ok(['../../memory/db','../contract'].includes(match[1]),match[1]);
  assert.match(source,/import type \{ Database, Sql \} from "\.\.\/\.\.\/memory\/db"/);
  assert.doesNotMatch(source,/\b(INSERT|UPDATE|DELETE)\b|fetch\(|process\.env|sendWhatsApp|publish\(/);
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&!full.startsWith(path.join('lib','enterprise')))walk(full);}
    else if(/\.(ts|tsx)$/.test(entry.name)&&/enterprise\/departments\/affiliate/.test(fs.readFileSync(full,'utf8')))users.push(full);
  }};
  walk('app');walk('lib');
  assert.deepEqual(users,[]);
});
