const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const sharp=require('sharp');
const {PGlite}=require('@electric-sql/pglite');
const {approveContent}=require('./helpers/approve-content.cjs');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {productionRepository}=require('../.test-build/lib/production/repository');
const {publicationRepository}=require('../.test-build/lib/meta/publication-gate');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');
const {publishInstagramImage,resumeInstagramImages}=require('../.test-build/lib/meta/instagram-image');
const {validInstagramImageUrl,InstagramPublishFailure}=require('../.test-build/lib/meta/instagram-publisher');

async function fixture(t){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  const memory=memoryRepository(db),publication=publicationRepository(db),inbound=productionRepository(db);
  const opportunity=opportunitySchema.parse({product:{productVerifiedAt:'2026-09-26T08:00:00.000Z',productVerifiedName:'Kuscheldecke',name:'Kuscheldecke',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'https://www.amazon.de/dp/B000000001?tag=alltaeglichle-21',price:'',targetGroup:'Haushalte',benefits:'Größe und Material vergleichen',notes:''},useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Decke.',targetPlatform:'facebook',budget:'low'});
  const id=crypto.randomUUID();await memory.claim(id,opportunity,'reference');
  await runContentJob(opportunity,{id,onUpdate:memory.save,loadLearning:memory.learn});await approveContent(db,memory,id);
  const pending=await publication.prepare(id,'491234');await publication.claimImage(pending.id);
  await publication.bindImage(pending.id,`https://x.public.blob.vercel-storage.com/generated/facebook/${id}/${'a'.repeat(64)}.png`);
  await publication.claimWhatsAppSend(pending.id);await publication.bindMessage(pending.id,'wamid.pub');
  await inbound.applyIncomingWhatsApp({id:'wamid.ok',from:'491234',body:'Freigeben',replyToMessageId:'wamid.pub',payload:{}});
  const claimed=await publication.claimPublish(pending.id);await publication.published(claimed.id,'fb123','https://www.facebook.com/x/posts/1');
  const png=await sharp({create:{width:800,height:1000,channels:4,background:'#336699'}}).png().toBuffer();
  const calls={create:[],publish:0,status:0,notes:[],uploads:[]};
  const graphWith=(over={})=>async()=>({
    createImage:async(url,caption)=>{calls.create.push({url,caption});if(over.createError)throw over.createError;return '111';},
    status:async()=>{calls.status++;return over.statuses?.shift()||'FINISHED';},
    publish:async()=>{calls.publish++;if(over.publishError)throw over.publishError;return '222';},
    permalink:async()=>'https://www.instagram.com/p/abc/',
  });
  const deps=(over={})=>({db,graph:graphWith(over),send:async text=>{calls.notes.push(text);return 'wamid.n';},sleep:async()=>{},
    loadImage:async()=>over.png||png,upload:async(path,bytes)=>{calls.uploads.push({path,bytes});return `https://x.public.blob.vercel-storage.com/${path}`;}});
  return {db,pg,id,publicationId:claimed.id,calls,deps,png};
}

test('an approved Facebook photo is published once to Instagram as a JPEG feed image with the affiliate caption',async t=>{
  const f=await fixture(t);
  const result=await publishInstagramImage(f.publicationId,f.deps());
  assert.equal(result.status,'published');
  assert.equal(f.calls.publish,1);assert.equal(f.calls.create.length,1);
  const [upload]=f.calls.uploads;
  assert.match(upload.path,new RegExp(`^generated/instagram/${f.id}/[a-f0-9]{64}\\.jpg$`));
  assert.deepEqual([...upload.bytes.subarray(0,3)],[0xff,0xd8,0xff]);
  assert.ok(validInstagramImageUrl(f.calls.create[0].url));
  const caption=f.calls.create[0].caption;
  assert.match(caption,/tag=alltaeglichle-21/);assert.match(caption,/\nWerbung \| Affiliate-Link\n/);assert.ok(!/^Werbung/i.test(caption));
  assert.match(f.calls.notes.at(-1),/Instagram-Beitrag veröffentlicht: https:\/\/www\.instagram\.com\/p\/abc\//);
  const row=(await f.pg.query('SELECT status,media_id,permalink FROM instagram_image_posts')).rows[0];
  assert.deepEqual(row,{status:'published',media_id:'222',permalink:'https://www.instagram.com/p/abc/'});
  assert.equal((await publishInstagramImage(f.publicationId,f.deps())).status,'skipped');
  assert.equal(f.calls.publish,1);
});

test('a rejected container publishes nothing and is reported; an unknown publish result is never repeated',async t=>{
  const f=await fixture(t);
  const rejected=await publishInstagramImage(f.publicationId,f.deps({createError:new InstagramPublishFailure('container','graph_error',400,9004)}));
  assert.equal(rejected.status,'failed');assert.equal(f.calls.publish,0);
  assert.match(f.calls.notes.at(-1),/Facebook-Post ist online.*nicht veröffentlicht/);
  assert.equal((await publishInstagramImage(f.publicationId,f.deps())).status,'skipped');
  const g=await fixture(t);
  const unknown=await publishInstagramImage(g.publicationId,g.deps({publishError:new InstagramPublishFailure('publish','network_or_timeout')}));
  assert.equal(unknown.status,'unknown');assert.equal(g.calls.publish,1);
  assert.equal(await resumeInstagramImages(g.deps()),0);assert.equal(g.calls.publish,1);
  assert.match(g.calls.notes.at(-1),/Ergebnis unklar/);
});

test('a container that is still processing is published once by Status',async t=>{
  const f=await fixture(t);
  const first=await publishInstagramImage(f.publicationId,f.deps({statuses:Array(8).fill('PROCESSING')}));
  assert.equal(first.status,'processing');assert.equal(f.calls.publish,0);
  assert.equal(await resumeInstagramImages(f.deps()),1);assert.equal(f.calls.publish,1);
  assert.equal(await resumeInstagramImages(f.deps()),0);assert.equal(f.calls.publish,1);
});

test('an image outside the Instagram aspect range is reported instead of cropped, and URL validation is strict',async t=>{
  const f=await fixture(t);
  const wide=await sharp({create:{width:2000,height:500,channels:3,background:'#fff'}}).png().toBuffer();
  const result=await publishInstagramImage(f.publicationId,f.deps({png:wide}));
  assert.equal(result.status,'failed');assert.equal(f.calls.create.length,0);assert.match(result.detail,/aspect_ratio_not_supported/);
  const ok=`https://s.public.blob.vercel-storage.com/generated/instagram/${crypto.randomUUID()}/${'b'.repeat(64)}.jpg`;
  assert.ok(validInstagramImageUrl(ok));
  for(const bad of ['http'+ok.slice(5),ok.replace('.jpg','.png'),ok+'?x=1','https://evil.example/generated/instagram/x.jpg','https://s.public.blob.vercel-storage.com/other/x.jpg'])assert.ok(!validInstagramImageUrl(bad),bad);
});

test('Instagram never posts a caption that differs from the approved one (approval bound to content)',async t=>{
  const f=await fixture(t);
  await f.pg.query("UPDATE publication_requests SET caption=caption||' (alte Fassung)' WHERE id=$1",[f.publicationId]);
  const result=await publishInstagramImage(f.publicationId,f.deps());
  assert.equal(result.status,'failed');
  assert.match(result.detail,/approval_mismatch/);
  assert.equal(f.calls.create.length,0);assert.equal(f.calls.publish,0);
});
