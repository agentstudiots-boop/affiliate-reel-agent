const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const loadRoute=require('./helpers/load-route.cjs');

test('daily cron produces one saved image brief, requires a WhatsApp window, and never repeats the same day',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  t.mock.method(global,'fetch',async()=>{throw new Error('Unexpected external request');});
  let scouts=0;const messages=[];
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{
      runContentJob:require('../.test-build/lib/content/orchestrator').runContentJob,
      runProductScout:async()=>{scouts++;return {candidates:[{
        resolvedProduct:{name:'Kuscheldecke',productVerifiedName:'Kuscheldecke',productVerifiedAt:'2026-09-26T08:00:00.000Z',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'',price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''}, kind:'Saisontrend',name:'Kuscheldecke',amazonUrl:'https://www.amazon.de/dp/B000000001',
        affiliateUrl:'https://www.amazon.de/dp/B000000001',
        targetGroup:'Haushalte',reelIdea:'Eine Kuscheldecke am Abend auf dem Sofa vergleichen.',
        whyNow:'Herbst',benefitsToVerify:['Material','Größe'],
      }]};},
    },
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/whatsapp/client':{
      sendWhatsAppText:async body=>{messages.push(body);return `wamid.mock.${messages.length}`;},
      dailyNotificationTemplateConfigured:()=>false,
      sendDailyNotificationTemplate:async()=>{throw Error('No template configured');},
    },
  });
  const first=await daily.createDailyDraft('2026-09-24');
  assert.equal(first.status,'awaiting_approval',JSON.stringify(first));assert.equal(first.whatsapp,'template_required');
  assert.equal(messages.length,0);
  const duplicate=await daily.createDailyDraft('2026-09-24');
  assert.equal(duplicate.status,'already_claimed');assert.equal(scouts,1);
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('inbound.test','491234','changes_requested','{}')");
  const next=await daily.createDailyDraft('2026-09-25');
  assert.equal(next.status,'needs_input');assert.equal(next.reason,'product_repeat_blocked');
  assert.equal(scouts,2);assert.equal(messages.length,0);
  const saved=await pg.query("SELECT status,whatsapp_message_id,scout_report->>'reason' AS reason FROM daily_drafts WHERE day='2026-09-25'");
  assert.equal(saved.rows[0].status,'needs_input');
  assert.equal(saved.rows[0].reason,'product_repeat_blocked');
  assert.equal(saved.rows[0].whatsapp_message_id,null);
  // A scheduled slot that ended in needs_input is retried (bounded by the attempt cap).
  assert.equal((await daily.createDailyDraft('2026-09-25')).status,'needs_input');
  const second=await daily.createDailyDraft('2026-09-25','afternoon');
  assert.equal(second.status,'needs_input');
  assert.notEqual(second.jobId,next.jobId);
  assert.equal((await daily.createDailyDraft('2026-09-25','afternoon')).status,'needs_input');
  const manual=await daily.createDailyDraft('2026-09-25','manual:wa-id-one');
  assert.equal(manual.status,'needs_input');
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM daily_drafts WHERE day='2026-09-25'")).rows[0].n,3);
  assert.equal(scouts,6);
  assert.equal(messages.filter(m=>/Beitragstext|Content-Freigabe/.test(m)).length,0,'no draft approval was sent; at most short slot notices');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
});

