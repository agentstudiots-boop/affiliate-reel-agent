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
  assert.equal((await daily.createDailyDraft('2026-09-25')).status,'already_claimed');
  const second=await daily.createDailyDraft('2026-09-25','afternoon');
  assert.equal(second.status,'needs_input');
  assert.notEqual(second.jobId,next.jobId);
  assert.equal((await daily.createDailyDraft('2026-09-25','afternoon')).status,'already_claimed');
  const manual=await daily.createDailyDraft('2026-09-25','manual:wa-id-one');
  assert.equal(manual.status,'needs_input');
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM daily_drafts WHERE day='2026-09-25'")).rows[0].n,3);
  assert.equal(scouts,4);
  assert.equal(messages.length,0);
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
