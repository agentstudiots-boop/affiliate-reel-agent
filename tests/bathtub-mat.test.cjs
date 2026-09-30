const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runContentJob,reviseOperatorInstruction}=require('../.test-build/lib/content/orchestrator');
const {interpretInstruction}=require('../.test-build/lib/whatsapp/instruction');
const {bathtubMatIssues,bathtubMatUseCase}=require('../.test-build/lib/content/bathtub-mat');
const {facebookPagePublicationError}=require('../.test-build/lib/meta/publication-eligibility');

const name='Rutschfeste Badematte, Ganzkörper-Badematte Mit Kissen, Weich Gesteppte Badewannenmatte';
const opportunity={product:{name,productVerifiedName:name,productVerifiedAt:new Date().toISOString(),
  asin:'B0C2C739KY',sourceUrl:'https://www.amazon.de/dp/B0C2C739KY',
  affiliateUrl:'https://www.amazon.de/dp/B0C2C739KY?tag=alltaeglichle-21',price:'',
  targetGroup:'Haushalte',benefits:'Eignung und Eigenschaften am konkreten Modell prüfen.',notes:''},
  category:'home_living',useCase:bathtubMatUseCase,targetPlatform:'facebook',budget:'low',goal:'education',verifiedFacts:[]};

test('verified bathtub mat uses the bathtub in a reference image plan and keeps the affiliate gate',async()=>{
  const job=await runContentJob(opportunity,{allowedFormats:['image']});
  assert.equal(job.status,'awaiting_approval',job.review?.issues.join('; '));
  assert.equal(bathtubMatIssues(job.opportunity,job.content).length,0);
  assert.match(job.content.visualConcept.mainIdea,/badewanne/i);
  assert.doesNotMatch(job.content.caption,/vor der dusche/i);
  assert.match(job.content.caption,/Affiliate-Link.*Provision/i);
});

test('natural factual correction updates image and caption without a model request or automatic approval',async()=>{
  const job=await runContentJob(opportunity,{allowedFormats:['image']});
  assert.equal(job.status,'awaiting_approval');
  const old=structuredClone(job);
  old.opportunity.useCase='Die Matte vor die Dusche legen.';
  old.content.useCase='Badematte vor der Dusche';
  old.content.visualConcept.mainIdea+=' Die Matte liegt vor der Dusche.';
  old.content.visualConcept.everydaySituation+=' Die Matte liegt vor der Dusche.';
  old.content.slides[0].visual+=' Die Matte liegt vor der Dusche.';
  old.content.slides[0].prompt+=' Die Matte liegt vor der Dusche.';
  old.content.slides[0].alt+=' Die Matte liegt vor der Dusche.';
  old.content.caption='Werbung | Die Badematte vor der Dusche. Bei einem Kauf über den Affiliate-Link kann ich eine Provision erhalten.';
  assert.ok(bathtubMatIssues(old.opportunity,old.content).length);
  assert.match(facebookPagePublicationError({...old,status:'approved'}),/Badewannenmatte|Bodenmatte/);
  let calls=0;
  const instruction=await interpretInstruction('Das ist aber eine Badematte für in die Badewanne',old,async()=>{calls++;throw Error('no provider');});
  assert.equal(calls,0);
  assert.equal(instruction.intent,'revise_both');
  const revised=reviseOperatorInstruction(old,instruction);
  assert.equal(revised.status,'awaiting_approval');
  assert.equal(bathtubMatIssues(revised.opportunity,revised.content).length,0);
  assert.match(revised.content.caption,/Badewanne/);
  assert.match(revised.content.caption,/Affiliate-Link.*Provision/);
  assert.match(revised.content.slides[0].visual,/innerhalb einer leeren Badewanne/);
  assert.equal(revised.content.title,revised.content.hook);
  assert.equal(revised.opportunity.product.asin,old.opportunity.product.asin);
  assert.equal(revised.opportunity.product.affiliateUrl,old.opportunity.product.affiliateUrl);
  assert.equal(revised.id,old.id);
});