test('revised Halloween approval stays within WhatsApp text limits and shows the corrected scene',async()=>{
  const {runContentJob}=require('../.test-build/lib/content/orchestrator');
  const {opportunitySchema}=require('../.test-build/lib/content/schema');
  const daily=loadRoute('lib/daily/draft.ts',{'@/lib/orchestrator':{runContentJob,runProductScout:async()=>{throw Error('unexpected scout');}}});
  const job=await runContentJob(opportunitySchema.parse({product:{name:'Kürbis Schnitzset',productVerifiedName:'Kürbis Schnitzset',productVerifiedAt:'2026-09-26T08:00:00Z',sourceUrl:'https://www.amazon.de/dp/B0D9YQR9CT',affiliateUrl:'https://www.amazon.de/dp/B0D9YQR9CT?tag=alltaeglichle-21',targetGroup:'Halloween',benefits:'Herstellerhinweise',price:'',notes:''},useCase:'Ein Erwachsener schnitzt einen Halloween-Kürbis mit geeignetem Werkzeug.',targetPlatform:'facebook',budget:'low'}),{allowedFormats:['image']});
  job.content.slides[0].prompt+=' '.repeat(2)+'Zusätzlicher Text '.repeat(250);
  const body=daily.dailyApprovalMessage(job,'2026-09-27');
  assert.ok(body.length<3900,`WhatsApp message has ${body.length} characters`);
  assert.match(body,/erwachsene Person schnitzt/i);
  assert.match(body,/Keine Essgabeln/);
  assert.match(body,/Affiliate-Link|Produktlink/);
  assert.match(body,/Beitragstext \(geplante Facebook-Caption\):/);
  assert.doesNotMatch(body.split('Beitragstext (geplante Facebook-Caption):\n')[1].trimStart(),/^Werbung\b/);
  const complete='Ein vollständiger Beitragstext mit einem eindeutigen letzten Satz.';
  job.content.caption=complete;
  assert.ok(daily.dailyApprovalMessage(job,'2026-09-27').includes(complete));
  job.content.caption='   ';
  assert.throws(()=>daily.dailyApprovalMessage(job,'2026-09-27'),/missing_caption/);
});

test('a named WhatsApp search reaches TrendScout and can draft only a verified matching product',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const previous=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(previous===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=previous;});
  await db.query("INSERT INTO whatsapp_events(message_id,wa_id,body,payload) VALUES('named-search','491234','Artikelsuche Saugroboter','{}')");
  const searches=[],messages=[];
  const product={name:'Saugroboter Modell R',productVerifiedName:'Saugroboter Modell R',productVerifiedAt:new Date().toISOString(),
    sourceUrl:'https://www.amazon.de/dp/B0ABCD1234',affiliateUrl:'https://www.amazon.de/dp/B0ABCD1234?tag=alltaeglichle-21',
    price:'',targetGroup:'Haushalte',benefits:'Eignung vor Kauf prüfen',notes:''};
  const candidates=[{name:'Kürbis-Schnitzwerkzeug-Set',kind:'Saisontrend',category:'Halloween',searchQuery:'Kürbis-Schnitzwerkzeug-Set',reelIdea:'Kürbislaterne basteln',targetGroup:'Familien',whyNow:'Halloween'},
    {name:'Saugroboter',kind:'Dauerläufer',category:'Haushalt',searchQuery:'Saugroboter',resolvedProduct:product,
      reelIdea:'',
      targetGroup:'Haushalte',whyNow:'Gezielte Suche, kein belegter Trend.'}];
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runContentJob:require('../.test-build/lib/content/orchestrator').runContentJob,
      runProductScout:async query=>{searches.push(query);return {candidates,sources:[]};}},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/whatsapp/client':{sendWhatsAppText:async body=>{messages.push(body);return `wamid.search.approval.${messages.length}`;},
      dailyNotificationTemplateConfigured:()=>false,sendDailyNotificationTemplate:async()=>{throw Error('unexpected template');}},
  });
  const found=await daily.createDailyDraft('2026-09-27','manual:search-robot',undefined,'Saugroboter');
  assert.deepEqual(searches,['Saugroboter']);
  assert.equal(found.status,'awaiting_approval',JSON.stringify(found));
  const jobs=(await db.query('SELECT snapshot FROM content_jobs')).rows;
  assert.equal(jobs.length,1);assert.equal(jobs[0].snapshot.opportunity.product.name,product.name);
  assert.match(jobs[0].snapshot.opportunity.useCase,/Saugroboter Modell R im Alltag/);
  assert.equal(jobs[0].snapshot.opportunity.product.asin,'B0ABCD1234');
  assert.equal(messages.length,1);assert.match(messages[0],/Saugroboter Modell R/);
  assert.equal((await daily.createDailyDraft('2026-09-27','manual:search-robot',undefined,'Saugroboter')).status,'already_claimed');
  const generic=await daily.createDailyDraft('2026-09-27','manual:general-search');
  assert.equal(generic.status,'needs_input');assert.equal(generic.reason,'product_repeat_blocked');
  assert.equal(searches.at(-1),undefined);
  const missing=await daily.createDailyDraft('2026-09-27','manual:search-missing',undefined,'Wäschetrockner');
  assert.equal(missing.status,'needs_input');assert.equal(missing.reason,'product_unresolved');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM content_jobs')).rows[0].n,1);
  assert.equal(messages.length,1);
});

