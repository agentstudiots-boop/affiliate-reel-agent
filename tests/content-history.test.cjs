const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {applyMigrations}=require('../.test-build/lib/memory/migrations');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {timelineRepository}=require('../.test-build/lib/memory/timeline');
const {newContentId}=require('../.test-build/lib/content/identity');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');

function database(pg){return {query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};}
const opportunity=opportunitySchema.parse({product:{name:'Testprodukt',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'',price:'',targetGroup:'Köche',benefits:'Vorräte',notes:''},useCase:'Vorräte für eine Woche planen und zubereiten.',category:'kitchen',useCaseKey:'vorrat',targetPlatform:'facebook'});
const at=n=>`2026-09-${String(n).padStart(2,'0')}T12:00:00.000Z`;

test('content identity survives production workflow, parallel claims, reload and immutable backfill',async()=>{
  const pg=new PGlite(),db=database(pg);
  try{
    await applyMigrations(db);
    const repo=memoryRepository(db);
    const ids=Array.from({length:16},()=>crypto.randomUUID());
    const claimed=await Promise.all(ids.map(id=>repo.claim(id,opportunity,'reference')));
    assert.equal(new Set(claimed.map(j=>j.contentId)).size,16);
    assert.ok(claimed.every(j=>/^cnt_\d{8}_[a-f0-9]{32}$/.test(j.contentId)));
    assert.notEqual(newContentId(new Date('2026-09-25')),newContentId(new Date('2026-09-25')));
    const first=claimed[0];
    const finished=await runContentJob(opportunity,{id:first.id,contentId:first.contentId,onUpdate:job=>repo.save(job)});
    assert.equal(finished.contentId,first.contentId);
    assert.equal((await repo.list()).find(j=>j.id===first.id).contentId,first.contentId);
    await assert.rejects(db.query('UPDATE content_jobs SET content_id=$2 WHERE id=$1',[first.id,newContentId()]),/immutable/);
    await assert.rejects(db.query('INSERT INTO content_jobs(id,content_id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at) SELECT $1,content_id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at FROM content_jobs WHERE id=$2',[crypto.randomUUID(),first.id]));
    await assert.rejects(repo.save({...finished,contentId:newContentId(),events:[...finished.events,{sequence:finished.events.length+1,at:new Date().toISOString(),agent:'orchestrator',kind:'decision',message:'tamper'}]}),/content_id/);
  }finally{await pg.close();}
});

test('social, affiliate and price timelines retain history, reject conflicting retries, and compute honest deltas and ROI',async()=>{
  const pg=new PGlite(),db=database(pg);
  try{
    await applyMigrations(db);
    const memory=memoryRepository(db), timeline=timelineRepository(db);
    const job=await memory.claim(crypto.randomUUID(),opportunity,'reference');
    await timeline.bindAffiliateTracking(job.contentId,'amazon','custom-1');
    const publicationId=crypto.randomUUID();
    await db.query("INSERT INTO publications(id,job_id,platform,status,url,published_at,external_post_id) VALUES($1,$2,'facebook','published','https://facebook.com/123',$3,'page_123')",[publicationId,job.id,at(1)]);
    await assert.rejects(timeline.bindAffiliateTracking(job.contentId,'amazon','custom-2'),/veröffentlicht/);
    const base={contentId:job.contentId,publicationId,platform:'facebook',externalPostId:'page_123',source:'meta',sourceSnapshotId:'meta1',observedAt:at(2),views:120};
    assert.equal((await timeline.social(base)).created,true);
    assert.equal((await timeline.social(base)).created,false);
    await assert.rejects(timeline.social({...base,views:121}),/anderen Daten/);
    await assert.rejects(timeline.social({...base,sourceSnapshotId:'meta-bad',externalPostId:'wrong',observedAt:at(3)}),/mismatch/);
    await timeline.social({...base,sourceSnapshotId:'meta2',observedAt:at(4),views:900});
    const social=await timeline.history(job.contentId);
    assert.equal(social.social.length,2);
    assert.equal(social.social[0].views_delta,null);
    assert.equal(Number(social.social[1].views_delta),780);
    assert.equal(social.social[1].reach,null,'unknown is not zero');

    await assert.rejects(timeline.affiliate({contentId:job.contentId,trackingId:'other-tag',source:'amazon',sourceSnapshotId:'aff-bad',observedAt:at(2),clicks:3}),/Trackingcode/);
    const affiliate={contentId:job.contentId,trackingId:'custom-1',source:'amazon',sourceSnapshotId:'aff1',observedAt:at(2),clicks:3,orders:0,commissionCents:0};
    await timeline.affiliate(affiliate);
    assert.equal((await timeline.affiliate(affiliate)).created,false);
    await timeline.affiliate({...affiliate,sourceSnapshotId:'aff2',observedAt:at(4),clicks:18,orders:1,commissionCents:420});
    await assert.rejects(timeline.affiliate({...affiliate,sourceSnapshotId:'aff1',clicks:999}),/anderen Daten/);
    let history=await timeline.history(job.contentId);
    assert.equal(Number(history.affiliate[1].clicks_delta),15);
    assert.equal(Number(history.affiliate[1].orders_delta),1);
    assert.equal(Number(history.affiliate[1].commission_delta_cents),420);

    const productId=(await db.query('SELECT product_id FROM content_jobs WHERE id=$1',[job.id])).rows[0].product_id;
    const price={productId,contentId:job.contentId,source:'merchant',sourceSnapshotId:'p1',observedAt:at(2),priceCents:2999,currency:'EUR'};
    await timeline.price(price);
    await timeline.price({...price,sourceSnapshotId:'p2',observedAt:at(4),priceCents:2499,referencePriceCents:2999});
    assert.equal((await timeline.price(price)).created,false);
    await assert.rejects(timeline.price({...price,sourceSnapshotId:'p1',priceCents:1}),/anderen Daten/);
    history=await timeline.history(job.contentId);
    assert.equal(history.prices.length,2);
    assert.equal(history.prices[0].reference_price_cents,null);

    assert.equal((await timeline.economics(job.contentId)).profit,null);
    await timeline.cost({contentId:job.contentId,source:'openai',sourceEventId:'image-1',incurredAt:at(2),kind:'api',amountCents:100});
    await timeline.cost({contentId:job.contentId,source:'faceless',sourceEventId:'video-1',incurredAt:at(3),kind:'production',amountCents:200});
    const economics=await timeline.economics(job.contentId);
    assert.equal(Number(economics.revenue),420);
    assert.equal(Number(economics.cost),300);
    assert.equal(Number(economics.profit),120);
    assert.equal(Number(economics.roi),0.4);
    assert.equal(Number(economics.conversion_rate),1/18);
    assert.equal((await timeline.cost({contentId:job.contentId,source:'openai',sourceEventId:'image-1',incurredAt:at(2),kind:'api',amountCents:100})).created,false);
    await assert.rejects(db.query('DELETE FROM affiliate_performance_snapshots WHERE content_id=$1',[job.contentId]),/append-only/);
    await assert.rejects(db.query('INSERT INTO content_cost_events(id,content_id,source,source_event_id,incurred_at,kind,amount_cents) VALUES($1,$2,$3,$4,now(),$5,$6)',[crypto.randomUUID(),newContentId(),'test','orphan','api',1]));
  }finally{await pg.close();}
});
