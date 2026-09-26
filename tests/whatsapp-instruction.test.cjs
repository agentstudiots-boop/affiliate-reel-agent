const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {interpretInstruction,validateInstruction,clarification,INSTRUCTION_MODEL}=require('../.test-build/lib/whatsapp/instruction');
const {processOperatorInstruction}=require('../.test-build/lib/whatsapp/process-instruction');
const {runContentJob,reviseOperatorInstruction}=require('../.test-build/lib/content/orchestrator');
const {visualContextError,visualFingerprint}=require('../.test-build/lib/content/visual-context');
const {buildOriginalVisualPrompt}=require('../.test-build/lib/content/providers/openai-image');
const {opportunitySchema}=require('../.test-build/lib/content/schema');
const {applyMigrations}=require('../.test-build/lib/memory/migrations');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {publicationRepository}=require('../.test-build/lib/meta/publication-gate');
const {productionRepository}=require('../.test-build/lib/production/repository');
const scene='Geschnitzte Halloween-Kürbisse mit Schnitzwerkzeugen des Kürbisschnitzsets und Halloween-Dekoration.';
const opportunity=()=>opportunitySchema.parse({product:{name:'YAVOCOS Kürbis Schnitzset',productVerifiedName:'YAVOCOS Kürbis Schnitzset',productVerifiedAt:'2026-09-26T08:00:00Z',sourceUrl:'https://www.amazon.de/dp/B0D9YQR9CT',affiliateUrl:'https://www.amazon.de/dp/B0D9YQR9CT?tag=alltaeglichle-21',price:'',targetGroup:'Halloween-Bastler',benefits:'Herstellerangaben prüfen',notes:''},useCase:scene,targetPlatform:'facebook',budget:'low'});
const instruction=(intent,extra={})=>({...clarification(),intent,confidence:.98,product_context_matches:true,
  image_instruction:['revise_image','revise_both'].includes(intent)?scene:null,
  text_instruction:['revise_text','revise_both'].includes(intent)?'Text natürlicher':null,
  text_operations:['revise_text','revise_both'].includes(intent)?['naturalize']:[],...extra});
const message=(id,body='Mach ein neues Bild mit Halloween-Kürbissen',reply='wamid.current')=>({id,body,replyToMessageId:reply,from:'491234',payload:{}});

async function fixture(t,{asset=false}={}){
  const pg=new PGlite();t.after(()=>pg.close());
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  await applyMigrations(db);
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  const id=crypto.randomUUID(),memory=memoryRepository(db),publication=publicationRepository(db),p=opportunity();
  await memory.claim(id,p,'reference');await runContentJob(p,{id,allowedFormats:['image'],onUpdate:memory.save});
  let job=(await db.query('SELECT snapshot FROM content_jobs WHERE id=$1',[id])).rows[0].snapshot;
  let oldPublication;
  if(asset){
    job=await memory.approve(id);await publication.claimVisual(id,'mock-model','replicate');
    const sha='a'.repeat(64),url=`https://test.public.blob.vercel-storage.com/generated/facebook/${id}/${sha}.png`;
    oldPublication=await publication.prepareWithVisual(id,'491234',{provider:'replicate',model:'mock-model',mediaType:'image',url,sha256:sha});
    await publication.bindMessage(oldPublication.id,'wamid.current');
  }
  await db.query("INSERT INTO daily_drafts(day,job_id,status,whatsapp_message_id) VALUES('2026-09-26',$1,$2,$3)",[id,asset?'content_approved':'awaiting_approval',asset?'wamid.old-content':'wamid.current']);
  const sends=[],approvals=[];
  const handle=(input,parse)=>processOperatorInstruction(input,{database:db,interpret:parse,send:async text=>{sends.push(text);return 'wamid.notice';},sendApproval:async jobId=>{approvals.push(jobId);return true;}});
  const snapshot=async()=>(await db.query('SELECT snapshot FROM content_jobs WHERE id=$1',[id])).rows[0].snapshot;
  return{pg,db,id,job,memory,publication,oldPublication,process:handle,sends,approvals,snapshot};
}

