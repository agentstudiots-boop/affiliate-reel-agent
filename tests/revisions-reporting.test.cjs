const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {productionRepository}=require('../.test-build/lib/production/repository');
const {publicationRepository}=require('../.test-build/lib/meta/publication-gate');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');
const {buildWeeklyReportData,formatWeeklyReport,previousWeek}=require('../.test-build/lib/reporting/weekly');

const migrations=['001_memory.sql','002_production_gates.sql','003_faceless_so.sql','004_daily_drafts.sql','005_publication_gate.sql','006_daily_notification.sql','007_publication_revisions.sql','008_weekly_reports.sql'];
const opportunity=opportunitySchema.parse({
  product:{productVerifiedAt:'2026-09-26T08:00:00.000Z', productVerifiedName:'Kuscheldecke', name:'Kuscheldecke',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'https://www.amazon.de/dp/B000000001',price:'',targetGroup:'Haushalte',benefits:'Größe und Material vergleichen',notes:''},
  useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Decke.',
  targetPlatform:'facebook',
  budget:'low'
});
function database(pg){return {query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};}
async function migrate(pg){for(const file of migrations)await pg.exec(fs.readFileSync(`db/migrations/${file}`,'utf8'));}

test('natural WhatsApp feedback creates a new image/text plan and a versioned publication request',async()=>{
  const pg=new PGlite(),db=database(pg);
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  try{
    await migrate(pg);
    const memory=memoryRepository(db),publication=publicationRepository(db),inbound=productionRepository(db);
    const id=crypto.randomUUID();await memory.claim(id,opportunity,'reference');
    const planned=await runContentJob(opportunity,{id,onUpdate:memory.save,loadLearning:memory.learn});
    assert.equal(planned.content.format,'image');
    const approved=await memory.approve(id);
    const first=await publication.prepare(id,'491234');
    assert.equal(first.revision,1);
    await publication.claimImage(first.id);
    await publication.bindImage(first.id,'https://example.public.blob.vercel-storage.com/image.png');
    await publication.claimWhatsAppSend(first.id);
    await publication.bindMessage(first.id,'wamid.pub.revision1');

    const feedback=await inbound.applyIncomingWhatsApp({
      id:'wamid.feedback.revision1',from:'491234',body:'Bitte kürzer und weniger werblich. CTA sachlicher.',
      replyToMessageId:'wamid.pub.revision1',payload:{}
    });
    assert.equal(feedback.intent,'changes_requested');
    const revised=await publication.reviseRequested(first.id);
    assert.equal(revised.job.status,'awaiting_approval');
    assert.equal(revised.job.revisions,approved.revisions+1);
    assert.equal(revised.daily,false);
    assert.notEqual(revised.job.content.caption,approved.content.caption);
    assert.match(revised.job.content.cta,/Interesse|vergleichen|prüfen/);
    assert.equal((await publication.get(id)).status,'changes_requested');
    assert.equal((await publication.get(id)).revision,1);

    await memory.approve(id);
    const second=await publication.prepare(id,'491234');
    assert.equal(second.revision,2);
    assert.notEqual(second.id,first.id);
    assert.equal(second.status,'preparing');
    assert.equal((await pg.query("SELECT count(*)::int AS n FROM publication_requests WHERE job_id=$1",[id])).rows[0].n,2);
  }finally{
    if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;
    await pg.close();
  }
});

test('weekly report aggregates only stored measurements and keeps follower provenance explicit',async()=>{
  const pg=new PGlite(),db=database(pg);
  try{
    await migrate(pg);
    const memory=memoryRepository(db);
    const id=crypto.randomUUID();await memory.claim(id,opportunity,'reference');
    await runContentJob(opportunity,{id,onUpdate:memory.save,loadLearning:memory.learn});
    await memory.approve(id);
    const publicationId=crypto.randomUUID();
    await pg.query("INSERT INTO publications(id,job_id,platform,status,url,published_at) VALUES($1,$2,'facebook','published',$3,$4)",
      [publicationId,id,'https://www.facebook.com/example/posts/weekly','2026-09-16T12:00:00.000Z']);
    await pg.query(`INSERT INTO performance_observations(id,publication_id,revision,observed_at,window_days,finalized,clicks,conversions,affiliate_revenue_cents,production_cost_cents,source,learning)
      VALUES($1,$2,1,$3,14,false,120,4,2500,700,'Testmessung','')`,
      [crypto.randomUUID(),publicationId,'2026-09-19T12:00:00.000Z']);
    await pg.query(`INSERT INTO production_runs(id,job_id,content_type,provider,provider_mode,status,estimated_provider_credits,provider_request_attempted_at)
      VALUES($1,$2,'video','faceless_video','FACELESS_STORYBOARD','ready',20,$3)`,
      [crypto.randomUUID(),id,'2026-09-18T10:00:00.000Z']);
    await pg.query("INSERT INTO weekly_reports(week_start,week_end,status,report_text,metrics) VALUES('2026-09-07','2026-09-14','sent','alt',$1)",
      [JSON.stringify({facebookFollowers:95,instagramFollowers:48})]);

    const start=new Date('2026-09-14T00:00:00.000Z'),end=new Date('2026-09-21T00:00:00.000Z');
    const metrics=await buildWeeklyReportData(db,start,end,{facebookFollowers:100,instagramFollowers:50});
    assert.equal(metrics.publishedTotal,1);
    assert.equal(metrics.clicks,120);
    assert.equal(metrics.conversions,4);
    assert.equal(metrics.revenueCents,2500);
    assert.equal(metrics.knownCostCents,700);
    assert.equal(metrics.facelessPaidStarts,1);
    assert.equal(metrics.facelessCredits,20);
    assert.equal(metrics.facebookFollowerDelta,5);
    assert.equal(metrics.instagramFollowerDelta,2);
    const text=formatWeeklyReport(start,end,metrics);
    assert.match(text,/Klicks 120/);
    assert.match(text,/Verkäufe\/Conversions 4/);
    assert.match(text,/Facebook-Follower: 100 \(\+5\)/);
    assert.match(text,/nicht geschätzt/);
    assert.equal(previousWeek(new Date('2026-09-24T03:00:00.000Z')).weekStart,'2026-09-14');
  }finally{await pg.close();}
});

test('weekly notification cannot approve anything and only the explicit request opens report delivery',async()=>{
  const pg=new PGlite(),db=database(pg);
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  try{
    await migrate(pg);
    await pg.query(`INSERT INTO weekly_reports(week_start,week_end,status,report_text,metrics,notification_send_attempted_at,notification_message_id)
      VALUES('2026-09-14','2026-09-21','notification_sent','Wochenbilanz Test','{}',now(),'wamid.weekly.notice')`);
    const inbound=productionRepository(db);
    const premature=await inbound.applyIncomingWhatsApp({id:'wamid.weekly.premature',from:'491234',body:'Freigeben',replyToMessageId:'wamid.weekly.notice',payload:{}});
    assert.equal(premature.reason,'weekly_notification_requires_request');
    const requested=await inbound.applyIncomingWhatsApp({id:'wamid.weekly.request',from:'491234',body:'Wochenbilanz',replyToMessageId:'wamid.weekly.notice',payload:{}});
    assert.equal(requested.intent,'weekly_report_reply');
    assert.equal(requested.weeklyReportWeekStart,'2026-09-14');
    assert.equal((await inbound.applyIncomingWhatsApp({id:'wamid.weekly.request',from:'491234',body:'Wochenbilanz',replyToMessageId:'wamid.weekly.notice',payload:{}})).reason,'duplicate');
  }finally{
    if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;
    await pg.close();
  }
});
