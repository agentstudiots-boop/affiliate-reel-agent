const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHmac}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {chooseVideoProvider,FACELESS_LEARNING_TARGET}=require('../.test-build/lib/production/policy');
const {classifyWhatsAppReply}=require('../.test-build/lib/whatsapp/intent');
const {extractIncomingWhatsAppMessages,verifyMetaWebhookSignature,verifyWhatsAppChallenge}=require('../.test-build/lib/whatsapp/security');
const {productionRepository}=require('../.test-build/lib/production/repository');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');

const opportunity=opportunitySchema.parse({
  product:{name:'Vakuumierer',sourceUrl:'https://www.amazon.de/s?k=Vakuumierer',affiliateUrl:'',price:'',targetGroup:'Familien',benefits:'Vorräte vorbereiten',notes:''},
  useCase:'Oma staunt beim Familienessen über das Steak.',
  category:'kitchen',
  useCaseKey:'sous-vide',
  targetPlatform:'facebook'
});

test('first 15 successful videos are forced to Faceless Storyboard',()=>{
  for(let count=0;count<FACELESS_LEARNING_TARGET;count++){
    const decision=chooseVideoProvider(count,'runway');
    assert.equal(decision.provider,'faceless_video');
    assert.equal(decision.mode,'FACELESS_STORYBOARD');
    assert.equal(decision.forced,true);
  }
  const after=chooseVideoProvider(FACELESS_LEARNING_TARGET,'runway');
  assert.equal(after.provider,'runway');
  assert.equal(after.mode,'RUNWAY_SINGLE_CLIP');
  assert.equal(after.forced,false);
  assert.throws(()=>chooseVideoProvider(-1),/Ungültige/);
});

test('WhatsApp replies require explicit approval wording; free text becomes revision feedback',()=>{
  assert.deepEqual(classifyWhatsAppReply('Freigeben'),{intent:'approve',feedback:''});
  assert.deepEqual(classifyWhatsAppReply('OK, freigeben!'),{intent:'approve',feedback:''});
  assert.deepEqual(classifyWhatsAppReply('Ablehnen'),{intent:'reject',feedback:''});
  assert.deepEqual(classifyWhatsAppReply('Mach die erste Szene kürzer und den CTA ruhiger.'),{
    intent:'changes_requested',
    feedback:'Mach die erste Szene kürzer und den CTA ruhiger.'
  });
  assert.equal(classifyWhatsAppReply('ja').intent,'changes_requested','plain yes must not unlock spend');
});

test('WhatsApp webhook verification and signature fail closed',()=>{
  const oldVerify=process.env.WHATSAPP_VERIFY_TOKEN;
  const oldSecret=process.env.META_APP_SECRET;
  process.env.WHATSAPP_VERIFY_TOKEN='verify-me';
  process.env.META_APP_SECRET='app-secret';
  try{
    assert.equal(verifyWhatsAppChallenge('verify-me'),true);
    assert.equal(verifyWhatsAppChallenge('wrong'),false);
    const body='{"object":"whatsapp_business_account"}';
    const signature='sha256='+createHmac('sha256','app-secret').update(body).digest('hex');
    assert.equal(verifyMetaWebhookSignature(body,signature),true);
    assert.equal(verifyMetaWebhookSignature(body,'sha256=deadbeef'),false);
    assert.equal(verifyMetaWebhookSignature(body,null),false);
  }finally{
    if(oldVerify===undefined)delete process.env.WHATSAPP_VERIFY_TOKEN;else process.env.WHATSAPP_VERIFY_TOKEN=oldVerify;
    if(oldSecret===undefined)delete process.env.META_APP_SECRET;else process.env.META_APP_SECRET=oldSecret;
  }
});

test('WhatsApp webhook extracts only inbound text and reply context',()=>{
  const payload={object:'whatsapp_business_account',entry:[{changes:[{value:{messages:[
    {from:'491234',id:'wamid.1',timestamp:'1',type:'text',text:{body:'Freigeben'},context:{id:'wamid.out'}},
    {from:'491234',id:'wamid.2',timestamp:'2',type:'image',image:{id:'x'}}
  ]}}]}]};
  assert.deepEqual(extractIncomingWhatsAppMessages(payload),[
    {id:'wamid.1',from:'491234',body:'Freigeben',replyToMessageId:'wamid.out'}
  ]);
});

test('production repository is idempotent and cannot start spend before WhatsApp approval',async()=>{
  const pg=new PGlite();
  const db={
    query:(q,v)=>pg.query(q,v),
    exec:q=>pg.exec(q),
    transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))
  };
  try{
    await pg.exec(fs.readFileSync('db/migrations/001_memory.sql','utf8'));
    await pg.exec(fs.readFileSync('db/migrations/002_production_gates.sql','utf8'));
    const memory=memoryRepository(db);
    const id=crypto.randomUUID();
    await memory.claim(id,opportunity,'reference');
    const job=await runContentJob(opportunity,{id,onUpdate:memory.save,loadLearning:memory.learn});
    assert.equal(job.content.format,'video');
    await memory.approve(id);

    const production=productionRepository(db);
    const first=await production.prepareVideo(id);
    const second=await production.prepareVideo(id);
    assert.equal(first.run.id,second.run.id);
    assert.equal(first.run.provider,'faceless_video');
    assert.equal(first.run.providerMode,'FACELESS_STORYBOARD');
    assert.equal(first.run.status,'needs_provider_quote');
    assert.equal(await production.successfulVideoCount(),0);
    await assert.rejects(production.markRendering(first.run.id,'provider-job-1'),/WhatsApp-Freigabe/);
  }finally{await pg.close();}
});