for(const [body,intent] of [
  ['Mach ein neues Bild mit Halloween-Kürbissen','revise_image'],
  ['Der Text ist zu werblich','revise_text'],
  ['Hook kürzer und neues Bild','revise_both'],
  ['Mach es anders','clarify'],
])test(`structured parser transport: ${body} → ${intent}`,async t=>{
  const job=await runContentJob(opportunity(),{allowedFormats:['image']});
  const old=process.env.AI_GATEWAY_API_KEY;process.env.AI_GATEWAY_API_KEY='test-only';
  t.after(()=>{if(old===undefined)delete process.env.AI_GATEWAY_API_KEY;else process.env.AI_GATEWAY_API_KEY=old;});
  let calls=0;
  const result=await interpretInstruction(body,job,async(url,init)=>{
    calls++;assert.equal(url,'https://ai-gateway.vercel.sh/v1/chat/completions');
    const request=JSON.parse(init.body);assert.equal(request.model,INSTRUCTION_MODEL);assert.equal(request.tools,undefined);
    assert.equal(request.response_format.json_schema.strict,true);assert.equal(request.response_format.json_schema.schema.additionalProperties,false);
    const input=JSON.parse(request.messages[1].content);assert.equal(input.operator_message,body);assert.equal(input.context.content_id,job.id);
    assert.equal(input.context.product.asin,'B0D9YQR9CT');assert.equal(input.context.product.name,job.opportunity.product.name);
    assert.deepEqual(input.context.current_content,job.content);assert.ok(input.context.current_creative);assert.equal(input.context.status,job.status);
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(intent==='clarify'?clarification():instruction(intent))}}]});
  });
  assert.equal(calls,1);assert.equal(result.intent,intent);assert.equal(result.publish_requested,false);
  assert.equal(result.requires_new_generation,['revise_image','revise_both'].includes(intent));
});

for(const [body,intent] of [['Freigeben','approve'],['Ablehnen','reject']])test(`${body} uses exact existing gate command without inference`,async()=>{
  const job=await runContentJob(opportunity());let calls=0;
  const result=await interpretInstruction(body,job,async()=>{calls++;throw Error('must not call');});
  assert.equal(result.intent,intent);assert.equal(result.requires_new_generation,false);assert.equal(calls,0);
});

test('invalid, uncertain, product-changing or publishing model output cannot authorize an action',()=>{
  for(const output of [instruction('approve'),instruction('revise_image',{confidence:.4}),instruction('revise_image',{keep_product:false}),instruction('revise_image',{keep_content_id:false}),instruction('revise_image',{publish_requested:true}),instruction('revise_image',{product_context_matches:false}),instruction('revise_image',{affiliate_url:'https://evil.test'}),instruction('revise_image',{product_instruction:'another product'})]){
    const result=validateInstruction(output,'Mach ein Bild');assert.equal(result.intent,'clarify');assert.equal(result.requires_new_generation,false);
  }
  assert.equal(validateInstruction(instruction('revise_text',{requires_new_generation:true}),'Text natürlicher').requires_new_generation,false);
});

test('invalid model response and HTTP failure get one attempt and clarify',async t=>{
  const old=process.env.AI_GATEWAY_API_KEY;process.env.AI_GATEWAY_API_KEY='test-only';
  t.after(()=>{if(old===undefined)delete process.env.AI_GATEWAY_API_KEY;else process.env.AI_GATEWAY_API_KEY=old;});
  const job=await runContentJob(opportunity());
  for(const response of [new Response('{}',{status:429}),Response.json({choices:[{finish_reason:'length',message:{content:'{}'}}]}),Response.json({choices:[{finish_reason:'stop',message:{content:'not json'}}]})]){
    let calls=0;const result=await interpretInstruction('Mach ein Bild',job,async()=>{calls++;return response;});
    assert.equal(result.intent,'clarify');assert.equal(calls,1);
  }
});