test('a generic search stops before content planning when no Amazon product can be verified',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  let planned=false;
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runProductScout:async()=>({candidates:[{name:'Saisonidee',kind:'Saisontrend',resolutionError:'product_unresolved'}]}),
      runContentJob:async()=>{planned=true;throw Error('Must not plan unresolved product');}},
    '@/lib/memory/db':{getDatabase:()=>db},
  });
  const result=await daily.createDailyDraft('2026-09-27','manual:unresolved');
  assert.equal(result.status,'needs_input');
  assert.equal(result.reason,'product_unresolved');
  assert.equal(planned,false);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM content_jobs')).rows[0].n,0);
  assert.equal((await daily.createDailyDraft('2026-09-27','manual:unresolved')).status,'already_claimed');
});

test('an exact operator ASIN records Amazon verification failures without calling the scout or planning',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  let verifications=0;
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runProductScout:async()=>{throw Error('no trend search');},runContentJob:async()=>{throw Error('no planning');}},
    '@/lib/product-resolver':{findAmazonProductByAsin:async()=>{verifications++;throw Error('amazon_verification_blocked');}},
    '@/lib/memory/db':{getDatabase:()=>db},
  });
  const result=await daily.createDailyDraft('2026-09-30','manual:verified-link','B0C2C739KY');
  assert.equal(result.status,'needs_input');assert.equal(result.reason,'amazon_verification_blocked');
  assert.equal(verifications,1);
  assert.deepEqual((await pg.query("SELECT status,scout_report->>'reason' AS reason FROM daily_drafts WHERE job_id=$1",[result.jobId])).rows,
    [{status:'needs_input',reason:'amazon_verification_blocked'}]);
  assert.equal((await daily.createDailyDraft('2026-09-30','manual:verified-link','B0C2C739KY')).status,'already_claimed');
  assert.equal(verifications,1);
  const missing=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runProductScout:async()=>{throw Error('no trend search');},runContentJob:async()=>{throw Error('no planning');}},
    '@/lib/product-resolver':{AMAZON_IDENTITY_MISSING:'amazon_identity_missing',findAmazonProductByAsin:async()=>{throw Error('amazon_identity_missing');}},
    '@/lib/memory/db':{getDatabase:()=>db},
  });
  const other=await missing.createDailyDraft('2026-09-30','manual:identity-missing','B0C2C739KY');
  assert.equal(other.status,'needs_input');assert.equal(other.reason,'amazon_identity_missing');
  assert.equal((await pg.query("SELECT scout_report->>'reason' AS reason FROM daily_drafts WHERE job_id=$1",[other.jobId])).rows[0].reason,'amazon_identity_missing');
});

test('a fully cooled-down TrendScout report stops before content planning',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())
    await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  let planned=false;
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runProductScout:async()=>({candidates:[],cooldownBlocked:2,cooldownBlockedSeasonal:2,cooldownBlockedAutomatic:2,sources:[]}),
      runContentJob:async()=>{planned=true;throw Error('Unexpected planning');}},
    '@/lib/memory/db':{getDatabase:()=>({query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q)})},
  });
  const result=await daily.createDailyDraft('2026-09-29','morning');
  assert.equal(result.status,'needs_input');
  assert.equal(result.reason,'product_repeat_blocked');
  assert.equal(planned,false);
  const saved=await pg.query("SELECT scout_report->>'reason' AS reason FROM daily_drafts WHERE day='2026-09-29' AND slot='morning'");
  assert.equal(saved.rows[0].reason,'product_repeat_blocked');
});

