const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const loadRoute=require('./helpers/load-route.cjs');
const {approveContent}=require('./helpers/approve-content.cjs');
const {pngFixture}=require('./helpers/png-fixture.cjs');
const {createReplicateImageProvider,DEFAULT_REPLICATE_IMAGE_MODEL}=require('../.test-build/lib/content/providers/replicate-image');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {publicationRepository,PublicationConflictError}=require('../.test-build/lib/meta/publication-gate');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');
const S=require('../.test-build/lib/content/strategy');

const dbAdapter=pg=>({query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))});
async function world(t){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db=dbAdapter(pg),memory=memoryRepository(db),repo=publicationRepository(db);
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.1','491234','changes_requested','{}')");
  const input=opportunitySchema.parse({product:{productVerifiedAt:'2026-09-26T08:00:00.000Z',productVerifiedName:'Kuscheldecke',name:'Kuscheldecke',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'https://www.amazon.de/dp/B000000001',price:'',targetGroup:'Haushalte',benefits:'Material und Größe vergleichen',notes:''},useCase:'Ruhiger Abend mit einer Decke auf dem Sofa.',targetPlatform:'facebook',budget:'low',verifiedFacts:[]});
  const id=crypto.randomUUID();await memory.claim(id,input,'reference');await runContentJob(input,{id,onUpdate:memory.save,loadLearning:memory.learn});
  const approved=await approveContent(db,memory,id);
  return {pg,db,repo,jobId:approved.id};
}

