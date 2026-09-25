const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const loadRoute = require('./helpers/load-route.cjs');
const { applyMigrations } = require('../.test-build/lib/memory/migrations');
const { memoryRepository } = require('../.test-build/lib/memory/repository');
const { runContentJob } = require('../.test-build/lib/content/orchestrator');
const { opportunitySchema } = require('../.test-build/lib/content/schema');
const { instagramReelRepository } = require('../.test-build/lib/meta/instagram-reel');
const { productionRepository } = require('../.test-build/lib/production/repository');
const connection = require('../.test-build/lib/meta/connection');
const { instagramGraph } = require('../.test-build/lib/meta/instagram-publisher');

async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  const db = { query: (q,v) => pg.query(q,v), exec: q => pg.exec(q),
    transaction: fn => pg.transaction(tx => fn({ query: (q,v) => tx.query(q,v), exec: q => tx.exec(q) })) };
  await applyMigrations(db);
  const id = crypto.randomUUID();
  const opportunity = opportunitySchema.parse({
    product: { name: 'Kuscheldecke', sourceUrl: 'https://www.amazon.de/s?k=Kuscheldecke',affiliateUrl:'',price:'',targetGroup:'Haushalte', benefits:'Größe und Material vergleichen',notes:'' },
    useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Tasse Tee.',category:'home_living',targetPlatform:'instagram',budget:'quality'
  });
  const memory = memoryRepository(db);
  await memory.claim(id,opportunity,'reference');
  const planned = await runContentJob(opportunity,{ id, allowedFormats:['video'], onUpdate:memory.save });
  assert.equal(planned.status,'awaiting_approval',planned.error);
  assert.equal(planned.marketing.primary,'Instagram Reel');
  await memory.approve(id);
  const video = 'https://exports.faceless.so/renders/abc123/123.mp4';
  await pg.query("INSERT INTO production_runs(id,job_id,content_type,provider,provider_mode,status,output_url) VALUES($1,$2,'video','faceless_video','FACELESS_STORYBOARD','ready',$3)", [crypto.randomUUID(),id,video]);
  const repo = instagramReelRepository(db);
  return {pg,db,id,repo,video};
}