test('a blocked current trend does not mislabel an unresolved automatic candidate',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())
    await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runProductScout:async()=>({candidates:[{kind:'Saisontrend',resolutionError:'product_unresolved'}],
      cooldownBlocked:1,cooldownBlockedSeasonal:0,cooldownBlockedAutomatic:0,sources:[]})},
    '@/lib/memory/db':{getDatabase:()=>({query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q)})},
  });
  const result=await daily.createDailyDraft('2026-09-30','morning');
  assert.equal(result.reason,'product_unresolved');
});

test('automatic draft uses an already researched evergreen when seasonal products are unavailable',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())
    await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  t.mock.method(global,'fetch',async()=>{throw Error('Unexpected external request');});
  const evergreen={name:'Küchenreibe Modell A',productVerifiedName:'Küchenreibe Modell A',productVerifiedAt:new Date().toISOString(),
    sourceUrl:'https://www.amazon.de/dp/B000000044',affiliateUrl:'https://www.amazon.de/dp/B000000044?tag=alltaeglichle-21',
    price:'',targetGroup:'Hobbyköche',benefits:'Eignung vor Kauf prüfen',notes:''};
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runContentJob:require('../.test-build/lib/content/orchestrator').runContentJob,
      runProductScout:async()=>({candidates:[
        {name:'Kürbis-Schnitzwerkzeug-Set',kind:'Saisontrend',resolutionError:'product_unresolved'},
        {name:'Küchenreibe Modell A',kind:'Dauerläufer',category:'Küche',resolvedProduct:evergreen,
          reelIdea:'Eine Zitrone für ein Rezept abreiben und die Handhabung der Reibe zeigen.',whyNow:'Ganzjährig'},
      ],cooldownBlockedAutomatic:1,sources:[]})},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/whatsapp/client':{sendWhatsAppText:async()=>{throw Error('Unexpected send');},
      dailyNotificationTemplateConfigured:()=>false,sendDailyNotificationTemplate:async()=>{throw Error('Unexpected template');}},
  });
  const result=await daily.createDailyDraft('2026-09-30','morning');
  assert.equal(result.status,'awaiting_approval',JSON.stringify(result));
  assert.equal(result.whatsapp,'template_required');
  const jobs=await pg.query('SELECT snapshot FROM content_jobs');
  assert.equal(jobs.rows.length,1);
  assert.equal(jobs.rows[0].snapshot.opportunity.product.asin,'B000000044');
});

class Rejected extends Error{constructor(){super('rejected');this.code=132001;this.subcode=0;this.httpStatus=404;this.providerMessage='template missing';}}
async function retryFixture(t){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  const product={name:'Kuscheldecke',productVerifiedName:'Kuscheldecke',productVerifiedAt:'2026-09-26T08:00:00.000Z',sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'https://www.amazon.de/dp/B000000001?tag=alltaeglichle-21',price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''};
  const state={scouts:0,fail:0,messages:[],sendError:null,template:false,templates:0,templateError:null};
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runContentJob:require('../.test-build/lib/content/orchestrator').runContentJob,
      runProductScout:async()=>{state.scouts++;if(state.fail-->0)throw Error('Amazon unavailable');
        return {candidates:[{resolvedProduct:product,kind:'Saisontrend',name:'Kuscheldecke',category:'Wohnen',reelIdea:'Eine Kuscheldecke am Abend auf dem Sofa vergleichen.',whyNow:'Herbst'}]};}},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/whatsapp/client':{WhatsAppRejectedError:Rejected,sendWhatsAppText:async body=>{if(state.sendError)throw state.sendError;state.messages.push(body);return `wamid.${state.messages.length}`;},
      dailyNotificationTemplateConfigured:()=>!!state.template,sendDailyNotificationTemplate:async()=>{if(state.templateError)throw state.templateError;state.templates++;return `wamid.template.${state.templates}`;}},
  });
  return {pg,daily,state};
}

