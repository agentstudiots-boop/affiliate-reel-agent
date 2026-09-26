const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {applyMigrations}=require('../.test-build/lib/memory/migrations');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {productionRepository,validLicensedRunwayImage}=require('../.test-build/lib/production/repository');
const {runwayStoryClient,runwayPrompt,runwaySceneBrief}=require('../.test-build/lib/production/runway-story');
const {contentFingerprint}=require('../.test-build/lib/whatsapp/content-approval');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');

test('Amazon image links cannot be supplied to Runway and live balance is read without spending',async()=>{
  assert.equal(validLicensedRunwayImage('https://m.media-amazon.com/images/I/product.jpg'),false);
  assert.equal(validLicensedRunwayImage('https://images-na.ssl-images-amazon.com/images/I/product.jpg'),false);
  assert.equal(validLicensedRunwayImage('http://example.org/product.jpg'),false);
  assert.equal(validLicensedRunwayImage('https://example.org/product.jpg'),true);
  const calls=[];
  const provider=runwayStoryClient({organization:{retrieve:async()=>{calls.push('balance');return {creditBalance:450};}},imageToVideo:{create:async input=>{calls.push(input);return {id:'runway-image'};}},textToVideo:{create:async input=>{calls.push(input);return {id:'runway-text'};}}});
  assert.deepEqual(await provider.quote(),{credits:300,balance:450,durationSeconds:30,model:'wan3',estimatedUsd:3});
  assert.deepEqual(calls,['balance']);
});

test('Runway 30-second story requires fresh content and cost approvals and claims exactly one paid start',async t=>{
  const pg=new PGlite(); t.after(()=>pg.close());
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  await applyMigrations(db);
  const opportunity=opportunitySchema.parse({product:{productVerifiedAt:'2026-09-26T08:00:00.000Z',productVerifiedName:'Vakuumierer',name:'Vakuumierer',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'',price:'',targetGroup:'Familien',benefits:'Vorräte vorbereiten',notes:''},useCase:'Oma staunt beim Familienessen über das Steak.',category:'kitchen',useCaseKey:'sous-vide',targetPlatform:'instagram'});
  const memory=memoryRepository(db),repo=productionRepository(db),id=crypto.randomUUID();
  await memory.claim(id,opportunity,'reference');
  await runContentJob(opportunity,{id,onUpdate:memory.save,loadLearning:memory.learn});
  const job=await memory.approve(id);
  assert.equal(job.content.format,'video');
  const n=job.content.scenes.length;
  job.content.durationSeconds=30;
  job.content.scenes.forEach((scene,i)=>{scene.durationSeconds=Math.floor(30/n)+(i<30%n?1:0);});
  await db.query("UPDATE content_jobs SET snapshot=$2 WHERE id=$1",[id,JSON.stringify(job)]);
  await db.query("INSERT INTO content_approval_requests(id,job_id,content_hash,status,approver_wa_id,whatsapp_message_id,decided_at) VALUES($1,$2,$3,'approved','491234','wamid.editorial',now())",[crypto.randomUUID(),id,contentFingerprint(job)]);
  const prepared=await repo.prepareVideo(id,'runway');
  assert.equal(prepared.run.providerMode,'RUNWAY_SINGLE_CLIP');
  const script=job.content.scenes.map(scene=>scene.audio.trim()).join('\n\n');
  const input={jobId:id,credits:300,balance:450,imageUrl:'',rightsConfirmed:false,approverWaId:'491234',summary:'30 Sekunden, 300 Credits, Guthaben 450, Text-zu-Video',script};
  await assert.rejects(repo.createRunwayApproval({...input,imageUrl:'https://m.media-amazon.com/product.jpg'}),/Amazon-Bilder/);
  await assert.rejects(repo.createRunwayApproval({...input,balance:250}),/Guthaben/);
  const approval=await repo.createRunwayApproval(input);
  await repo.claimWhatsAppSend(approval.id);
  await repo.bindApprovalMessage(approval.id,'wamid.runway');
  await assert.rejects(repo.claimRunwayCreation(id,300),/WhatsApp/);
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  try { await repo.applyIncomingWhatsApp({id:'wamid.runway.approved',from:'491234',body:'Freigeben',replyToMessageId:'wamid.runway',payload:{}}); }
  finally { if(old===undefined) delete process.env.WHATSAPP_APPROVER_WA_ID; else process.env.WHATSAPP_APPROVER_WA_ID=old; }
  const claimed=await repo.claimRunwayCreation(id,300);
  assert.equal(claimed.imageUrl,'');
  assert.match(runwayPrompt(claimed.job),/Vakuumierer/);
  assert.match(runwayPrompt(claimed.job),/optionales Referenzbild zeigt nur die Atmosphäre/);
  const calls=[];
  const provider=runwayStoryClient({textToVideo:{create:async args=>{calls.push(args);return {id:'text-video'};}},imageToVideo:{create:async args=>{calls.push(args);return {id:'image-video'};}}});
  assert.equal((await provider.create(claimed.job,'')).id,'text-video');
  assert.equal(calls[0].duration,30);
  assert.equal(calls[0].promptImage,undefined);
  assert.equal((await provider.create(claimed.job,'https://example.org/licensed.png')).id,'image-video');
  assert.equal(calls[1].promptImage[0].uri,'https://example.org/licensed.png');
  assert.match(runwaySceneBrief(claimed.job),/eigenständige|Eigenständige/);
  await assert.rejects(repo.claimRunwayCreation(id,300),/WhatsApp/);
});

test('Halloween scene brief keeps the pumpkin and family action central without copying product photos',()=>{
  const job={status:'approved',opportunity:{product:{name:'Halloween Kürbis Schnitzset'},trend:'Herbst und Halloween',useCase:'Familie gestaltet eine Halloweenlaterne'},content:{format:'video',durationSeconds:30,hook:'Die Laterne leuchtet gleich',scenes:[{visual:'Ein Kind zeichnet ein Gesicht auf einen echten Kürbis',durationSeconds:5,audio:'Heute wird geschnitzt'}],productIntegration:'Erwachsene schnitzen; Kinder zeichnen'}};
  const brief=runwaySceneBrief(job);
  assert.match(brief,/Kürbis als Hauptmotiv/);
  assert.match(brief,/erwachsene Person führt scharfe Werkzeuge/);
  assert.match(brief,/Kein Amazon- oder Händlerfoto kopieren/);
  assert.match(runwayPrompt(job),/Trendkontext: Herbst und Halloween/);
});
