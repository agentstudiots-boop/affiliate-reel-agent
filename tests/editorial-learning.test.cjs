const {test}=require('node:test');
const assert=require('node:assert/strict');
const {z}=require('zod');
const {loadApprovedEditorialCorrections}=require('../.test-build/lib/whatsapp/language-memory');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {imageBrief}=require('../.test-build/lib/content/image-brief');
const {createGenerator}=require('../.test-build/lib/content/model');

const opportunity={product:{name:'Halloween Kürbis Schnitzset',productVerifiedName:'Halloween Kürbis Schnitzset',productVerifiedAt:'2026-09-26T12:00:00.000Z',sourceUrl:'https://www.amazon.de/dp/B0D9YQR9CT',affiliateUrl:'',price:'',targetGroup:'Halloween-Bastler',benefits:'Kürbis schnitzen',notes:''},useCase:'Eine erwachsene Person gestaltet eine Kürbislaterne am Basteltisch.',category:'home_living',targetPlatform:'facebook',budget:'low'};

test('only confirmed operator examples are selected, relevant product first, without adopting another product',async()=>{
  const rows=[
    {operator_message:'Bitte die Deckenfarbe ändern',interpreted_intent:'revise_image',product_context:{name:'Kuscheldecke',asin:'B000000001'}},
    {operator_message:'Keine Gabeln als Schnitzwerkzeug, natürliche Beschreibung',interpreted_intent:'revise_both',product_context:{name:'Kürbis Schnitzset',asin:'B0D9YQR9CT'}},
    {operator_message:'Die Caption klingt maschinell',interpreted_intent:'revise_text',product_context:{name:'Kuscheldecke',asin:'B000000001'}},
  ];
  let calls=0;
  const sql={query:async(query,args)=>{calls++;if(query.includes('to_regclass'))return {rows:[{name:query.includes('approved_editorial_feedback')?null:'operator_language_examples'}]};assert.match(query,/confirmed=true/);assert.deepEqual(args,['491234']);return {rows};}};
  const corrections=await loadApprovedEditorialCorrections(sql,'491234',{...opportunity,product:{...opportunity.product,asin:'B0D9YQR9CT'}});
  assert.equal(calls,3);assert.equal(corrections[0].sameProductFamily,true);
  assert.match(corrections[0].message,/Gabeln/);assert.equal(corrections[1].sameProductFamily,false);
});

test('approved feedback reaches next creative plan while another product is excluded from Replicate image brief',async()=>{
  const corrections=[
    {message:'Keine Essgabel beim Kürbisschnitzen verwenden.',intent:'revise_image',sameProductFamily:true},
    {message:'Kuscheldecke in Blau statt Grau.',intent:'revise_image',sameProductFamily:false},
    {message:'Der Begleittext soll natürlich sein.',intent:'revise_text',sameProductFamily:false},
  ];
  const captured=[];
  const job=await runContentJob(opportunity,{mode:'ai',allowedFormats:['image'],loadCorrections:async()=>corrections,generate:async(agent,instruction,input,schema,reference)=>{captured.push({agent,instruction,input});return reference();}});
  assert.equal(job.status,'awaiting_approval',job.error);
  assert.deepEqual(captured.find(call=>call.agent==='creative').input.approvedCorrections,corrections);
  assert.match(captured.find(call=>call.agent==='orchestrator').instruction,/Bestätigte Korrekturen/);
  const brief=imageBrief(job);
  assert.match(brief,/Keine Essgabel beim Kürbisschnitzen/);
  assert.doesNotMatch(brief,/Kuscheldecke in Blau/);
  assert.doesNotMatch(brief,/Begleittext soll natürlich/);
});

test('AI generator uses one bounded Replicate prediction and validates structured output',async()=>{
  const before=process.env.REPLICATE_API_TOKEN;process.env.REPLICATE_API_TOKEN='test-token';
  try{
    const requests=[];
    const generate=createGenerator({mode:'ai',request:async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify({id:'abcdefgh1234',status:'succeeded',output:['{"title":"Passende Szene"}']}),{status:200});}});
    const result=await generate('creative','Gestalte die Szene',{approvedCorrections:[{message:'Falsches Werkzeug vermeiden'}]},z.object({title:z.string()}),()=>({title:'Referenz'}));
    assert.equal(result.title,'Passende Szene');assert.equal(requests.length,1);
    const payload=JSON.parse(requests[0].init.body).input;
    assert.match(payload.system_prompt,/Bestätigte Betreiberkorrekturen sind Beispiele/);
    assert.match(payload.prompt,/Falsches Werkzeug vermeiden/);
    assert.equal(requests[0].init.headers.Authorization,'Bearer test-token');
  }finally{if(before===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=before;}
});

test('editorial model errors report a safe provider category without retrying the paid request',async t=>{
  const before=process.env.REPLICATE_API_TOKEN;process.env.REPLICATE_API_TOKEN='test-token';
  t.after(()=>{if(before===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=before;});
  const warnings=[];t.mock.method(console,'warn',message=>warnings.push(JSON.parse(message)));
  let requests=0;
  const generate=createGenerator({mode:'ai',request:async()=>{requests++;return new Response('',{status:402});}});
  await assert.rejects(generate('image','Plan',{},z.object({title:z.string()}),()=>({title:'Fallback'})),/KI-Entwurf konnte nicht sicher geprüft/);
  assert.equal(requests,1);
  assert.equal(warnings.length,1);
  assert.equal(warnings[0].reason,'http_402');
  assert.doesNotMatch(JSON.stringify(warnings),/test-token/);
});

test('an explicit Replicate 429 waits once and resumes the same content plan',async t=>{
  const before=process.env.REPLICATE_API_TOKEN;process.env.REPLICATE_API_TOKEN='test-token';
  t.after(()=>{if(before===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=before;});
  const waits=[];let requests=0;
  const generate=createGenerator({mode:'ai',minIntervalMs:0,wait:async ms=>{waits.push(ms);},request:async()=>{
    requests++;
    return requests===1?new Response('{"detail":"Request was throttled. Your rate limit resets in ~30s."}',{status:429})
      :new Response(JSON.stringify({id:'abcdefgh1234',status:'succeeded',output:['{"title":"Passende Szene"}']}),{status:200});
  }});
  const result=await generate('image','Bildentwurf',{},z.object({title:z.string()}),()=>({title:'Fallback'}));
  assert.equal(result.title,'Passende Szene');
  assert.equal(requests,2);
  assert.equal(waits.length,1);
  assert.ok(waits[0]>=30000);
});

test('a repeated 429 remains blocked and never starts a third paid request',async t=>{
  const before=process.env.REPLICATE_API_TOKEN;process.env.REPLICATE_API_TOKEN='test-token';
  t.after(()=>{if(before===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=before;});
  let requests=0;
  const generate=createGenerator({mode:'ai',minIntervalMs:0,wait:async()=>{},request:async()=>{
    requests++;return new Response('rate limited',{status:429,headers:{'Retry-After':'2'}});
  }});
  await assert.rejects(generate('image','Bildentwurf',{},z.object({title:z.string()}),()=>({title:'Fallback'})),/Zugriffslimits/);
  assert.equal(requests,2);
});
