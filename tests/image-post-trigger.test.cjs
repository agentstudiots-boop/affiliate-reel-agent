const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { imagePostCommand, startImagePostFromWhatsApp } = require('../.test-build/lib/whatsapp/start-image-post');
const loadRoute=require('./helpers/load-route.cjs');

test('TrendScout searches the requested product family instead of seasonal defaults',async()=>{
  const queries=[];
  const scout=loadRoute('lib/agents/product-scout.ts',{'@/lib/tavily':{
    tavilySearch:async args=>{queries.push(args);return [];},tavilySources:()=>[],
  }});
  const report=await scout.scoutProducts('Saugroboter');
  assert.equal(queries.length,1);assert.match(queries[0].query,/Saugroboter/);
  assert.equal(report.output.candidates.length,1);
  assert.equal(report.output.candidates[0].searchQuery,'Saugroboter');
  assert.doesNotMatch(JSON.stringify(report.output),/Kürbis-Schnitzwerkzeug-Set|Kuscheldecke/);
  assert.match(report.output.summary,/gezielte/i);
});

test('WhatsApp starts each explicit image post once, while replies stay with their approval', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(fs.readFileSync('db/migrations/001_memory.sql','utf8'));
  await pg.exec(fs.readFileSync('db/migrations/002_production_gates.sql','utf8'));
  const db = { query: (q,v) => pg.query(q,v) };
  const prior = process.env.WHATSAPP_APPROVER_WA_ID;
  process.env.WHATSAPP_APPROVER_WA_ID = '491234';
  t.after(() => { if (prior === undefined) delete process.env.WHATSAPP_APPROVER_WA_ID; else process.env.WHATSAPP_APPROVER_WA_ID = prior; });
  const calls = [], messages = [];
  const start = async (day, slot, product, search) => { calls.push({day,slot,product,search}); return {status:'awaiting_approval',jobId:'new-job',whatsapp:'approval_sent'}; };
  const send = async body => { messages.push(body); return 'notice'; };
  const message = { id:'wamid.test.1=', from:'491234',body:'Bildpost https://www.amazon.de/dp/B0D9YQR9CT?tag=alltaeglichle-21',replyToMessageId:null,payload:{} };
  assert.equal(imagePostCommand(message.body).product, 'B0D9YQR9CT');
  assert.equal(await startImagePostFromWhatsApp(message,()=>db,start,send),true);
  assert.equal(await startImagePostFromWhatsApp(message,()=>db,start,send),true);
  assert.equal(calls.length,1);
  assert.match(calls[0].slot,/^manual:[a-f0-9]{64}$/);
  assert.equal(calls[0].product,'B0D9YQR9CT');
  assert.equal(await startImagePostFromWhatsApp({...message,id:'wamid.reply',replyToMessageId:'wamid.approval'},()=>db,start,send),false);
  assert.equal(await startImagePostFromWhatsApp({...message,id:'wamid.stranger',from:'499999'},()=>db,start,send),true);
  assert.equal(calls.length,1);
  assert.equal(messages.length,0);
  assert.equal(await startImagePostFromWhatsApp({...message,id:'wamid.bad',body:'Bildpost example.com'},()=>db,start,send),true);
  assert.equal(calls.length,1); assert.match(messages[0],/Bitte sende/);
  for (const [index,body] of ['Artikelsuche Saugroboter','Artikelsuche Produktname Saugroboter',
    'Artikelsuche (Produktname Saugroboter)','Artikelsuche (Saugroboter)','Neue Artikelsuche: Saugroboter'].entries()) {
    assert.deepEqual(imagePostCommand(body),{product:undefined,search:'Saugroboter',invalid:false});
    assert.equal(await startImagePostFromWhatsApp({...message,id:`wamid.robot.${index}`,body},()=>db,start,send),true);
    assert.equal(calls.at(-1).search,'Saugroboter');
  }
  assert.equal(calls.length,6);
  assert.equal(await startImagePostFromWhatsApp({...message,id:'wamid.robot.0',body:'Artikelsuche Saugroboter'},()=>db,start,send),true);
  assert.equal(calls.length,6);
  assert.equal(await startImagePostFromWhatsApp({...message,id:'wamid.robot.reply',body:'Artikelsuche Saugroboter',replyToMessageId:'wamid.approval'},()=>db,start,send),false);
});