test('a failed scheduled slot is retried by the next cron call, and only once it succeeds it is claimed',async t=>{
  const {pg,daily,state}=await retryFixture(t);
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.1','491234','changes_requested','{}')");
  state.fail=1;
  const first=await daily.createDailyDraft('2026-09-30','afternoon');
  assert.equal(first.status,'failed');
  const second=await daily.createDailyDraft('2026-09-30','afternoon');
  assert.equal(second.status,'awaiting_approval',JSON.stringify(second));
  assert.equal(second.whatsapp,'approval_sent');
  assert.notEqual(second.jobId,first.jobId);
  assert.equal(state.messages.length,1);
  assert.match(state.messages[0],/Beitragstext/);assert.match(state.messages[0],/B000000001/);assert.match(state.messages[0],/tag=alltaeglichle-21/);
  // Repeated triggers neither plan nor send again.
  const third=await daily.createDailyDraft('2026-09-30','afternoon');
  assert.equal(third.status,'already_claimed');assert.equal(state.scouts,2);assert.equal(state.messages.length,1);
  const row=await pg.query("SELECT attempts,status FROM daily_drafts WHERE slot='afternoon'");
  assert.deepEqual(row.rows[0],{attempts:2,status:'awaiting_approval'});
});

test('a killed attempt (stale claim) is recovered, a fresh claim is not stolen, attempts are capped',async t=>{
  const {pg,daily,state}=await retryFixture(t);
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.1','491234','changes_requested','{}')");
  await pg.query("INSERT INTO daily_drafts(day,slot,job_id,status) VALUES('2026-09-30','morning',gen_random_uuid(),'planning')");
  assert.equal((await daily.createDailyDraft('2026-09-30','morning')).status,'already_claimed');
  assert.equal(state.scouts,0);
  await pg.query("UPDATE daily_drafts SET updated_at=now()-interval '10 minutes'");
  assert.equal((await daily.createDailyDraft('2026-09-30','morning')).status,'awaiting_approval');
  await pg.query("INSERT INTO daily_drafts(day,slot,job_id,status,attempts) VALUES('2026-09-30','afternoon',gen_random_uuid(),'failed',3)");
  assert.equal((await daily.createDailyDraft('2026-09-30','afternoon')).status,'already_claimed');
  assert.equal(state.scouts,1);
});

test('an approval saved outside the WhatsApp window is delivered once the operator writes again',async t=>{
  const {pg,daily,state}=await retryFixture(t);
  const first=await daily.createDailyDraft('2026-09-30','afternoon');
  assert.equal(first.whatsapp,'template_required');assert.equal(state.messages.length,0);
  assert.equal(await daily.sendPendingDailyApprovals(),0);
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.2','491234','changes_requested','{}')");
  assert.equal(await daily.sendPendingDailyApprovals(),1);
  assert.equal(await daily.sendPendingDailyApprovals(),0);
  assert.equal(state.messages.length,1);
});

test('a failed WhatsApp send keeps the planned draft instead of marking the slot failed',async t=>{
  const {pg,daily,state}=await retryFixture(t);
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.1','491234','changes_requested','{}')");
  state.sendError=new Error('network');
  const result=await daily.createDailyDraft('2026-09-30','afternoon');
  assert.equal(result.status,'awaiting_approval');assert.equal(result.whatsapp,'approval_send_failed');
  assert.equal((await pg.query("SELECT status FROM daily_drafts")).rows[0].status,'awaiting_approval');
  assert.equal((await daily.createDailyDraft('2026-09-30','afternoon')).status,'already_claimed');
  assert.equal(state.scouts,1);
});

test('outside the 24 h window the approved template is sent once, never counts as approval, and a rejected template is retried',async t=>{
  const {pg,daily,state}=await retryFixture(t);
  state.template=true;state.templateError=new Rejected();
  const first=await daily.createDailyDraft('2026-09-30','afternoon');
  assert.equal(first.status,'awaiting_approval');assert.equal(first.whatsapp,'template_rejected');
  assert.equal(state.messages.length,0);assert.equal(state.templates,0);
  state.templateError=null;
  const second=await daily.createDailyDraft('2026-09-30','afternoon');
  assert.equal(second.status,'already_claimed');assert.equal(second.whatsapp,'notification_sent');
  assert.equal(state.templates,1);
  const third=await daily.createDailyDraft('2026-09-30','afternoon');
  assert.equal(third.status,'already_claimed');assert.equal(state.templates,1);assert.equal(state.scouts,1);
  const row=(await pg.query("SELECT status,whatsapp_message_id,notification_message_id FROM daily_drafts")).rows[0];
  assert.deepEqual(row,{status:'awaiting_approval',whatsapp_message_id:null,notification_message_id:'wamid.template.1'});
  assert.equal(state.messages.length,0);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
});

