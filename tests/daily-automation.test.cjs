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
  assert.equal(first.status,'awaiting_approval');assert.equal(first.whatsapp,'template_required');
  assert.equal(messages.length,0);
  const duplicate=await daily.createDailyDraft('2026-09-24');
  assert.equal(duplicate.status,'already_claimed');assert.equal(scouts,1);
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('inbound.test','491234','changes_requested','{}')");
  const next=await daily.createDailyDraft('2026-09-25');
  assert.equal(next.status,'awaiting_approval');assert.equal(next.whatsapp,'approval_sent');
  assert.equal(scouts,2);assert.equal(messages.length,1);
  assert.match(messages[0],/Content-Freigabe/);
  const saved=await pg.query("SELECT status,whatsapp_message_id FROM daily_drafts WHERE day='2026-09-25'");
  assert.equal(saved.rows[0].status,'awaiting_approval');
  assert.equal(saved.rows[0].whatsapp_message_id,'wamid.mock.1');
  assert.equal((await daily.createDailyDraft('2026-09-25')).status,'already_claimed');
  assert.equal(messages.length,1);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
});
