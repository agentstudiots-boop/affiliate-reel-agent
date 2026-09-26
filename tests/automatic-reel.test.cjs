const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { applyMigrations } = require('../.test-build/lib/memory/migrations');
const dbModule = require('../.test-build/lib/memory/db');
const { memoryRepository } = require('../.test-build/lib/memory/repository');
const { productionRepository } = require('../.test-build/lib/production/repository');
const { instagramReelRepository } = require('../.test-build/lib/meta/instagram-reel');
const { runContentJob } = require('../.test-build/lib/content/orchestrator');
const { opportunitySchema } = require('../.test-build/lib/content/schema');
const providerModule = require('../.test-build/lib/production/faceless-so');
const graphModule = require('../.test-build/lib/meta/instagram-publisher');
const whatsapp = require('../.test-build/lib/whatsapp/client');
const { continuePendingReels } = require('../.test-build/lib/automation/continue');
const loadRoute = require('./helpers/load-route.cjs');

async function fixture(t) {
  const pg = new PGlite(); t.after(() => pg.close());
  const db = { query:(q,v)=>pg.query(q,v), exec:q=>pg.exec(q), transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)})) };
  await applyMigrations(db);
  t.mock.method(dbModule,'getDatabase',()=>db);
  t.mock.method(global,'fetch',async()=>{throw Error('No real network in tests');});
  const old=process.env.WHATSAPP_APPROVER_WA_ID;
  process.env.WHATSAPP_APPROVER_WA_ID='4912345678';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  const id=crypto.randomUUID(), memory=memoryRepository(db);
  const opportunity=opportunitySchema.parse({product:{name:'Kuscheldecke',sourceUrl:'https://www.amazon.de/s?k=Kuscheldecke',affiliateUrl:'',price:'',targetGroup:'Haushalte',benefits:'Größe und Material vergleichen',notes:''},useCase:'Ein kühler Herbstabend auf dem Sofa mit einer Tasse Tee.',category:'home_living',targetPlatform:'instagram',budget:'quality'});
  await memory.claim(id,opportunity,'reference');
  await runContentJob(opportunity,{id,allowedFormats:['video'],onUpdate:memory.save});
  const job=await memory.approve(id);
  const repo=productionRepository(db), publications=instagramReelRepository(db);
  await repo.prepareVideo(id);
  const approval=await repo.createRenderApproval({jobId:id,estimatedCostCents:null,estimatedProviderCredits:20,estimatedCommissionCents:null,summary:'20 Credits',approverWaId:'4912345678',script:providerModule.narration(job),voiceId:'de-test'});
  await repo.claimWhatsAppSend(approval.id); await repo.bindApprovalMessage(approval.id,'wamid.cost');
  const counters={paid:0,render:0,message:0,container:0,publish:0};
  const state={generation:'processing',render:'in-progress',instagram:'PROCESSING',unknownPaid:false,unknownContainer:false};
  const videoUrl='https://exports.faceless.so/renders/test/ready.mp4';
  t.mock.method(providerModule,'facelessClient',()=>({
    quote:async()=>({credits:20,balance:100}),
    create:async()=>{counters.paid++;if(state.unknownPaid)throw Error('lost');return{id:'video-1'};},
    videoStatus:async()=>({status:state.generation}),
    render:async()=>{counters.render++;return{renderId:'render-1'};},
    renderStatus:async()=>({status:state.render,...(state.render==='done'?{url:videoUrl}:{})}),
  }));
  t.mock.method(graphModule,'instagramGraph',async()=>({
    create:async()=>{counters.container++;if(state.unknownContainer)throw Error('lost');return'111';},
    status:async()=>state.instagram,
    publish:async()=>{counters.publish++;return'222';},
    permalink:async()=> 'https://www.instagram.com/reel/test/',
  }));
  t.mock.method(whatsapp,'whatsappApprovalReady',()=>true);
  t.mock.method(whatsapp,'sendWhatsAppText',async()=>{counters.message++;return'wamid.post';});
  const reply=(message,ref)=>repo.applyIncomingWhatsApp({id:message,from:'4912345678',body:'Freigeben',replyToMessageId:ref,payload:{}});
  const tick=()=>continuePendingReels(db);
  return{db,id,repo,publications,counters,state,reply,tick};
}

test('automatic continuation crosses both WhatsApp gates and persists one video and one Reel despite overlapping ticks',async t=>{
  const f=await fixture(t);
  await f.tick();assert.equal(f.counters.paid,0);
  await f.reply('approve-cost','wamid.cost');
  await Promise.all([f.tick(),f.tick()]);assert.equal(f.counters.paid,1);
  f.state.generation='completed';
  await Promise.all([f.tick(),f.tick()]);assert.equal(f.counters.render,1);
  f.state.render='done';
  await f.tick();await f.tick();assert.equal(f.counters.message,1);
  assert.equal(f.counters.container,0);assert.equal(f.counters.publish,0);
  await f.reply('approve-post','wamid.post');
  await Promise.all([f.tick(),f.tick()]);assert.equal(f.counters.container,1);
  f.state.instagram='FINISHED';
  await Promise.all([f.tick(),f.tick()]);await f.tick();
  assert.equal(f.counters.publish,1);
  const saved=await f.publications.get(f.id);
  assert.equal(saved.status,'published');assert.equal(saved.mediaId,'222');assert.equal(saved.permalink,'https://www.instagram.com/reel/test/');
});

test('automatic continuation leaves an unknown paid start locked',async t=>{
  const f=await fixture(t);f.state.unknownPaid=true;
  await f.reply('approve-cost','wamid.cost');await f.tick();await f.tick();
  assert.equal(f.counters.paid,1);assert.equal((await f.repo.getByJobId(f.id)).providerJobId,null);
  assert.equal(f.counters.message,0);
});

test('continuation cron rejects missing or wrong credentials before touching storage',async()=>{
  const old=process.env.CRON_SECRET;process.env.CRON_SECRET='test-cron-only';
  try{
    let calls=0;const route=loadRoute('app/api/cron/continue/route.ts',{'@/lib/automation/continue':{continuePendingReels:async()=>{calls++;return{advanced:0};}}});
    for(const token of ['', 'wrong'])assert.equal((await route.GET(new Request('https://local.test',{headers:{authorization:`Bearer ${token}`}}))).status,401);
    assert.equal(calls,0);
    assert.equal((await route.GET(new Request('https://local.test',{headers:{authorization:'Bearer test-cron-only'}}))).status,200);
    assert.equal(calls,1);
  }finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}
});

test('automatic continuation never recreates an Instagram container after an unknown response',async t=>{
  const f=await fixture(t);await f.reply('approve-cost','wamid.cost');await f.tick();
  f.state.generation='completed';await f.tick();f.state.render='done';await f.tick();
  await f.reply('approve-post','wamid.post');f.state.unknownContainer=true;
  await f.tick();await f.tick();
  assert.equal(f.counters.container,1);assert.equal(f.counters.publish,0);
  assert.equal((await f.publications.get(f.id)).status,'unknown');
});
