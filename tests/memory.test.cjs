const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {memoryRepository,productId}=require('../.test-build/lib/memory/repository');
const {evaluateHistory}=require('../.test-build/lib/memory/learning');
const {performanceSchema}=require('../.test-build/lib/memory/schema');
const {authorized}=require('../.test-build/lib/memory/auth');
const {applyMigrations}=require('../.test-build/lib/memory/migrations');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');
const opportunity=opportunitySchema.parse({product:{productVerifiedAt:'2026-09-26T08:00:00.000Z', productVerifiedName:'Vakuumierer', name:'Vakuumierer',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'',price:'',targetGroup:'Familien',benefits:'Vorräte vorbereiten',notes:''},useCase:'Oma staunt beim Familienessen über das Steak.',category:'kitchen',useCaseKey:'sous-vide',targetPlatform:'facebook'});
const oldDate=new Date(Date.now()-40*86400000).toISOString();
function metric(jobId,changes={}){return {jobId,platform:'facebook',status:'published',url:'https://www.facebook.com/example/posts/123',publishedAt:oldDate,windowDays:30,finalized:true,clicks:100,conversions:5,revenueCents:2000,costCents:500,source:'Manuell zugeordneter Testbericht',learning:'',expectedRevision:0,...changes};}

test('explicit migrations are transactional and idempotent',async()=>{
  const pg=new PGlite();
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  try{
    const loader=name=>fs.readFileSync(`db/migrations/${name}`,'utf8');
    const first=await applyMigrations(db,loader);
    const second=await applyMigrations(db,loader);
    assert.deepEqual(first,{applied:['001_memory.sql','002_production_gates.sql','003_faceless_so.sql','004_daily_drafts.sql','005_publication_gate.sql','006_daily_notification.sql','007_publication_revisions.sql','008_weekly_reports.sql','009_original_visual_attempts.sql','010_replicate_visual_provider.sql','011_instagram_reel_publications.sql'],alreadyApplied:[]});
    assert.deepEqual(second,{applied:[],alreadyApplied:['001_memory.sql','002_production_gates.sql','003_faceless_so.sql','004_daily_drafts.sql','005_publication_gate.sql','006_daily_notification.sql','007_publication_revisions.sql','008_weekly_reports.sql','009_original_visual_attempts.sql','010_replicate_visual_provider.sql','011_instagram_reel_publications.sql']});
    const tables=await pg.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    assert.ok(tables.rows.some(row=>row.tablename==='content_jobs'));
    assert.ok(tables.rows.some(row=>row.tablename==='production_runs'));
    assert.ok(tables.rows.some(row=>row.tablename==='approval_requests'));
    assert.ok(tables.rows.some(row=>row.tablename==='daily_drafts'));
    assert.ok(tables.rows.some(row=>row.tablename==='publication_requests'));
    assert.ok(tables.rows.some(row=>row.tablename==='weekly_reports'));
  }finally{await pg.close();}
});

