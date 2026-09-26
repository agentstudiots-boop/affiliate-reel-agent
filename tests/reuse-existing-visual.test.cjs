const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {publicationRepository}=require('../.test-build/lib/meta/publication-gate');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');

test('one new WhatsApp approval can reuse the verified image while the old unknown attempt remains locked',async()=>{
  const pg=new PGlite();
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  try{
    for(const file of ['001_memory.sql','002_production_gates.sql','003_faceless_so.sql','004_daily_drafts.sql','005_publication_gate.sql','006_daily_notification.sql','007_publication_revisions.sql','008_weekly_reports.sql','009_original_visual_attempts.sql','010_replicate_visual_provider.sql','011_instagram_reel_publications.sql','012_whatsapp_instructions.sql'])await pg.exec(fs.readFileSync(`db/migrations/${file}`,'utf8'));
    const opportunity=opportunitySchema.parse({product:{productVerifiedAt:'2026-09-26T08:00:00.000Z', productVerifiedName:'Kuscheldecke', name:'Kuscheldecke',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'https://www.amazon.de/dp/B000000001',price:'',targetGroup:'Haushalte',benefits:'Größe und Material vergleichen',notes:''},useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Decke.',targetPlatform:'facebook',budget:'low'});
    const id=crypto.randomUUID(),memory=memoryRepository(db),repo=publicationRepository(db);
    await memory.claim(id,opportunity,'reference');
    await runContentJob(opportunity,{id,onUpdate:memory.save,loadLearning:memory.learn});
    await memory.approve(id);
    const claimed=await repo.claimVisual(id,'test-model','replicate');
    assert.equal(claimed.existing,null);
    const sha='a'.repeat(64);
    const url=`https://test.public.blob.vercel-storage.com/generated/facebook/${id}/${sha}.png`;
    const old=await repo.prepareWithVisual(id,'491234',{provider:'replicate',model:'test-model',mediaType:'image',url,sha256:sha});
    await pg.query("UPDATE publication_requests SET status='unknown',publish_attempted_at=now() WHERE id=$1",[old.id]);
    const next=await repo.reuseUnknownVisual(id,'491234');
    assert.equal(next.status,'pending');
    assert.equal(next.imageUrl,url);
    assert.equal(next.revision,old.revision+1);
    assert.notEqual(next.id,old.id);
    const records=(await pg.query('SELECT id,status,publish_attempted_at FROM publication_requests WHERE job_id=$1 ORDER BY revision',[id])).rows;
    assert.equal(records.length,2);
    assert.equal(records[0].status,'unknown');
    assert.ok(records[0].publish_attempted_at);
    assert.equal(records[1].status,'pending');
    assert.equal(records[1].publish_attempted_at,null);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM original_visual_attempts WHERE job_id=$1',[id])).rows[0].n,1);
    assert.equal((await repo.claimVisual(id,'test-model','replicate')).existing.id,next.id,'normal request sends approval without generating an image');
    await assert.rejects(repo.reuseUnknownVisual(id,'491234'),/Nur ein ungeklärter Post/);
    await assert.rejects(repo.claimPublish(old.id),/nicht freigegeben/);
  }finally{await pg.close()}
});
