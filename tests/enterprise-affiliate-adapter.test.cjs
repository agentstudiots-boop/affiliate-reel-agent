const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {validatePlan}=require('../.test-build/lib/enterprise/plan');
const {envelopeFromStep,checkHealth,checkResult,checkEnvelope}=require('../.test-build/lib/enterprise/contract');
const {affiliateDepartment,affiliateContext,DAILY_OUTCOMES,DELIVERY}=require('../.test-build/lib/enterprise/departments/affiliate');

const NOW=new Date('2026-11-01T12:00:00Z');
const hoursAgo=h=>new Date(NOW.getTime()-h*3600*1000).toISOString();
const run=(db,invokedAt,outcome,whatsapp=outcome==='awaiting_approval'?'approval_sent':null)=>db.query('INSERT INTO daily_slot_runs(id,invoked_at,outcome,whatsapp) VALUES($1,$2,$3,$4)',[crypto.randomUUID(),invokedAt,outcome,whatsapp]);
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
  assert.match(report.reason,/kein Cron-Aufruf/);
  assert.equal(checkHealth(report,'affiliate').ok,true);
  await db.close();
});

test('recent delivered approval request: ok with evidence from the real tables (AC-2)',async()=>{
  const db=await pgliteDatabase();
  await run(db,hoursAgo(30),'error');
  await run(db,hoursAgo(5),'awaiting_approval');
  await run(db,hoursAgo(4),'outside_berlin_slot');
  await run(db,hoursAgo(200),'awaiting_approval'); // outside the 7-day window
  await db.query(`INSERT INTO instagram_image_posts(publication_id,status,updated_at) VALUES($1,'published',$2),($3,'failed',$2)`,[crypto.randomUUID(),hoursAgo(10),crypto.randomUUID()]);
  const report=await affiliateDepartment.health(affiliateContext(db,()=>NOW));
  assert.equal(report.status,'ok',report.reason);
  assert.equal(checkHealth(report,'affiliate').ok,true);
  assert.equal(evidence(report,'Cron-Aufrufe Tagesentwurf (7 Tage)'),3);
  assert.equal(evidence(report,'davon Fehler'),1);
  assert.equal(evidence(report,'Freigabeanfragen zugestellt (7 Tage)'),1);
  assert.equal(evidence(report,'Entwürfe ohne Zustellung (7 Tage)'),0);
  assert.equal(evidence(report,'letzte zugestellte Freigabeanfrage'),hoursAgo(5));
  assert.equal(evidence(report,'letztes Slot-Ergebnis'),'awaiting_approval');
  assert.equal(evidence(report,'veröffentlicht Instagram-Bilder (7 Tage)'),1);
  assert.equal(evidence(report,'offene Inhaltsfreigaben'),0);
  await db.close();
});

test('a draft whose approval request did not reach the operator is never ok (review #87 major)',async()=>{
  for(const whatsapp of [...DELIVERY.undelivered,null]){
    const db=await pgliteDatabase();
    await run(db,hoursAgo(3),'awaiting_approval',whatsapp);
    const report=await affiliateDepartment.health(affiliateContext(db,()=>NOW));
    assert.notEqual(report.status,'ok',String(whatsapp));
    assert.equal(evidence(report,'Freigabeanfragen zugestellt (7 Tage)'),0,String(whatsapp));
    assert.equal(evidence(report,'Entwürfe ohne Zustellung (7 Tage)'),1,String(whatsapp));
    await db.close();
  }
  // Delivered earlier, but the latest request failed: degraded.
  const db=await pgliteDatabase();
  await run(db,hoursAgo(20),'awaiting_approval');
  await run(db,hoursAgo(2),'awaiting_approval','approval_send_failed');
  await run(db,hoursAgo(1),'outside_berlin_slot');
  assert.deepEqual((({status,reason})=>[status,reason])(await affiliateDepartment.health(affiliateContext(db,()=>NOW))),['degraded','letzte Freigabeanfrage nicht beim Betreiber angekommen']);
  // A failed resend of a pending approval (already_claimed + approval_send_failed) also counts as undelivered.
  await run(db,hoursAgo(0.5),'already_claimed','approval_send_failed');
  assert.equal(evidence(await affiliateDepartment.health(affiliateContext(db,()=>NOW)),'Entwürfe ohne Zustellung (7 Tage)'),2);
  // A successful resend counts as delivered.
  await run(db,hoursAgo(0.2),'already_claimed','approval_sent');
  assert.equal((await affiliateDepartment.health(affiliateContext(db,()=>NOW))).status,'ok');
  await db.close();
});

