const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHmac}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {chooseVideoProvider,FACELESS_LEARNING_TARGET}=require('../.test-build/lib/production/policy');
const {classifyWhatsAppReply}=require('../.test-build/lib/whatsapp/intent');
const {extractIncomingWhatsAppMessages,verifyMetaWebhookSignature,verifyWhatsAppChallenge}=require('../.test-build/lib/whatsapp/security');
const {productionRepository}=require('../.test-build/lib/production/repository');
const {whatsappConfig,sendDailyNotificationTemplate}=require('../.test-build/lib/whatsapp/client');
const {facelessClient,narration}=require('../.test-build/lib/production/faceless-so');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {reviseApprovedVideo}=require('../.test-build/lib/content/orchestrator');
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

test('WhatsApp webhook extracts only inbound text to the configured phone number',()=>{
  const payload={object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123456123'},messages:[
    {from:'491234',id:'wamid.1',timestamp:'1',type:'text',text:{body:'Freigeben'},context:{id:'wamid.out'}},
    {from:'491234',id:'wamid.2',timestamp:'2',type:'image',image:{id:'x'}}
  ]}}]}]};
  assert.deepEqual(extractIncomingWhatsAppMessages(payload,'123456123'),[
    {id:'wamid.1',from:'491234',body:'Freigeben',replyToMessageId:'wamid.out'}
  ]);
  assert.deepEqual(extractIncomingWhatsAppMessages(payload,'999999999'),[],'a valid app signature for another number must not authorize a reply');
  assert.deepEqual(extractIncomingWhatsAppMessages(payload,''),[],'missing phone configuration must fail closed');
  delete payload.entry[0].changes[0].value.metadata;
  assert.deepEqual(extractIncomingWhatsAppMessages(payload,'123456123'),[],'webhook without recipient identity must fail closed');
});

test('existing misspelled Vercel WhatsApp secrets remain usable without exposing values',()=>{
  const keys=['WHATSAPP_ACCESS_TOKEN','WHATTSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATTSAPP_PHONE_NUMBER_ID','WHATSAPP_BUSINESS_ACCOUNT_ID','WHATTSAPP_BUSINESS_ACCOUNT_ID'];
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{
    for(const key of keys)delete process.env[key];
    process.env.WHATTSAPP_ACCESS_TOKEN='test-token';
    process.env.WHATTSAPP_PHONE_NUMBER_ID='test-phone';
    process.env.WHATTSAPP_BUSINESS_ACCOUNT_ID='test-account';
    assert.equal(whatsappConfig().accessToken,true);
    assert.equal(whatsappConfig().phoneNumberId,true);
    assert.equal(whatsappConfig().businessAccountId,true);
  }finally{for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
});

test('business-initiated daily template stays disabled without approved explicit configuration',async()=>{
  const keys=['WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_APPROVER_WA_ID','WHATSAPP_DAILY_TEMPLATE_ENABLED','WHATSAPP_DAILY_TEMPLATE_NAME','WHATSAPP_DAILY_TEMPLATE_LANGUAGE'];
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]])),previousFetch=global.fetch;
  const calls=[];
  try{
    process.env.WHATSAPP_ACCESS_TOKEN='test-token';process.env.WHATSAPP_PHONE_NUMBER_ID='123456';process.env.WHATSAPP_APPROVER_WA_ID='491234';
    process.env.WHATSAPP_DAILY_TEMPLATE_NAME='daily_draft_notice';process.env.WHATSAPP_DAILY_TEMPLATE_LANGUAGE='de';
    delete process.env.WHATSAPP_DAILY_TEMPLATE_ENABLED;
    global.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({messages:[{id:'wamid.notice'}]})};};
    await assert.rejects(sendDailyNotificationTemplate(),/Kostenfreigabe/);
    assert.equal(calls.length,0);
    process.env.WHATSAPP_DAILY_TEMPLATE_ENABLED='true';
    assert.equal(await sendDailyNotificationTemplate(),'wamid.notice');
    assert.deepEqual(calls[0].template,{name:'daily_draft_notice',language:{code:'de'}});
    assert.equal(calls[0].to,'491234');assert.equal(calls[0].type,'template');
  }finally{global.fetch=previousFetch;for(const key of keys){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
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
    await pg.exec(fs.readFileSync('db/migrations/003_faceless_so.sql','utf8'));
    await pg.exec(fs.readFileSync('db/migrations/004_daily_drafts.sql','utf8'));
    await pg.exec(fs.readFileSync('db/migrations/005_publication_gate.sql','utf8'));
    await pg.exec(fs.readFileSync('db/migrations/006_daily_notification.sql','utf8'));
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
    await assert.rejects(production.claimPaidCreation(id,20),/WhatsApp-Freigabe/);

    const script=narration({...job,status:'approved'});
    const approval=await production.createRenderApproval({jobId:id,estimatedCostCents:null,estimatedProviderCredits:20,estimatedCommissionCents:null,summary:'Vakuumierer, 20 Credits',approverWaId:'491234',script,voiceId:'de-voice'});
    await production.claimWhatsAppSend(approval.id);
    await assert.rejects(production.claimWhatsAppSend(approval.id),/bereits versucht/);
    await production.bindApprovalMessage(approval.id,'wamid.out');
    const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
    try{
      const incoming={id:'wamid.in',from:'491234',body:'Freigeben',replyToMessageId:'wamid.out',payload:{}};
      assert.equal((await production.applyIncomingWhatsApp({...incoming,from:'491235'})).reason,'untrusted_sender');
      assert.equal((await production.applyIncomingWhatsApp(incoming)).intent,'approve');
      assert.equal((await production.applyIncomingWhatsApp(incoming)).reason,'duplicate');
      const claimed=await production.claimPaidCreation(id,20);
      assert.equal(claimed.script,script);
      await assert.rejects(production.claimPaidCreation(id,20),/WhatsApp-Freigabe/);
      await production.bindProviderJob(first.run.id,'provider-job-1');
      const render=await production.claimFreeRender(first.run.id);
      assert.ok(render.key);
      await assert.rejects(production.claimFreeRender(first.run.id),/bereits versucht/);
      await production.bindRender(first.run.id,'render-job-1');
      await production.markReady(first.run.id,'https://exports.faceless.so/video.mp4');
      assert.equal(await production.successfulVideoCount(),1);
    }finally{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;}
  }finally{await pg.close();}
});