test('Postgres: durable job/events, atomic approval, versioned measurements, learning, conflicts and rollback',async()=>{
  const pg=new PGlite();
  const db={query:(q,v)=>pg.query(q,v),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v)}))};
  try{
    const migration=fs.readFileSync('db/migrations/001_memory.sql','utf8');await pg.exec(migration);await pg.exec(migration);
    const repo=memoryRepository(db);
    async function create(changes={}) {
      const input=opportunitySchema.parse({...opportunity,...changes});const id=crypto.randomUUID();
      await repo.claim(id,input,'reference');
      const job=await runContentJob(input,{id,onUpdate:repo.save,loadLearning:repo.learn});
      assert.equal(job.status,'awaiting_approval',JSON.stringify(job.review));await repo.approve(id);return job;
    }
    const videos=[];const images=[];
    for(let i=0;i<3;i++){
      const video=await create();videos.push(video);
      await repo.recordPerformance(metric(video.id,{costCents:5000,revenueCents:500,conversions:2}));
      const image=await create({budget:'low'});images.push(image);
      await repo.recordPerformance(metric(image.id));
    }
    assert.equal(videos[0].content.format,'video');assert.equal(images[0].content.format,'image');
    const learned=await repo.learn(opportunity);assert.equal(learned.groups.length,2);
    assert.ok(learned.groups.find(g=>g.format==='image').adjustment>0);
    const changed=await create();assert.equal(changed.content.format,'image','historical profit should change the next decision');
    assert.ok(changed.events.some(e=>e.data?.version==='rules-v1'));
    const id=images[0].id;
    const second=await repo.recordPerformance(metric(id,{expectedRevision:1,clicks:120,revenueCents:2500,learning:'Aktualisierter Stand'}));
    assert.equal(Number(second.profit_cents),2000);assert.equal(Number(second.roi),4);
    assert.equal((await repo.performance(id))[0].revision,2);
    assert.equal((await repo.learn(opportunity)).groups.find(g=>g.format==='image').clicks,320,'cumulative snapshots must not be summed');
    await assert.rejects(repo.recordPerformance(metric(id,{url:'https://example.org/wrong',expectedRevision:1})),/zwischenzeitlich/);
    assert.equal((await repo.performance(id))[0].url,'https://www.facebook.com/example/posts/123');
    const zero=await repo.recordPerformance(metric(id,{expectedRevision:2,costCents:0}));assert.equal(zero.roi,null);
    const unknown=await repo.recordPerformance(metric(id,{expectedRevision:3,costCents:null}));assert.equal(unknown.profit_cents,null);assert.equal(unknown.roi,null);
    assert.equal((await repo.learn(opportunity)).groups.length,1,'unknown costs exclude case, then sample threshold applies');
    const other=await repo.learn({...opportunity,useCaseKey:'vorratshaltung'});assert.equal(other.sampleIds.length,0);
    assert.equal((await repo.learn({...opportunity,targetPlatform:'instagram'})).sampleIds.length,0);
    await assert.rejects(repo.claim(id,opportunity,'reference'),/existiert/);
    const persisted=(await repo.list()).find(j=>j.id===id);assert.equal(persisted.status,'approved');
    const events=await pg.query('SELECT count(*) AS n FROM job_events WHERE job_id=$1',[id]);assert.equal(Number(events.rows[0].n),persisted.events.length);
    const staleId=crypto.randomUUID();await repo.claim(staleId,opportunity,'reference');
    await pg.query("UPDATE content_jobs SET updated_at=now()-interval '11 minutes' WHERE id=$1",[staleId]);
    assert.equal((await repo.list()).find(j=>j.id===staleId).status,'interrupted');
    const costDraft=await repo.recordPerformance(metric(staleId,{status:'draft',url:'',publishedAt:'',finalized:false,costCents:123}));assert.equal(Number(costDraft.profit_cents),1877);
    await assert.rejects(repo.recordPerformance(metric(staleId,{expectedRevision:1})),/freigeben/);
    // Simulate an event insert failure: snapshot UPDATE and event INSERT must roll back together.
    const failureId=crypto.randomUUID();const base=await repo.claim(failureId,opportunity,'reference');
    await assert.rejects(repo.save({...base,status:'checking',events:[{sequence:1,at:'invalid timestamp',agent:'orchestrator',kind:'status',message:'test'}]}));
    const rolledBack=await pg.query('SELECT status,event_sequence FROM content_jobs WHERE id=$1',[failureId]);assert.equal(rolledBack.rows[0].status,'queued');assert.equal(rolledBack.rows[0].event_sequence,0);
  }finally{await pg.close();}
});

test('learning: small cohorts, equal performance and zero-cost ROI are handled honestly',()=>{
  const base={jobId:'sample',format:'text',platform:'facebook',clicks:100,conversions:10,revenueCents:1000,costCents:0,windowDays:30};
  assert.equal(evaluateHistory([base]).groups.length,0);
  const sample=['a','b','c'].map(jobId=>({...base,jobId}));
  assert.equal(evaluateHistory(sample).groups[0].roi,null);assert.equal(evaluateHistory(sample).groups[0].adjustment,0);
  const equal=evaluateHistory([...sample,...sample.map(c=>({...c,jobId:c.jobId+'v',format:'video'}))]);
  assert.ok(equal.groups.every(g=>g.adjustment===0));
});

test('measurement validation prevents premature finalization, negatives and unsafe URLs',()=>{
  const id=crypto.randomUUID();
  assert.equal(performanceSchema.safeParse(metric(id,{publishedAt:new Date().toISOString()})).success,false);
  assert.equal(performanceSchema.safeParse(metric(id,{costCents:-1})).success,false);
  assert.equal(performanceSchema.safeParse(metric(id,{url:'http://example.org'})).success,false);
  assert.equal(performanceSchema.safeParse(metric(id,{costCents:null})).success,true);
});

test('authorization fails closed; product identity ignores tracking parameters',()=>{
  const previous=process.env.CONTENT_STUDIO_PASSWORD;process.env.CONTENT_STUDIO_PASSWORD='test-code';
  try{
    assert.equal(authorized(new Request('https://example.org')),false);
    assert.equal(authorized(new Request('https://example.org',{headers:{'x-content-password':'wrong'}})),false);
    assert.equal(authorized(new Request('https://example.org',{headers:{'x-content-password':'test-code'}})),true);
  }finally{if(previous===undefined)delete process.env.CONTENT_STUDIO_PASSWORD;else process.env.CONTENT_STUDIO_PASSWORD=previous;}
  assert.equal(productId('https://www.amazon.de/dp/B000000001?tag=abc'),productId('https://www.amazon.de/gp/product/B000000001?tag=def'));
  assert.equal(productId('https://www.amazon.de/s?k=Vakuumierer&tag=abc'),productId('https://www.amazon.de/s?tag=def&k=Vakuumierer'));
});