test('revision retains content identity, product, ASIN and affiliate; all stale image fields are replaced',async()=>{
  const job=await runContentJob(opportunity(),{allowedFormats:['image']});
  job.opportunity.useCase='Pasta in einer Pfanne';job.content.useCase='Pasta';job.content.visualConcept.mainIdea='Pasta';job.content.visualConcept.everydaySituation='Pfanne';
  job.content.slides.forEach(slide=>Object.assign(slide,{visual:'Pasta',prompt:'Pfanne',alt:'Nudeln'}));
  const next=reviseOperatorInstruction(job,instruction('revise_image'));
  assert.equal(next.id,job.id);assert.deepEqual(next.opportunity.product,job.opportunity.product);assert.equal(next.status,'awaiting_approval');assert.equal(next.revisions,job.revisions+1);
  assert.doesNotMatch(JSON.stringify(next.content),/Pasta|Pfanne|Nudeln/);assert.equal(visualContextError(next),null);
  const prompt=buildOriginalVisualPrompt(next);assert.match(prompt,/Halloween-Kürbisse/);assert.match(prompt,/B0D9YQR9CT/);assert.doesNotMatch(prompt,/Pasta|Pfanne|Nudeln/);
  assert.match(job.content.slides[0].prompt,/Pfanne/,'source snapshot stays immutable');
});

test('wrong pumpkin image briefing blocks both revision and paid prompt before provider execution',async()=>{
  const job=await runContentJob(opportunity(),{allowedFormats:['image']});
  assert.throws(()=>reviseOperatorInstruction(job,instruction('revise_image',{image_instruction:'Pasta in einer Pfanne'})),/visual_context_mismatch/);
  job.content.slides[0].prompt='Originelles redaktionelles Social-Media-Visual im Hochformat mit Pasta in einer Pfanne, natürlichem Licht und einer konkreten Kochsituation.';
  assert.equal(visualContextError(job),'visual_context_mismatch');assert.throws(()=>buildOriginalVisualPrompt(job),/visual_context_mismatch/);
});