test('failed runs are degraded even behind idle cron calls; no delivered request for two days or a future timestamp is degraded (AC-3)',async()=>{
  for(const failure of ['error','failed']){
    const db=await pgliteDatabase();
    await run(db,hoursAgo(20),'awaiting_approval');
    await run(db,hoursAgo(3),failure);
    await run(db,hoursAgo(2),'already_claimed');
    await run(db,hoursAgo(1),'outside_berlin_slot');
    const report=await affiliateDepartment.health(affiliateContext(db,()=>NOW));
    assert.deepEqual([report.status,report.reason],['degraded','letzter Tageslauf fehlgeschlagen'],failure);
    await db.close();
  }
  const stale=await pgliteDatabase();
  await run(stale,hoursAgo(60),'awaiting_approval');
  await run(stale,hoursAgo(5),'needs_input');
  const report=await affiliateDepartment.health(affiliateContext(stale,()=>NOW));
  assert.equal(report.status,'degraded');
  assert.match(report.reason,/über zwei Tagen kein Entwurf/);
  await stale.close();
  const future=await pgliteDatabase();
  await run(future,hoursAgo(-2),'awaiting_approval');
  assert.match((await affiliateDepartment.health(affiliateContext(future,()=>NOW))).reason,/Zukunft/);
  await future.close();
});

test('outcome and delivery lists match what the studio writes, in both directions (AC-2/AC-3, review #87 minor 2)',()=>{
  const route=fs.readFileSync('app/api/cron/daily-draft/route.ts','utf8');
  const draft=fs.readFileSync('lib/daily/draft.ts','utf8');
  const known=[DAILY_OUTCOMES.draft,...DAILY_OUTCOMES.failures,...DAILY_OUTCOMES.idle,...DAILY_OUTCOMES.neutral];
  // Every known outcome is written somewhere …
  for(const value of known)assert.match(route+draft,new RegExp(`["']${value}["']`),value);
  // … and every outcome the studio writes is known: literals in route.ts, statuses returned by runDailyDraft.
  const written=new Set([...route.matchAll(/outcome:\s*"([a-z_]+)"/g)].map(m=>m[1]));
  for(const m of draft.matchAll(/return\s*\{\s*status\s*:\s*['"]([a-z_]+)['"]/g))written.add(m[1]);
  for(const m of (draft.match(/const status = [^;]+;/)?.[0]??'').matchAll(/"([a-z_]+)"/g))written.add(m[1]);
  assert.ok(written.size>=5,[...written].join(','));
  for(const value of written)assert.ok(known.includes(value),`Outcome ${value} ist im Adapter nicht eingeordnet`);
  // Every WhatsApp delivery value the studio knows is classified, and only those.
  const labels=fs.readFileSync('lib/daily/evidence.ts','utf8').match(/WHATSAPP_LABEL[^{]*\{([^}]*)\}/)[1];
  const values=[...labels.matchAll(/(?:^|[{,])\s*([a-z_]+):\s*"/g)].map(m=>m[1]).sort();
  assert.deepEqual([...DELIVERY.delivered,...DELIVERY.undelivered].sort(),values);
});

test('published counts are split by platform (review #87 minor 3)',async()=>{
  const db=await pgliteDatabase();
  await run(db,hoursAgo(3),'awaiting_approval');
  const report=await affiliateDepartment.health(affiliateContext(db,()=>NOW));
  for(const label of ['veröffentlicht Facebook (7 Tage)','veröffentlicht Instagram-Reels (7 Tage)','veröffentlicht Instagram-Bilder (7 Tage)'])assert.equal(evidence(report,label),0,label);
  const source=fs.readFileSync('lib/enterprise/departments/affiliate.ts','utf8');
  assert.match(source,/platform='facebook'/);assert.match(source,/platform='instagram'/);
  await db.close();
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
    assert.match(statements[i+1],/^(SELECT|WITH)\b/);
    assert.doesNotMatch(statements[i+1],/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE)\b/i);
  }
});

test('status report task returns figures within budget; publication requests are never handled (AC-6)',async()=>{
  const db=await pgliteDatabase();
  await run(db,hoursAgo(3),'awaiting_approval');
  const envelope=envelopeFor('affiliate.status_report');
  assert.equal(checkEnvelope(envelope).ok,true);
  const result=await affiliateDepartment.handle(envelope,affiliateContext(db,()=>NOW));
  assert.equal(result.status,'succeeded');
  assert.deepEqual([result.output.totalRuns,result.output.drafts],[1,1]);
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