test('Faceless.so reads catalog without writing, and paid creation uses one idempotency key',async()=>{
  const old=process.env.FACELESS_API_KEY;process.env.FACELESS_API_KEY='test-only';
  const calls=[];
  const mock=async(url,options)=>{
    calls.push({url,method:options.method,key:options.headers['Idempotency-Key']});
    const path=new URL(url).pathname;
    const data=path.endsWith('/me')?{team:{credits:40},auth:{scopes:['videos:read','videos:write','catalog:read']}}
      :path.endsWith('/options')?{kind:'models',items:[{value:'storyboard',credits:20}]}
      :path.endsWith('/voices')?[{id:'de-voice',name:'Deutsch',targetLanguages:['de']}]
      :{id:'video-1',model:'storyboard',creditsUsed:20};
    return {ok:true,json:async()=>({success:true,data})};
  };
  try{
    const client=facelessClient(mock);
    assert.deepEqual(await client.quote(),{credits:20,balance:40,voices:[{id:'de-voice',name:'Deutsch'}]});
    assert.ok(calls.every(c=>c.method==='GET' && c.url.startsWith('https://faceless.so/api/v1/')));
    await client.create('Testtext','de-voice','Test','uuid-key');
    assert.equal(calls.filter(c=>c.method==='POST').length,1);
    assert.equal(calls.at(-1).key,'uuid-key');
  }finally{if(old===undefined)delete process.env.FACELESS_API_KEY;else process.env.FACELESS_API_KEY=old;}
});

test('WhatsApp change request is revised by orchestrator and needs fresh editorial approval',async()=>{
  const pg=new PGlite();
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  try{
    for(const file of ['001_memory.sql','002_production_gates.sql','003_faceless_so.sql','004_daily_drafts.sql','005_publication_gate.sql','006_daily_notification.sql'])await pg.exec(fs.readFileSync(`db/migrations/${file}`,'utf8'));
    const memory=memoryRepository(db),production=productionRepository(db),id=crypto.randomUUID();
    await memory.claim(id,opportunity,'reference');
    await runContentJob(opportunity,{id,onUpdate:memory.save,loadLearning:memory.learn});
    const approved=await memory.approve(id);
    await production.prepareVideo(id);
    const approval=await production.createRenderApproval({jobId:id,estimatedCostCents:null,estimatedProviderCredits:20,estimatedCommissionCents:null,summary:'Test',approverWaId:'491234',script:narration(approved),voiceId:'de-voice'});
    await production.claimWhatsAppSend(approval.id);await production.bindApprovalMessage(approval.id,'wamid.out');
    const change=await production.applyIncomingWhatsApp({id:'wamid.change',from:'491234',body:'Mach die erste Szene kürzer. CTA weniger werblich. Nimm Szene 3 raus.',replyToMessageId:'wamid.out',payload:{}});
    assert.equal(change.intent,'changes_requested');
    const revised=await production.reviseRequestedVideo(id);
    assert.equal(revised.status,'awaiting_approval');
    assert.equal(revised.revisions,1);
    assert.equal(revised.content.scenes.length,approved.content.scenes.length-1);
    assert.equal(revised.content.scenes[0].durationSeconds,approved.content.scenes[0].durationSeconds-2);
    assert.notEqual(narration({...revised,status:'approved'}),narration(approved));
    assert.equal((await production.getByJobId(id)).status,'needs_provider_quote');
    await assert.rejects(production.claimPaidCreation(id,20),/WhatsApp-Freigabe/);
    await memory.approve(id);
    await assert.rejects(production.reviseRequestedVideo(id),/Kein offener/);
    const raw=await pg.query('SELECT count(*) AS n FROM job_events WHERE job_id=$1',[id]);
    assert.equal(Number(raw.rows[0].n),revised.events.length+1);
    await assert.rejects(reviseApprovedVideo({...revised,status:'approved',revisions:2},'Mach die erste Szene kürzer.'),/Maximal zwei/);
  }finally{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;await pg.close();}
});