test('a plan rejected by the publication gate is stored with its reason and explained by Status',async t=>{
  const {pg,daily,state}=await retryFixture(t);
  const {latestImagePostsStatus}=loadRoute('lib/reporting/whatsapp-status.ts',{'../memory/ensure-automation-schema':{ensureAutomationSchema:async()=>{}},'../daily/slots':require('../.test-build/lib/daily/slots')});
  const gated=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runProductScout:async()=>({candidates:[{kind:'Saisontrend',name:'Kuscheldecke',category:'Wohnen',whyNow:'Herbst',reelIdea:'x',
      resolvedProduct:{name:'Kuscheldecke',productVerifiedName:'Kuscheldecke',productVerifiedAt:new Date().toISOString(),sourceUrl:'https://www.amazon.de/dp/B000000001',affiliateUrl:'https://www.amazon.de/dp/B000000001?tag=alltaeglichle-21',price:'',targetGroup:'',benefits:'',notes:''}}]}),
      runContentJob:async(opportunity,options)=>({id:options.id,status:'awaiting_approval',opportunity,events:[],content:{format:'image',caption:'Text'},marketing:{primary:'Reel'},modelCalls:0,totalTokens:0,revisions:0,mode:'reference'})},
    '@/lib/memory/db':{getDatabase:()=>({query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))})},
    '@/lib/whatsapp/client':{WhatsAppRejectedError:Error,sendWhatsAppText:async()=>{throw Error('unexpected');},dailyNotificationTemplateConfigured:()=>false,sendDailyNotificationTemplate:async()=>{throw Error('unexpected');}},
  });
  const result=await gated.createDailyDraft('2026-09-30','afternoon');
  assert.equal(result.status,'needs_input');assert.equal(result.reason,'publication_gate_failed');
  const row=(await pg.query("SELECT scout_report->>'reason' AS reason,scout_report->>'detail' AS detail FROM daily_drafts")).rows[0];
  assert.equal(row.reason,'publication_gate_failed');assert.ok(row.detail&&row.detail.length>5);
  const text=await latestImagePostsStatus({query:(q,v)=>pg.query(q,v)});
  assert.match(text,/needs_input \(Entwurf nicht freigabefähig: /);
  assert.equal(state.messages.length,0);
});

