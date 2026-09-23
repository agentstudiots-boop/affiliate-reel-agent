const {test}=require('node:test');const assert=require('node:assert/strict');
const {selectRenderer}=require('../.test-build/lib/renderers/selection');
const {interpretGermanMessage}=require('../.test-build/lib/whatsapp/intent');
const {allowedSender,verifyWebhookSignature}=require('../.test-build/lib/whatsapp/client');
const {createHmac}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');
const {productionRepository}=require('../.test-build/lib/production/repository');
const base={creativeType:'listicle',visualComplexity:'low',specificScenesRequired:false,motionImportance:'low',productVisualImportance:'medium',storytellingComplexity:'low',availablePerformanceData:false,expectedOpportunityValueCents:null,estimatedProductionCostCents:null,knownAffiliateCommission:null,provenClicks:0,provenConversions:0};

test('first 15 successful videos are forced to Faceless Storyboard',()=>{
  for(let count=0;count<15;count++)assert.deepEqual(selectRenderer(count,{...base,specificScenesRequired:true}),{provider:'faceless',mode:'FACELESS_STORYBOARD',reason:'BOOTSTRAP_STORYBOARD_TEST',explanation:`Bootstrap ${count}/15: ausschließlich Faceless Storyboard bis 15 erfolgreich gespeicherte Videos.`});
  assert.equal(selectRenderer(15,{...base,specificScenesRequired:true}).mode,'RUNWAY');
});

test('post-bootstrap renderer selection follows economics and scene needs',()=>{
  assert.equal(selectRenderer(15,base).mode,'FACELESS_STORYBOARD');
  assert.equal(selectRenderer(15,{...base,visualComplexity:'medium',motionImportance:'medium'}).mode,'FACELESS_MOTION_LITE');
  assert.equal(selectRenderer(15,{...base,visualComplexity:'high',storytellingComplexity:'high',availablePerformanceData:true,expectedOpportunityValueCents:3000,estimatedProductionCostCents:500,provenClicks:40}).mode,'FACELESS_MOTION_PRO');
});

test('German approval language is interpreted within a fixed capability set',()=>{
  assert.equal(interpretGermanMessage('Freigeben.','RENDER_COST').intent,'APPROVE');
  assert.deepEqual(interpretGermanMessage('CTA weniger werblich.','CONTENT_PUBLISH').target,'cta');
  assert.equal(interpretGermanMessage('Nimm Storyboard statt Motion Pro.','RENDER_COST').intent,'REVISION_REQUEST');
  assert.equal(interpretGermanMessage('Nicht veröffentlichen.','CONTENT_PUBLISH').intent,'REJECT');
  assert.equal(interpretGermanMessage('Dauerhaft freigeben.','CAPABILITY_PROPOSAL').intent,'APPROVE_PERMANENTLY');
  assert.equal(interpretGermanMessage('Mach das irgendwie.','RENDER_COST').intent,'CLARIFY');
});

test('WhatsApp sender allowlist and webhook signature fail closed',()=>{
  const previous={senders:process.env.WHATSAPP_ALLOWED_SENDERS,secret:process.env.WHATSAPP_APP_SECRET};process.env.WHATSAPP_ALLOWED_SENDERS='+4912345,+4998765';process.env.WHATSAPP_APP_SECRET='secret';
  try{assert.equal(allowedSender('4912345'),true);assert.equal(allowedSender('4911111'),false);const body='{"test":true}',sig='sha256='+createHmac('sha256','secret').update(body).digest('hex');assert.equal(verifyWebhookSignature(body,sig),true);assert.equal(verifyWebhookSignature(body+'x',sig),false);}
  finally{for(const [key,value] of Object.entries(previous)){const env=key==='senders'?'WHATSAPP_ALLOWED_SENDERS':'WHATSAPP_APP_SECRET';if(value===undefined)delete process.env[env];else process.env[env]=value;}}
});

test('bootstrap count uses only successful real videos with a persisted blob',async()=>{
  const pg=new PGlite();const db={query:(q,v)=>pg.query(q,v),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  try{await pg.exec(fs.readFileSync('db/migrations/001_memory.sql','utf8'));await pg.exec(fs.readFileSync('db/migrations/002_production_control.sql','utf8'));const jobId=crypto.randomUUID();await pg.query("INSERT INTO products(id,name,source_url) VALUES('p','P','https://example.com/p')");await pg.query("INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at) VALUES($1,'p','general','general','conversion','instagram','','{}','approved','{}',now(),now())",[jobId]);const repo=productionRepository(db);const input={contentJobId:jobId,script:'Ein ausreichend langes und geprüftes Produktionsskript.',voiceId:'voice',decision:{provider:'faceless',mode:'FACELESS_STORYBOARD',reason:'BOOTSTRAP_STORYBOARD_TEST',explanation:'test'},factors:base,estimatedCredits:20,estimatedCostCents:null,affiliateCommission:null,approvalPayload:{},senderHash:''};
    const failed=await repo.create(input);await repo.update(failed.id,{status:'failed'});const missing=await repo.create(input);await repo.update(missing.id,{status:'completed'});assert.equal(await repo.successfulFacelessVideos(),0);const good=await repo.create(input);await repo.update(good.id,{status:'completed',blob_url:'https://blob.example/reels/x.mp4'});assert.equal(await repo.successfulFacelessVideos(),1);const approved=await repo.create(input);await repo.approveByApprovalId(approved.approvalId,'Freigeben');assert.equal((await repo.get(approved.id)).status,'approved');
  }finally{await pg.close();}
});