test('after the content approval, a provider refusal before any image existed releases the one-attempt gate; the operator is told and "Weiter" restarts the step',async t=>{
  const w=await world(t);const sent=[];
  const state={mode:'refuse'};let posts=0;
  const request=async(url,init)=>{
    if(String(url).includes('/predictions')&&init?.method==='POST'){posts++;if(state.mode==='refuse')return new Response('{"detail":"Request was throttled"}',{status:429});
      return Response.json({id:'abcdefghijklmnop',status:'succeeded',output:'https://replicate.delivery/example.png',metrics:{predict_time:3}});}
    return new Response(pngFixture(),{status:200,headers:{'content-type':'image/png'}});
  };
  const provider=createReplicateImageProvider('test-key',DEFAULT_REPLICATE_IMAGE_MODEL,{request,upload:async path=>({url:`https://s.public.blob.vercel-storage.com/${path}`})});
  const wa={sendWhatsAppText:async b=>{sent.push(b);return `wamid.${sent.length}`;},whatsappApprovalReady:()=>true,WhatsAppRejectedError:class extends Error{}};
  t.mock.method(console,'error',()=>{});
  const request_=loadRoute('lib/meta/request-publication.ts',{
    '../memory/db':{getDatabase:()=>w.db},'../content/history':require('../.test-build/lib/content/history'),
    '../content/image-provider':{getOriginalVisualProvider:()=>provider,imageProviderStatus:()=>({model:DEFAULT_REPLICATE_IMAGE_MODEL,reason:''})},
    './publication-eligibility':require('../.test-build/lib/meta/publication-eligibility'),
    './publication-gate':{publicationRepository:()=>w.repo,PublicationConflictError},'../whatsapp/client':wa});
  await assert.rejects(request_.requestFacebookApproval(w.jobId),e=>e instanceof PublicationConflictError&&/Replicate hat die Bildanfrage abgelehnt.*nichts berechnet.*„Weiter“/s.test(e.message));
  assert.equal(posts,1);
  assert.equal((await w.pg.query('SELECT count(*)::int AS n FROM original_visual_attempts')).rows[0].n,0,'the gate is free again: nothing was generated or charged');
  assert.equal((await w.pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
  // The webhook branch tells the operator instead of swallowing the error.
  const resume=loadRoute('lib/meta/resume-publication.ts',{'./request-publication':request_,'../whatsapp/client':wa,'../memory/db':{}});
  assert.match(resume.publicationPreparationFailureText(new PublicationConflictError('Replicate hat die Bildanfrage abgelehnt (Rate Limit).')),/Inhalt ist freigegeben.*Rate Limit.*nichts veröffentlicht/s);
  // Provider recovers; "Weiter" resumes the approved draft exactly once.
  await w.pg.query("UPDATE daily_drafts SET status='content_approved',updated_at=now() WHERE job_id=$1",[w.jobId]).catch(()=>{});
  await w.pg.query("INSERT INTO daily_drafts(day,slot,job_id,status) VALUES(current_date,'manual:t',$1,'content_approved') ON CONFLICT DO NOTHING",[w.jobId]);
  state.mode='ok';
  assert.equal(await resume.resumeApprovedDailyPublications(w.db),1);
  assert.equal(posts,2);
  const publication=(await w.pg.query("SELECT status,image_url FROM publication_requests WHERE job_id=$1",[w.jobId])).rows[0];
  assert.equal(publication.status,'pending');assert.match(publication.image_url,/blob\.vercel-storage\.com/);
  assert.ok(sent.some(m=>/Veröffentlichungsfreigabe für Facebook und Instagram/.test(m)),'the publication approval reaches WhatsApp');
  assert.equal(await resume.resumeApprovedDailyPublications(w.db),0,'no second image for the same draft');
  assert.equal(posts,2);
});

test('an ambiguous image result (timeout/5xx after the request) keeps the gate closed: no second paid attempt',async t=>{
  const w=await world(t);t.mock.method(console,'error',()=>{});
  const provider=createReplicateImageProvider('test-key',DEFAULT_REPLICATE_IMAGE_MODEL,{request:async()=>new Response('boom',{status:502}),upload:async()=>({url:'x'})});
  const wa={sendWhatsAppText:async()=>'w',whatsappApprovalReady:()=>true,WhatsAppRejectedError:class extends Error{}};
  const request_=loadRoute('lib/meta/request-publication.ts',{'../memory/db':{getDatabase:()=>w.db},'../content/history':require('../.test-build/lib/content/history'),
    '../content/image-provider':{getOriginalVisualProvider:()=>provider,imageProviderStatus:()=>({model:DEFAULT_REPLICATE_IMAGE_MODEL,reason:''})},
    './publication-eligibility':require('../.test-build/lib/meta/publication-eligibility'),'./publication-gate':{publicationRepository:()=>w.repo,PublicationConflictError},'../whatsapp/client':wa});
  await assert.rejects(request_.requestFacebookApproval(w.jobId),/Kein automatischer zweiter Versuch/);
  assert.equal((await w.pg.query('SELECT count(*)::int AS n FROM original_visual_attempts')).rows[0].n,1);
  await assert.rejects(request_.requestFacebookApproval(w.jobId),/bereits begonnen/);
});

test('the optional model second opinion of the Jarvis gate can never end the slot: provider failure or off-schema answer → deterministic verdict stands',async()=>{
  const product={name:'Pizzaschere',productVerifiedName:'Pizzaschere',productVerifiedAt:'2026-10-03T07:00:00.000Z',sourceUrl:'https://www.amazon.de/dp/B000000051',asin:'B000000051',affiliateUrl:'https://www.amazon.de/dp/B000000051?tag=alltaeglichle-21',price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''};
  const chance={type:'fun_impulse',hook:'Pizza mit der Schere statt dem Rollrädchen schneiden – Hingucker am Tisch',concept:'pizza-scissors',demonstrable:true,beforeAfter:false,wow:false,fun:true,impulse:true,gift:false,aesthetic:false,broadAppeal:true,seasonalFit:false};
  const opp={product,category:'household',useCaseKey:'seasonal-product-guide',targetPlatform:'facebook',useCase:'Das Produkt im Alltag verwenden und die Eignung vor dem Kauf prüfen.',trend:'',goal:'education',budget:'low',verifiedFacts:[],contentChance:{chance,assessment:S.assessContentChance('Pizzaschere',chance,S.emptyHistory())}};
  for(const failure of [()=>{throw new Error('Der KI-Entwurf konnte nicht sicher geprüft werden.');},()=>({decision:'maybe'})]){
    // Every agent except the gate's second opinion answers from its deterministic reference, like a healthy provider would.
    const generate=async(agent,instruction,input,schema,reference)=>agent==='orchestrator'&&/strategische Qualitätsstufe/.test(instruction)?schema.parse(failure()):schema.parse(reference());
    const job=await runContentJob(opp,{mode:'ai',generate,allowedFormats:['image']});
    assert.notEqual(job.error,S.STRATEGY_REJECTED);
    assert.ok(job.events.some(e=>/Strategic Quality Gate: geeignet/.test(e.message)),'baseline verdict was applied');
  }
});