test('"Finde ein Artikel Silpat Matte" replaces the open draft and searches the named product, without touching other messages',async t=>{
  const {replacementRequest}=require('../.test-build/lib/whatsapp/replace-draft');
  assert.deepEqual(replacementRequest('Die Produktbeschreibung passt nicht zum artikel. Finde ein artikel silpat matte dann passt die produktbeschreibung'),{search:'silpat matte'});
  assert.deepEqual(replacementRequest('Finde stattdessen Silpat Backmatte'),{search:'Silpat Backmatte'});
  assert.deepEqual(replacementRequest('Ein anderes Produkt zu dieser artikel beschreibung'),{});
  for(const text of ['Schreib den Text stattdessen kürzer','Finde einen besseren Einstieg','Mach das Bild mit geschnitzten Kürbissen','Freigeben','Finde ein Produkt?','Mach den Text natürlicher'])assert.equal(replacementRequest(text),null,text);

  const {pg,daily,state}=await retryFixture(t);
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.1','491234','changes_requested','{}')");
  const draft=await daily.createDailyDraft('2026-10-01','afternoon');
  assert.equal(draft.whatsapp,'approval_sent');
  const {startImagePostFromWhatsApp}=require('../.test-build/lib/whatsapp/start-image-post');
  const started=[],sent=[];
  const db=()=>({query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))});
  const start=async(...args)=>{started.push(args);return {status:'awaiting_approval',jobId:'new',whatsapp:'approval_sent'};};
  const message={id:'wamid.replace',from:'491234',body:'Die Produktbeschreibung passt nicht zum artikel. Finde ein artikel silpat matte dann passt die produktbeschreibung',replyToMessageId:null,payload:{}};
  assert.equal(await startImagePostFromWhatsApp(message,db,start,async text=>{sent.push(text);return 'wamid.x';}),true);
  assert.equal(started.length,1);assert.equal(started[0][2],undefined);assert.equal(started[0][3],'silpat matte');
  const row=(await pg.query("SELECT status,feedback FROM daily_drafts WHERE slot='afternoon'")).rows[0];
  assert.deepEqual(row,{status:'needs_input',feedback:'replaced_by_operator'});
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM product_selection_locks WHERE key LIKE 'family:%'")).rows[0].n,0);
  assert.match(sent[0],/Alten Entwurf.*gestoppt/);assert.ok(!sent.some(text=>/Content Studio/.test(text)));
  // A replayed webhook delivery starts nothing again.
  await startImagePostFromWhatsApp(message,db,start,async()=>'wamid.y');assert.equal(started.length,1);
  // A correction that only mentions the text does not start a search.
  const text=await startImagePostFromWhatsApp({...message,id:'wamid.text',body:'Schreib den Text stattdessen kürzer'},db,start,async()=>'wamid.z');
  assert.equal(text,false);assert.equal(started.length,1);
  assert.equal(state.scouts,1);
});

test('a forwarded Amazon link right after „Neuer Auftrag“ starts the new job instead of correcting the open draft',async t=>{
  const {pg}=await retryFixture(t);
  const {startImagePostFromWhatsApp}=require('../.test-build/lib/whatsapp/start-image-post');
  const started=[],sent=[];
  const db=()=>({query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))});
  const start=async(...args)=>{started.push(args);return {status:'awaiting_approval',jobId:'new',whatsapp:'approval_sent'};};
  const send=async text=>{sent.push(text);return 'wamid.s';};
  await startImagePostFromWhatsApp({id:'wamid.new',from:'491234',body:'Neuer auftrag',replyToMessageId:null,payload:{}},db,start,send);
  assert.match(sent[0],/Was soll ich bewerben\?/);assert.ok(!/Content Studio/.test(sent[0]));assert.equal(started.length,0);
  const linkBody='WAIWO Silikon Backmatte 2er Set 42x30 cm hitzebeständig bis 250 °C https://www.amazon.de/dp/B0CM14MKY8';
  await startImagePostFromWhatsApp({id:'wamid.link',from:'491234',body:linkBody,replyToMessageId:null,payload:{}},db,start,send,async()=>'B0CM14MKY8');
  assert.equal(started.length,1);assert.equal(started[0][2],'B0CM14MKY8');
  // Without the preceding request the link is only stored and asks for confirmation.
  await pg.query("DELETE FROM whatsapp_events");
  await startImagePostFromWhatsApp({id:'wamid.link2',from:'491234',body:linkBody,replyToMessageId:null,payload:{}},db,start,send,async()=>'B0CM14MKY8');
  assert.equal(started.length,1);assert.match(sent.at(-1),/Produktlink erhalten/);
});

test('Amazon titles are HTML-decoded and umlaut mis-casing is repaired',()=>{
  const {cleanAmazonTitle}=require('../.test-build/lib/product-resolver');
  assert.equal(cleanAmazonTitle('Silikon Backmatte Backofen HitzebestäNdig Mit Noppen Wiederverwendbar FüR'),'Silikon Backmatte Backofen Hitzebeständig Mit Noppen Wiederverwendbar Für');
  assert.equal(cleanAmazonTitle('Tortillapresse 10&#34; Orange &amp; Co &quot;Pro&quot;'),'Tortillapresse 10" Orange & Co "Pro"');
  assert.equal(cleanAmazonTitle('<b>Matte</b>  Größe   M'),'Matte Größe M');
});