test('same WhatsApp message is claimed before LLM call: concurrent duplicate has one parse, revision and notice, no media',async t=>{
  const f=await fixture(t);let calls=0;let release;const paused=new Promise(resolve=>{release=resolve;});let entered;const started=new Promise(resolve=>{entered=resolve;});
  const first=f.process(message('one'),async()=>{calls++;entered();await paused;return instruction('revise_image');});
  await started;await f.process(message('one'),async()=>{calls++;return instruction('revise_image');});
  const approval=await productionRepository(f.db).applyIncomingWhatsApp(message('old-approve','Freigeben'));
  assert.equal(approval.handled,false,'old approval is locked while interpretation is running');
  release();await first;
  const next=await f.snapshot();assert.equal(calls,1);assert.equal(next.id,f.job.id);assert.deepEqual(next.opportunity.product,f.job.opportunity.product);assert.equal(next.revisions,1);assert.equal(next.status,'awaiting_approval');assert.deepEqual(f.approvals,[f.id]);
  for(const table of ['original_visual_attempts','publication_requests','production_runs'])assert.equal((await f.db.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
  assert.equal((await f.db.query('SELECT status FROM whatsapp_instructions')).rows[0].status,'applied');
});

test('ambiguous instruction asks a question once and leaves the creative unchanged',async t=>{
  const f=await fixture(t);await f.process(message('unclear','Mach es anders'),async()=>clarification());
  assert.deepEqual(await f.snapshot(),f.job);assert.equal(f.sends.length,1);assert.match(f.sends[0],/Meinst du/);assert.equal(f.approvals.length,0);
  await f.process(message('unclear','Mach es anders'),async()=>{throw Error('must not reparse');});assert.equal(f.sends.length,1);
});

test('explicit product change locks the job for a new Product Gate without replacing its product',async t=>{
  const f=await fixture(t);await f.process(message('product','Nimm ein anderes Produkt'),async()=>instruction('change_product',{product_instruction:'anderes Produkt',keep_product:false}));
  const next=await f.snapshot();assert.equal(next.id,f.id);assert.deepEqual(next.opportunity.product,f.job.opportunity.product);assert.equal(next.status,'needs_input');assert.equal(next.error,'product_change_required');assert.equal(f.approvals.length,0);
});

test('text-only revision reuses exactly the verified original asset after renewed approval, without another generation',async t=>{
  const f=await fixture(t,{asset:true});await f.process(message('text','Der Text ist zu werblich'),async()=>instruction('revise_text'));
  const next=await f.snapshot();assert.notEqual(next.content.caption,f.job.content.caption);assert.equal(visualFingerprint(next),visualFingerprint(f.job));assert.equal((await f.publication.get(f.id)).status,'changes_requested');
  await assert.rejects(f.publication.claimVisual(f.id,'mock-model','replicate'),/freigegeben|genehmigt|Freigabe/i);
  await f.memory.approve(f.id);
  const reused=await f.publication.claimVisual(f.id,'mock-model','replicate');assert.ok(reused.existing);assert.equal(reused.existing.status,'pending');assert.equal(reused.existing.imageUrl,f.oldPublication.imageUrl);assert.equal(reused.existing.revision,2);
  assert.equal(reused.existing.whatsappMessageId,null);assert.notEqual(reused.existing.caption,f.oldPublication.caption);
  const attempts=(await f.db.query('SELECT usage,status FROM original_visual_attempts')).rows;assert.equal(attempts.length,2);assert.equal(attempts.filter(a=>a.usage?.newGeneration===false).length,1);assert.ok(attempts.every(a=>a.status==='media_ready'));
  await assert.rejects(f.publication.claimPublish(reused.existing.id),/nicht freigegeben/);
});

test('stale context and semantically incorrect image response cannot apply or begin media work',async t=>{
  const f=await fixture(t);
  await f.process(message('wrong'),async()=>instruction('revise_image',{image_instruction:'Pasta und Pfanne'}));
  assert.deepEqual(await f.snapshot(),f.job);assert.equal(f.approvals.length,0);
  await f.process(message('stale'),async()=>{const changed=await f.snapshot();changed.updatedAt='2026-09-26T12:00:00Z';await f.db.query('UPDATE content_jobs SET snapshot=$2 WHERE id=$1',[f.id,JSON.stringify(changed)]);return instruction('revise_image');});
  assert.equal((await f.snapshot()).revisions,0);assert.equal(f.approvals.length,0);
  assert.equal((await f.db.query('SELECT count(*)::int n FROM original_visual_attempts')).rows[0].n,0);
});

test('signed natural-language webhook only revises and requests review; no publisher or paid media call',async t=>{
  const {createHmac}=require('node:crypto');const loadRoute=require('./helpers/load-route.cjs');
  const f=await fixture(t,{asset:true});
  const env={META_APP_SECRET:'test-only-signature',WHATSAPP_PHONE_NUMBER_ID:'123456'};
  const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]]));Object.assign(process.env,env);
  t.after(()=>{for(const key of Object.keys(env)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}});
  let parses=0,paid=0,published=0;
  const route=loadRoute('app/api/whatsapp/webhook/route.ts',{
    'next/server':{after:()=>{}},
    '@/lib/production/repository':{productionRepository:()=>productionRepository(f.db)},
    '@/lib/whatsapp/process-instruction':{processOperatorInstruction:input=>f.process(input,async()=>{parses++;return instruction('revise_image');})},
    '@/lib/daily/draft':{sendDailyApproval:async()=>{throw Error('unexpected legacy path');}},
    '@/lib/meta/request-publication':{requestFacebookApproval:async()=>{paid++;}},
    '@/lib/meta/publisher':{publishFacebookPhoto:async()=>{published++;}},
  });
  const payload=JSON.stringify({object:'whatsapp_business_account',entry:[{changes:[{value:{metadata:{phone_number_id:'123456'},messages:[{id:'signed-revision',from:'491234',type:'text',text:{body:'Das Bild passt nicht. Mach ein neues mit geschnitzten Kürbissen und Halloween-Deko.'},context:{id:'wamid.current'}}]}}]}]});
  const request=()=>new Request('https://local.test/api/whatsapp/webhook',{method:'POST',headers:{'x-hub-signature-256':`sha256=${createHmac('sha256',env.META_APP_SECRET).update(payload).digest('hex')}`},body:payload});
  assert.equal((await route.POST(request())).status,200);assert.equal((await route.POST(request())).status,200);
  assert.equal(parses,1);assert.equal(paid,0);assert.equal(published,0);assert.equal((await f.snapshot()).status,'awaiting_approval');assert.equal((await f.publication.get(f.id)).status,'changes_requested');
});
