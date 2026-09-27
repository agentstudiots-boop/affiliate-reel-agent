const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { imagePostCommand, startImagePostFromWhatsApp } = require('../.test-build/lib/whatsapp/start-image-post');

test('WhatsApp starts each explicit image post once, while replies stay with their approval', async t => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(fs.readFileSync('db/migrations/001_memory.sql','utf8'));
  await pg.exec(fs.readFileSync('db/migrations/002_production_gates.sql','utf8'));
  const db = { query: (q,v) => pg.query(q,v) };
  const prior = process.env.WHATSAPP_APPROVER_WA_ID;
  process.env.WHATSAPP_APPROVER_WA_ID = '491234';
  t.after(() => { if (prior === undefined) delete process.env.WHATSAPP_APPROVER_WA_ID; else process.env.WHATSAPP_APPROVER_WA_ID = prior; });
  const calls = [], messages = [];
  const start = async (day, slot, product) => { calls.push({day,slot,product}); return {status:'awaiting_approval',jobId:'new-job',whatsapp:'approval_sent'}; };
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
});

test('standalone natural product-search requests start TrendScout drafts without consuming approval replies', async t => {
  for (const phrase of ['Neue Artikelsuche', 'bitte neue Produktsuche!', 'Starte eine neue Trendsuche', 'Such mir einen neuen Artikel', 'Finde ein neues Produkt', 'Ein neues Produkt suchen']) {
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
  assert.equal(await startImagePostFromWhatsApp(message,()=>db,start,async()=>''),true);
  assert.equal(await startImagePostFromWhatsApp(message,()=>db,start,async()=>''),true);
  assert.equal(calls.length,1);
  assert.equal(calls[0][2],undefined);
  assert.equal(await startImagePostFromWhatsApp({...message,id:'wamid.search.reply',replyToMessageId:'wamid.approval'},()=>db,start,async()=>''),false);
  assert.equal(calls.length,1);
});
