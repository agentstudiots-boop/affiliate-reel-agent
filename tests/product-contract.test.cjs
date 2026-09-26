const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {amazonProduct,createAmazonAffiliateUrl,bindAmazonProduct,productIdentityError}=require('../.test-build/lib/amazon');
const {resolveAmazonProduct,findAmazonProduct}=require('../.test-build/lib/product-resolver');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {applyMigrations}=require('../.test-build/lib/memory/migrations');
const {publicationRepository}=require('../.test-build/lib/meta/publication-gate');
const {instagramReelRepository}=require('../.test-build/lib/meta/instagram-reel');
const {organicReelPayload,ORGANIC_REEL_CAPABILITIES}=require('../.test-build/lib/meta/instagram-publisher');
const loadRoute=require('./helpers/load-route.cjs');
const source='https://www.amazon.de/dp/B000000001'; // synthetic test ASIN, never a production default
function product(changes={}) {return bindAmazonProduct({name:'Kuscheldecke Modell X',sourceUrl:source,affiliateUrl:'',price:'',targetGroup:'Haushalte',benefits:'Eignung vor Kauf prüfen',notes:'',productVerifiedAt:'2026-09-26T08:00:00.000Z',productVerifiedName:'Kuscheldecke Modell X',...changes});}
function opportunity(p=product(),platform='facebook') {return opportunitySchema.parse({product:p,useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Tasse Tee.',category:'home_living',targetPlatform:platform,budget:platform==='instagram'?'quality':'low'});}
async function database(t){const pg=new PGlite();t.after(()=>pg.close());const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};await applyMigrations(db);return {pg,db,memory:memoryRepository(db)};}

test('accepts only concrete Amazon detail pages; rejects searches, categories, bestsellers, shortlinks and redirects',()=>{
  for(const url of [source,'https://amazon.de/Kuscheldecke/dp/B000000001/ref=abc?tag=old-21','https://www.amazon.de/gp/product/B000000001'])assert.equal(amazonProduct(url).asin,'B000000001');
  for(const url of ['https://www.amazon.de/s?k=Kuscheldecke','https://www.amazon.de/b?node=123','https://www.amazon.de/gp/bestsellers','https://www.amazon.de/','https://amzn.to/abc','https://www.amazon.de.evil.invalid/dp/B000000001','http://www.amazon.de/dp/B000000001',source+'?redirect=https://example.com',source+'/dp/B000000002']){
    assert.equal(amazonProduct(url),null,url);assert.equal(createAmazonAffiliateUrl(url),'',url);
  }
});

test('exact product resolution uses matching Amazon evidence and preserves the existing configured tracking ID',async t=>{
  const previous=process.env.AMAZON_ASSOCIATE_TAG;process.env.AMAZON_ASSOCIATE_TAG='existing-test-21';t.after(()=>{if(previous===undefined)delete process.env.AMAZON_ASSOCIATE_TAG;else process.env.AMAZON_ASSOCIATE_TAG=previous;});
  const evidence=async()=>[{id:'fixture',title:'Kuscheldecke Modell X : Amazon.de: Küche, Haushalt & Wohnen',url:source,content:'No specifications verified'}];
  const resolved=await resolveAmazonProduct({...product(),productVerifiedAt:'forged'},evidence);
  assert.equal(resolved.name,'Kuscheldecke Modell X');assert.equal(resolved.asin,'B000000001');
  assert.equal(resolved.trackingId,'existing-test-21');assert.equal(resolved.affiliateUrl,source+'?tag=existing-test-21');
  assert.equal(resolved.price,'');assert.ok(Date.parse(resolved.productVerifiedAt));assert.equal(productIdentityError(resolved),null);
  await assert.rejects(resolveAmazonProduct({...product(),name:'Netzwerkswitch'},evidence),/product_unresolved/);
  await assert.rejects(resolveAmazonProduct(product(),async()=>[{title:'Amazon Suche',url:'https://www.amazon.de/s?k=Kuscheldecke'}]),/product_unresolved/);
  await assert.rejects(resolveAmazonProduct(product(),async()=>{throw Error('unavailable');}),/product_unresolved/);
});

test('ASIN, affiliate link, name and verification evidence cannot refer to different products',()=>{
  assert.throws(()=>product({affiliateUrl:'https://www.amazon.de/dp/B000000002'}),/product_unresolved/);
  assert.throws(()=>product({asin:'B000000002'}),/product_unresolved/);
  for(const changes of [{asin:'B000000002'},{name:'Anderes Produkt'},{productVerifiedAt:undefined},{affiliateUrl:source+'?tag=wrong-21'},{affiliateUrl:'https://www.amazon.de/s?k=Kuscheldecke'}])assert.equal(productIdentityError({...product(),...changes}),'product_unresolved');
});

test('unresolved content is saved as needs_input with no affiliate link and no specialist or approval',async t=>{
  const f=await database(t),p={...product(),sourceUrl:'https://www.amazon.de/s?k=Kuscheldecke',asin:undefined,productUrl:undefined,affiliateUrl:''};
  const input=opportunity(p),id=crypto.randomUUID();await f.memory.claim(id,input,'reference');
  const job=await runContentJob(input,{id,onUpdate:f.memory.save,generate:()=>{throw Error('specialist must not run');}});
  assert.equal(job.status,'needs_input');assert.equal(job.error,'product_unresolved');assert.equal(job.opportunity.product.affiliateUrl,'');assert.equal(job.content,undefined);
  await assert.rejects(f.memory.approve(id),/product_unresolved/);
  const saved=(await f.memory.list()).find(x=>x.id===id);assert.equal(saved.error,'product_unresolved');
});

test('an existing job cannot be rebound to another ASIN or product name',async t=>{
  const f=await database(t),input=opportunity(),id=crypto.randomUUID();await f.memory.claim(id,input,'reference');
  const job=await runContentJob(input,{id,onUpdate:f.memory.save});job.opportunity.product=product({name:'Kuscheldecke Modell Y',productVerifiedName:'Kuscheldecke Modell Y',sourceUrl:'https://www.amazon.de/dp/B000000002'});job.events.push({...job.events.at(-1),sequence:job.events.length+1});
  await assert.rejects(f.memory.save(job),/product_unresolved/);
});

test('Reel CTA stays textual, rejects a different product target, and cannot create a simulated Shopping button',async()=>{
  const job=await runContentJob(opportunity(product(),'instagram'),{allowedFormats:['video']});assert.equal(job.status,'awaiting_approval');
  assert.match(job.content.cta,/Produktname, ASIN und Produktlink/);
  assert.equal(productIdentityError(job.opportunity.product,job.content.cta+' '+job.opportunity.product.affiliateUrl),null);
  assert.equal(productIdentityError(job.opportunity.product,'ASIN B000000002'),'product_unresolved');
  assert.equal(productIdentityError(job.opportunity.product,'https://www.amazon.de/dp/B000000002?tag=alltaeglichle-21'),'product_unresolved');
  assert.equal(productIdentityError(job.opportunity.product,'Jetzt shoppen'),'unsupported_shopping_cta');
  assert.equal(ORGANIC_REEL_CAPABILITIES.externalShoppingButton,false);
  const payload=organicReelPayload('https://exports.faceless.so/test.mp4','Werbung | Produktdetails');
  assert.deepEqual([...payload.keys()],['media_type','video_url','caption','share_to_feed']);
  assert.throws(()=>organicReelPayload('video','caption',product().affiliateUrl),/Instagram Graph API/);
});

test('final Facebook and Instagram writes reject legacy search jobs and tampered captions',async t=>{
  const f=await database(t);
  for(const platform of ['facebook','instagram']){
    const id=crypto.randomUUID(),input=opportunity(product(),platform);await f.memory.claim(id,input,'reference');
    await runContentJob(input,{id,onUpdate:f.memory.save,allowedFormats:[platform==='instagram'?'video':'image']});
    const job=await f.memory.approve(id);let repo,pending;
    if(platform==='instagram'){
      await f.pg.query("INSERT INTO production_runs(id,job_id,content_type,provider,provider_mode,status,output_url) VALUES($1,$2,'video','faceless_video','FACELESS_STORYBOARD','ready','https://exports.faceless.so/a.mp4')",[crypto.randomUUID(),id]);
      repo=instagramReelRepository(f.db);pending=await repo.prepare(id,'4912345678');
      assert.ok(pending.caption.includes(job.opportunity.product.affiliateUrl));assert.match(pending.caption,/ASIN B000000001/);
    }else {repo=publicationRepository(f.db);pending=await repo.prepare(id,'4912345678');}
    await f.pg.query("UPDATE publication_requests SET status='approved',whatsapp_message_id=$2,image_url='https://images.example.org/a.png' WHERE id=$1",[pending.id,'wamid.'+id]);
    await f.pg.query("UPDATE publication_requests SET caption=caption||' https://www.amazon.de/s?k=other' WHERE id=$1",[pending.id]);
    const claim=()=>platform==='instagram'?repo.claimContainer(pending.id):repo.claimPublish(pending.id);
    await assert.rejects(claim(),/product_unresolved/);
    job.opportunity.product.sourceUrl='https://www.amazon.de/s?k=Kuscheldecke';await f.pg.query('UPDATE content_jobs SET snapshot=$2 WHERE id=$1',[id,JSON.stringify(job)]);
    await assert.rejects(claim(),/product_unresolved/);
    assert.equal((await f.pg.query('SELECT publish_attempted_at FROM publication_requests WHERE id=$1',[pending.id])).rows[0].publish_attempted_at,null);
  }
});

test('the legacy unbound paid clip endpoint cannot bypass product identity and cost approval',async()=>{
  const route=loadRoute('app/api/video/start/route.ts');const response=await route.POST();assert.equal(response.status,410);assert.equal((await response.json()).notStarted,true);
});

test('a seasonal category idea resolves to one actual named product without turning its research query into a link',async()=>{
  const resolved=await findAmazonProduct('Wärmende Kuscheldecke','Kuscheldecke Herbst','Haushalte',async()=>[{id:'fixture',title:'Kuscheldecke Modell X : Amazon.de: Wohnen',url:source,content:''}]);
  assert.equal(resolved.name,'Kuscheldecke Modell X');assert.equal(resolved.asin,'B000000001');assert.equal(productIdentityError(resolved),null);
});