test('standalone natural product-search requests start TrendScout drafts without consuming approval replies', async t => {
  for (const phrase of ['Artikelsuche', 'Artikelsuche!', 'Produktsuche', 'Neue Artikelsuche', 'bitte neue Produktsuche!', 'Starte eine neue Trendsuche', 'Such mir einen neuen Artikel', 'Finde ein neues Produkt', 'Ein neues Produkt suchen']) {
    assert.deepEqual(imagePostCommand(phrase), { product: undefined, invalid: false });
  }
  for (const phrase of ['Ändere den Text für den neuen Artikel', 'Suche für den bestehenden Post ein neues Bild', 'Neue Artikelsuche für das freigegebene Bild']) {
    assert.equal(imagePostCommand(phrase), null);
  }
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(fs.readFileSync('db/migrations/001_memory.sql','utf8'));
  await pg.exec(fs.readFileSync('db/migrations/002_production_gates.sql','utf8'));
  const prior = process.env.WHATSAPP_APPROVER_WA_ID;
  process.env.WHATSAPP_APPROVER_WA_ID = '491234';
  t.after(() => { if (prior === undefined) delete process.env.WHATSAPP_APPROVER_WA_ID; else process.env.WHATSAPP_APPROVER_WA_ID = prior; });
  const calls = [];
  const start = async (...args) => { calls.push(args); return { status:'awaiting_approval', jobId:'new-job', whatsapp:'approval_sent' }; };
  const message = { id:'wamid.search.1', from:'491234',body:'Neue Artikelsuche',replyToMessageId:null,payload:{} };
  const db = { query: (sql,values) => pg.query(sql,values) };
  await db.query('INSERT INTO whatsapp_events(message_id,wa_id,reply_to_message_id,body,payload) VALUES($1,$2,$3,$4,$5)',
    ['wamid.previous.approval','491234','wamid.previous.post','Freigeben','{}']);
  assert.equal(await startImagePostFromWhatsApp(message,()=>db,start,async()=>''),true);
  assert.equal(await startImagePostFromWhatsApp(message,()=>db,start,async()=>''),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0][2],undefined);
  const standalone={...message,id:'wamid.after.story',body:'Artikelsuche'};
  assert.equal(await startImagePostFromWhatsApp(standalone,()=>db,start,async()=>''),true);
  assert.equal(await startImagePostFromWhatsApp(standalone,()=>db,start,async()=>''),true);
  assert.equal(calls.length,2);
  assert.notEqual(calls[0][1],calls[1][1]);
  assert.equal(calls[1][2],undefined);
  assert.equal(calls[1][3],undefined);
  assert.equal(await startImagePostFromWhatsApp({...message,id:'wamid.search.reply',replyToMessageId:'wamid.approval'},()=>db,start,async()=>''),false);
  assert.equal(await startImagePostFromWhatsApp({...standalone,id:'wamid.story.reply',replyToMessageId:'wamid.previous.story'},()=>db,start,async()=>''),false);
  assert.equal(calls.length,2);
});

test('failed generic searches report the actual stage without retrying a paid draft',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(fs.readFileSync('db/migrations/001_memory.sql','utf8'));
  await pg.exec(fs.readFileSync('db/migrations/002_production_gates.sql','utf8'));
  const prior=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(prior===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=prior;});
  const notices=[];let starts=0;
  const db={query:(sql,args)=>pg.query(sql,args)};
  const message={id:'wamid.model.error',from:'491234',body:'Artikelsuche',replyToMessageId:null,payload:{}};
  const start=async()=>{starts++;return {status:'needs_input',jobId:'blocked',reason:'editorial_model_failed'};};
  const send=async text=>{notices.push(text);return 'sent';};
  assert.equal(await startImagePostFromWhatsApp(message,()=>db,start,send),true);
  assert.equal(await startImagePostFromWhatsApp(message,()=>db,start,send),true);
  assert.equal(starts,1);assert.equal(notices.length,1);
  assert.match(notices[0],/redaktionelle Sprachmodell/i);
  assert.doesNotMatch(notices[0],/ASIN prüfen/i);
  assert.match(notices[0],/nichts veröffentlicht/);
  await startImagePostFromWhatsApp({...message,id:'wamid.product.error'},()=>db,
    async()=>({status:'needs_input',jobId:'no-product',reason:'product_unresolved'}),send);
  assert.match(notices[1],/Produktseite sicher verifizieren/i);
  await startImagePostFromWhatsApp({...message,id:'wamid.rate.error'},()=>db,
    async()=>({status:'needs_input',jobId:'rate-limited',reason:'editorial_rate_limited'}),send);
  assert.match(notices[2],/gedrosselt/i);
  assert.doesNotMatch(notices[2],/Guthaben prüfen|ASIN prüfen/i);
  await startImagePostFromWhatsApp({...message,id:'wamid.review.error'},()=>db,
    async()=>({status:'needs_input',jobId:'reviewed',reason:'content_review_failed',reviewIssues:['Werkzeug passt nicht zur Anwendung.']}),send);
  assert.match(notices[3],/Werkzeug passt nicht zur Anwendung/);
  assert.match(notices[3],/Artikelsuche/);
});
