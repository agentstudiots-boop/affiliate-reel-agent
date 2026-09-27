const {test}=require('node:test');
const assert=require('node:assert/strict');
const {interpretVideoRevision}=require('../.test-build/lib/whatsapp/video-revision');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {opportunitySchema}=require('../.test-build/lib/content/schema');

test('natural video feedback becomes a bounded structured draft without any media call',async t=>{
  const previous=process.env.REPLICATE_API_TOKEN;process.env.REPLICATE_API_TOKEN='test-only';
  t.after(()=>{if(previous===undefined)delete process.env.REPLICATE_API_TOKEN;else process.env.REPLICATE_API_TOKEN=previous;});
  const opportunity=opportunitySchema.parse({product:{name:'YAVOCOS Kürbis Schnitzset',productVerifiedName:'YAVOCOS Kürbis Schnitzset',productVerifiedAt:new Date().toISOString(),sourceUrl:'https://www.amazon.de/dp/B0D9YQR9CT',affiliateUrl:'',price:'',targetGroup:'Halloween-Fans',benefits:'Herstellerhinweise prüfen',notes:''},category:'home_living',useCase:'Eine erwachsene Person schnitzt einen echten Kürbis für Halloween.',targetPlatform:'instagram',budget:'quality'});
  const job=await runContentJob(opportunity,{allowedFormats:['video']});job.status='approved';
  const revised={...job.content,scenes:job.content.scenes.map((scene,index)=>index===0?{...scene,visual:'Die fertige Kürbislaterne leuchtet zuerst, dann folgt eine Rückblende zur Schnitzhandlung.'}:scene)};
  const calls=[];
  const request=async(url,options)=>{calls.push({url,method:options.method});return Response.json({id:'abcdefghijklmnop',status:'succeeded',output:[JSON.stringify({intent:'revise_video',confidence:.96,video:revised})]});};
  const result=await interpretVideoRevision(job,'Beginne mit der fertigen Laterne und zeige dann die Entstehung',request);
  assert.match(result.scenes[0].visual,/Rückblende/);
  assert.equal(calls.length,1);assert.equal(calls[0].method,'POST');
  assert.match(calls[0].url,/api.replicate.com/);
});