test('Instagram Reel needs a separately approved, unchanged finished video and claims both Graph writes once',async t=>{
  const f = await fixture(t);
  assert.equal(await f.repo.get(f.id),null);
  const first = await f.repo.prepare(f.id,'4912345678');
  assert.equal(first.status,'pending');
  assert.equal(first.videoUrl,f.video);
  assert.match(first.caption,/Werbung \|/);
  assert.equal((await f.repo.prepare(f.id,'4912345678')).id,first.id);
  await assert.rejects(f.repo.claimContainer(first.id),/nicht freigegeben/i);
  await f.repo.claimWhatsAppSend(first.id);
  await f.repo.bindMessage(first.id,'wamid.igtest');
  const inbound = productionRepository(f.db);
  const before = process.env.WHATSAPP_APPROVER_WA_ID;
  process.env.WHATSAPP_APPROVER_WA_ID='4912345678';
  t.after(()=>{ if(before===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=before; });
  const answer=await inbound.applyIncomingWhatsApp({id:'wamid.approve',from:'4912345678',body:'Freigeben',replyToMessageId:'wamid.igtest',payload:{}});
  assert.equal(answer.platform,'instagram');
  assert.equal((await f.repo.get(f.id)).status,'approved');
  const outcomes=await Promise.allSettled([f.repo.claimContainer(first.id),f.repo.claimContainer(first.id)]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  await f.repo.bindContainer(first.id,'18270815569115548');
  const publish=await Promise.allSettled([f.repo.claimMediaPublish(first.id),f.repo.claimMediaPublish(first.id)]);
  assert.equal(publish.filter(x=>x.status==='fulfilled').length,1);
  await f.repo.markPublished(first.id,'90011803596441');
  await f.repo.setPermalink(first.id,'https://www.instagram.com/reel/test/');
  assert.equal((await f.repo.get(f.id)).status,'published');
  assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM publications WHERE job_id=$1 AND platform='instagram'",[f.id])).rows[0].n,1);
});

test('route rejects unauthenticated requests and never retries a Graph POST when the first result is unknown',async t=>{
  const f=await fixture(t);
  const old=process.env.CONTENT_STUDIO_PASSWORD;
  process.env.CONTENT_STUDIO_PASSWORD='local-instagram-test';
  t.after(()=>{ if(old===undefined)delete process.env.CONTENT_STUDIO_PASSWORD;else process.env.CONTENT_STUDIO_PASSWORD=old; });
  const pending=await f.repo.prepare(f.id,'4912345678');
  await f.repo.claimWhatsAppSend(pending.id);
  await f.repo.bindMessage(pending.id,'wamid.igtest2');
  await f.pg.query("UPDATE publication_requests SET status='approved',decided_at=now() WHERE id=$1",[pending.id]);
  let createCalls=0;
  const route=loadRoute('app/api/instagram/reel/route.ts',{
    '@/lib/memory/db':{databaseConfigured:()=>true,getDatabase:()=>f.db},
    '@/lib/meta/instagram-reel':{instagramReelRepository:()=>f.repo,InstagramReelConflict:require('../.test-build/lib/meta/instagram-reel').InstagramReelConflict},
    '@/lib/meta/instagram-publisher':{instagramGraph:async()=>({create:async()=>{createCalls++;throw Error('lost response');}}),InstagramPublishFailure:require('../.test-build/lib/meta/instagram-publisher').InstagramPublishFailure},
  });
  const request=(auth)=>new Request('https://local.test/api/instagram/reel',{method:'POST',headers:{'Content-Type':'application/json',...(auth?{'x-content-password':'local-instagram-test'}:{})},body:JSON.stringify({jobId:f.id,action:'publish'})});
  assert.equal((await route.POST(request(false))).status,401);
  assert.equal(createCalls,0);
  assert.equal((await route.POST(request(true))).status,503);
  assert.equal((await f.repo.get(f.id)).status,'unknown');
  assert.equal((await route.POST(request(true))).status,409);
  assert.equal(createCalls,1);
});

test('Instagram Graph client sends REELS container and media_publish with bearer token only',async t=>{
  t.mock.method(connection,'cachedMetaConnection',async()=>({status:'connected',publishingReadCheck:true,resolved:{pageId:'123',instagramId:'456'}}));
  t.mock.method(connection,'metaConfig',()=>({token:'private-system-token',version:'v25.0'}));
  t.mock.method(connection,'pagePublishingToken',async()=>({status:'ready',token:'private-page-token'}));
  const calls=[];
  const transport=async (url,options)=>{
    const address=new URL(url);
    calls.push({path:address.pathname,search:address.search,method:options.method,body:String(options.body||''),authorization:options.headers.Authorization});
    const payload=address.pathname.endsWith('/media_publish')?{id:'789'}:options.method==='POST'?{id:'777'}:address.pathname.endsWith('/777')?{status_code:'FINISHED'}:{id:'789',permalink:'https://www.instagram.com/reel/xyz/'};
    return new Response(JSON.stringify(payload),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const graph=await instagramGraph(transport);
  const id=await graph.create('https://exports.faceless.so/renders/abc/123.mp4','Werbung | Eine Decke fürs Sofa.');
  assert.equal(id,'777');
  assert.equal(await graph.status(id),'FINISHED');
  assert.equal(await graph.publish(id),'789');
  assert.equal(await graph.permalink('789'),'https://www.instagram.com/reel/xyz/');
  assert.equal(calls.filter(call=>call.method==='POST').length,2);
  assert.match(calls[0].body,/media_type=REELS/);
  assert.match(calls[0].body,/share_to_feed=false/);
  assert.match(calls[2].body,/creation_id=777/);
  assert.ok(calls.every(call=>call.authorization==='Bearer private-page-token'));
  assert.ok(calls.every(call=>!call.search.includes('token')));
});

test('signed approval for Instagram never invokes the Facebook publisher; the Reel route publishes only once',async t=>{
  const f=await fixture(t);
  const env={CONTENT_STUDIO_PASSWORD:'local-instagram-test',WHATSAPP_APPROVER_WA_ID:'4912345678'};
  const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
  Object.assign(process.env,env);
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  const pub=await f.repo.prepare(f.id,env.WHATSAPP_APPROVER_WA_ID);
  await f.repo.claimWhatsAppSend(pub.id);
  await f.repo.bindMessage(pub.id,'wamid.reel');
  let facebookCalls=0,creates=0,publishes=0;
  const webhook=loadRoute('app/api/whatsapp/webhook/route.ts',{
    '@/lib/production/repository':{productionRepository:()=>productionRepository(f.db)},
    '@/lib/daily/draft':{sendDailyApproval:async()=>{throw Error('Unexpected daily flow')}},
    '@/lib/meta/request-publication':{requestFacebookApproval:async()=>{throw Error('Unexpected Facebook approval')}},
    '@/lib/reporting/weekly':{deliverWeeklyReport:async()=>{throw Error('Unexpected weekly flow')}},
    '@/lib/whatsapp/client':{sendWhatsAppText:async()=>{throw Error('Unexpected WhatsApp send')}},
    '@/lib/meta/publisher':{FacebookPublishFailure:class extends Error{},publishFacebookPhoto:async()=>{facebookCalls++;throw Error('Wrong platform');}},
    '@/lib/whatsapp/security':{verifyMetaWebhookSignature:()=>true,verifyWhatsAppChallenge:()=>false,
      extractIncomingWhatsAppMessages:()=>[{id:'wamid.reel.approve',from:env.WHATSAPP_APPROVER_WA_ID,body:'Freigeben',replyToMessageId:'wamid.reel'}]},
  });
  assert.equal((await webhook.POST(new Request('https://local.test/api/whatsapp/webhook',{method:'POST',body:'{}'}))).status,200);
  assert.equal(facebookCalls,0);
  assert.equal((await f.repo.get(f.id)).status,'approved');
  const route=loadRoute('app/api/instagram/reel/route.ts',{
    '@/lib/memory/db':{databaseConfigured:()=>true,getDatabase:()=>f.db},
    '@/lib/meta/instagram-reel':{instagramReelRepository:()=>f.repo,InstagramReelConflict:require('../.test-build/lib/meta/instagram-reel').InstagramReelConflict},
    '@/lib/meta/instagram-publisher':{instagramGraph:async()=>({create:async()=>{creates++;return '777'},status:async()=> 'FINISHED',publish:async()=>{publishes++;return '789'},permalink:async()=> 'https://www.instagram.com/reel/test/'}),InstagramPublishFailure:require('../.test-build/lib/meta/instagram-publisher').InstagramPublishFailure},
  });
  const request=action=>new Request('https://local.test/api/instagram/reel',{method:'POST',headers:{'Content-Type':'application/json','x-content-password':env.CONTENT_STUDIO_PASSWORD},body:JSON.stringify({jobId:f.id,action})});
  assert.equal((await route.POST(request('publish'))).status,200);
  assert.equal((await route.POST(request('publish'))).status,409);
  assert.equal((await route.POST(request('poll'))).status,200);
  assert.equal((await route.POST(request('poll'))).status,409);
  assert.equal(creates,1);assert.equal(publishes,1);
  assert.equal((await f.repo.get(f.id)).permalink,'https://www.instagram.com/reel/test/');
});
