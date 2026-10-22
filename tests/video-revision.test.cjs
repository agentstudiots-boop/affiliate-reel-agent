const {test}=require('node:test');
const assert=require('node:assert/strict');
const {interpretVideoRevision}=require('../.test-build/lib/whatsapp/video-revision');
const {INSTRUCTION_MODEL}=require('../.test-build/lib/whatsapp/instruction');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');

test('natural video feedback becomes a bounded structured draft without any media call',async t=>{
  const previous=process.env.REPLICATE_API_TOKEN;process.env.REPLICATE_API_TOKEN='test-only';
  t.after(()=>{if(previous===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=previous;});
  const opportunity=opportunitySchema.parse({product:{name:'YAVOCOS Kürbis Schnitzset',productVerifiedName:'YAVOCOS Kürbis Schnitzset',productVerifiedAt:new Date().toISOString(),sourceUrl:'https://www.amazon.de/dp/B0D9YQR9CT',affiliateUrl:'',price:'',targetGroup:'Halloween-Fans',benefits:'Herstellerhinweise prüfen',notes:''},category:'home_living',useCase:'Eine erwachsene Person schnitzt einen echten Kürbis für Halloween.',targetPlatform:'instagram',budget:'quality'});
  const job=await runContentJob(opportunity,{allowedFormats:['video']});job.status='approved';
  const revised={...job.content,scenes:job.content.scenes.map((scene,index)=>index===0?{...scene,visual:'Die fertige Kürbislaterne leuchtet zuerst, dann folgt eine Rückblende zur Schnitzhandlung.'}:scene)};
  const calls=[];
  const request=async(url,options)=>{calls.push({url,method:options.method,input:JSON.parse(options.body).input});return Response.json({id:'abcdefghijklmnop',status:'succeeded',output:[JSON.stringify({intent:'revise_video',confidence:.96,video:revised})]});};
  const result=await interpretVideoRevision(job,'Beginne mit der fertigen Laterne und zeige dann die Entstehung',request);
  assert.match(result.scenes[0].visual,/Rückblende/);
  assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');
  assert.equal(calls[0].url,`https://api.replicate.com/v1/models/${INSTRUCTION_MODEL}/predictions`);
  assert.equal(calls[0].input.reasoning_effort,'none');assert.equal(calls[0].input.verbosity,'low');
  assert.equal(calls[0].input.temperature,undefined);
});

test('every attempted video revision call is recorded once in model_calls (agent whatsapp_video_revision)',async t=>{
  const {setModelCallStore}=require('../.test-build/lib/observability/model-calls');
  const previous=process.env.REPLICATE_API_TOKEN;process.env.REPLICATE_API_TOKEN='test-only';
  const recorded=[];setModelCallStore(async call=>{recorded.push(call);});
  t.after(()=>{setModelCallStore(null);if(previous===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=previous;});
  const opportunity=opportunitySchema.parse({product:{name:'YAVOCOS Kürbis Schnitzset',productVerifiedName:'YAVOCOS Kürbis Schnitzset',productVerifiedAt:new Date().toISOString(),sourceUrl:'https://www.amazon.de/dp/B0D9YQR9CT',affiliateUrl:'',price:'',targetGroup:'Halloween-Fans',benefits:'Herstellerhinweise prüfen',notes:''},category:'home_living',useCase:'Eine erwachsene Person schnitzt einen echten Kürbis für Halloween.',targetPlatform:'instagram',budget:'quality'});
  const job=await runContentJob(opportunity,{allowedFormats:['video']});job.status='approved';
  const metrics={input_token_count:1200,output_token_count:800,predict_time:2.5};
  const answer=body=>async()=>Response.json({id:'abcdefghijklmnop',status:'succeeded',metrics,output:[JSON.stringify(body)]});

  await interpretVideoRevision(job,'Beginne mit der fertigen Laterne',answer({intent:'revise_video',confidence:.96,video:job.content}));
  assert.deepEqual(recorded.map(call=>[call.agent,call.model,call.ok,call.inputTokens,call.outputTokens,call.predictTimeS,call.predictionId]),
    [['whatsapp_video_revision',INSTRUCTION_MODEL,true,1200,800,2.5,'abcdefghijklmnop']]);

  // A valid but unclear answer is a successful model call; the rejection is the orchestrator's, recorded once as ok.
  recorded.length=0;
  await assert.rejects(interpretVideoRevision(job,'Mach es irgendwie anders',answer({intent:'clarify',confidence:.4,video:null})),/nicht eindeutig/);
  assert.deepEqual(recorded.map(call=>call.ok),[true]);

  // Provider refusal: one failed record with the parser error class, no second record.
  recorded.length=0;
  await assert.rejects(interpretVideoRevision(job,'Beginne mit der Laterne',async()=>new Response('{}',{status:402})),/parser_billing_required/);
  assert.deepEqual(recorded.map(call=>[call.ok,call.errorClass]),[[false,'parser_billing_required']]);

  // No call attempted (no token): nothing recorded.
  recorded.length=0;delete process.env.REPLICATE_API_TOKEN;
  await assert.rejects(interpretVideoRevision(job,'Beginne mit der Laterne',answer({})),/parser_auth_missing/);
  assert.deepEqual(recorded,[]);
});
