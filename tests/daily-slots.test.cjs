const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const loadRoute=require('./helpers/load-route.cjs');
const {resolveSlot}=require('../.test-build/lib/daily/slots');

const at=iso=>resolveSlot(new Date(iso));
const schedules=()=>JSON.parse(fs.readFileSync('vercel.json','utf8')).crons.filter(c=>c.path==='/api/cron/daily-draft').map(c=>c.schedule);

test('slots are local windows: start, middle and late invocations map to the same (day, slot)',()=>{
  // CEST (UTC+2): 07:00 UTC = 09:00 local
  for(const iso of ['2026-10-01T07:00:00Z','2026-10-01T07:03:00Z','2026-10-01T07:59:59Z','2026-10-01T10:30:00Z'])assert.deepEqual([at(iso).slot,at(iso).day],['morning','2026-10-01'],iso);
  for(const iso of ['2026-10-01T16:00:00Z','2026-10-01T16:41:00Z','2026-10-01T20:59:00Z'])assert.deepEqual([at(iso).slot,at(iso).day],['afternoon','2026-10-01'],iso);
  // A cron that arrives minutes late still hits its window; the gap between the windows is explicit.
  assert.equal(at('2026-10-01T08:03:00Z').slot,'morning');
  assert.equal(at('2026-10-01T12:00:00Z').slot,null);
  assert.equal(at('2026-10-01T05:59:00Z').slot,null);
  assert.equal(at('2026-10-01T21:00:00Z').slot,null);
  const late=at('2026-10-01T08:03:00Z');
  assert.equal(late.localTime,'10:03');assert.equal(late.timeZone,'Europe/Berlin');
});

test('UTC ↔ Europe/Berlin including both daylight-saving changes and the day boundary',()=>{
  assert.equal(at('2026-10-24T16:30:00Z').localTime,'18:30');   // CEST
  assert.equal(at('2026-10-25T16:30:00Z').localTime,'17:30');   // CET after the change at 01:00 UTC
  assert.equal(at('2026-10-25T17:30:00Z').slot,'afternoon');
  assert.equal(at('2026-10-25T16:30:00Z').slot,null);
  assert.equal(at('2026-03-28T08:00:00Z').localTime,'09:00');   // CET before the change
  assert.equal(at('2026-03-29T07:00:00Z').localTime,'09:00');   // CEST after the change at 01:00 UTC
  assert.equal(at('2026-03-29T07:00:00Z').slot,'morning');
  // The day is the Berlin day, not the UTC day.
  const night=at('2026-10-01T22:30:00Z');assert.deepEqual([night.day,night.slot],['2026-10-02',null]);
  const evening=at('2026-10-01T20:59:00Z');assert.deepEqual([evening.day,evening.slot,evening.localTime],['2026-10-01','afternoon','22:59']);
  assert.equal(at('2026-12-31T23:30:00Z').day,'2027-01-01');
});

test('every day of the year has at least two scheduled invocations per slot, wherever in its UTC hour Vercel runs them',()=>{
  const hours=schedules().map(s=>Number(s.split(' ')[1]));
  assert.deepEqual(hours,[7,8,9,16,17,18]);
  for(let d=0;d<366;d++){
    const day=new Date(Date.UTC(2026,0,1+d));
    for(const minute of [0,1,30,59]){
      const counts={morning:0,afternoon:0};
      for(const hour of hours){
        const r=resolveSlot(new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),hour,minute)));
        if(r.slot)counts[r.slot]++;
        assert.ok(!r.slot||r.day.length===10);
      }
      assert.ok(counts.morning>=2&&counts.afternoon>=2,`${day.toISOString().slice(0,10)} :${minute} ${JSON.stringify(counts)}`);
    }
  }
});

test('the cron route derives day and slot from one instant, logs the invocation and never starts outside a window',async t=>{
  const calls=[];const logs=[];
  t.mock.method(console,'info',line=>logs.push(String(line)));t.mock.method(console,'warn',line=>logs.push(String(line)));
  process.env.CRON_SECRET='s'.repeat(24);t.after(()=>{delete process.env.CRON_SECRET;});
  const route=loadRoute('app/api/cron/daily-draft/route.ts',{'@/lib/daily/draft':{createDailyDraft:async(day,slot)=>{calls.push([day,slot]);return {status:'already_claimed'};}}});
  const req=headers=>new Request('https://x.test/api/cron/daily-draft',{headers});
  const auth={authorization:`Bearer ${'s'.repeat(24)}`};
  t.mock.timers.enable({apis:['Date'],now:new Date('2026-10-01T08:03:00Z')});
  assert.equal((await route.GET(req(auth))).status,200);
  assert.deepEqual(calls,[['2026-10-01','morning']]);
  t.mock.timers.setTime(new Date('2026-10-01T12:30:00Z').getTime());
  assert.deepEqual(await (await route.GET(req(auth))).json(),{status:'outside_berlin_slot'});
  assert.equal(calls.length,1);
  t.mock.timers.setTime(new Date('2026-10-01T17:01:00Z').getTime());
  await route.GET(req(auth));
  assert.deepEqual(calls.at(-1),['2026-10-01','afternoon']);
  assert.equal((await route.GET(req({authorization:'Bearer wrong'}))).status,401);
  const events=logs.map(l=>JSON.parse(l));
  const first=events.find(e=>e.event==='daily_cron_invocation');
  assert.deepEqual([first.timeZone,first.localDay,first.localTime,first.slot,first.utc],['Europe/Berlin','2026-10-01','10:03','morning','2026-10-01T08:03:00.000Z']);
  assert.ok(events.some(e=>e.event==='daily_cron_outside_window'));
  assert.ok(events.some(e=>e.event==='daily_cron_unauthorized'&&!JSON.stringify(e).includes('ssss')));
});

class Rejected extends Error{}
async function fixture(t){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const old=process.env.WHATSAPP_APPROVER_WA_ID;process.env.WHATSAPP_APPROVER_WA_ID='491234';
  t.after(()=>{if(old===undefined)delete process.env.WHATSAPP_APPROVER_WA_ID;else process.env.WHATSAPP_APPROVER_WA_ID=old;});
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.1','491234','changes_requested','{}')");
  const names=['Kuscheldecke Fleece','Edelstahl Küchenreibe','Silikon Backmatte','Bambus Schneidebrett','Glas Vorratsdosen Set','Gewürzregal Edelstahl'];
  const products=[0,1,2,3,4,5].map(i=>({name:names[i],productVerifiedName:names[i],productVerifiedAt:'2026-09-26T08:00:00.000Z',sourceUrl:`https://www.amazon.de/dp/B00000000${i}`,affiliateUrl:`https://www.amazon.de/dp/B00000000${i}?tag=alltaeglichle-21`,price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''}));
  const state={scouts:0,failScout:0,sendError:null,messages:[],delay:0,logs:[]};
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runContentJob:require('../.test-build/lib/content/orchestrator').runContentJob,
      runProductScout:async(search)=>{const n=state.scouts++;if(state.delay)await new Promise(r=>setTimeout(r,state.delay));if(state.failScout-->0)throw Error('Amazon unavailable https://secret.example/?token=abc');
        return {candidates:[{resolvedProduct:products[n%products.length],kind:'Saisontrend',name:products[n%products.length].name,searchQuery:search,category:'Wohnen',reelIdea:'Das Produkt im Alltag verwenden und die Eignung vor dem Kauf prüfen.',whyNow:'Herbst'}]};}},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/whatsapp/client':{WhatsAppRejectedError:Rejected,sendWhatsAppText:async body=>{if(state.sendError)throw state.sendError;state.messages.push(body);return `wamid.${state.messages.length}`;},
      dailyNotificationTemplateConfigured:()=>false,sendDailyNotificationTemplate:async()=>{throw Error('no template');}},
  });
  const sink=t.mock.method(console,'info',line=>state.logs.push(String(line)));t.mock.method(console,'error',line=>state.logs.push(String(line)));void sink;
  const events=name=>state.logs.map(l=>{try{return JSON.parse(l);}catch{return {};}}).filter(e=>e.event===name);
  return {pg,db,daily,state,events};
}
const slotRow=async(pg,day,slot)=>(await pg.query('SELECT status,attempts,whatsapp_message_id FROM daily_drafts WHERE day=$1 AND slot=$2',[day,slot])).rows[0];

test('duplicate and parallel invocations in the same slot create exactly one job and one approval',async t=>{
  const f=await fixture(t);f.state.delay=30;
  const results=await Promise.all([1,2,3,4].map(()=>f.daily.createDailyDraft('2026-10-01','morning')));
  assert.equal(results.filter(r=>r.status==='awaiting_approval').length,1,JSON.stringify(results));
  assert.equal(results.filter(r=>r.status==='already_claimed').length,3);
  assert.equal(f.state.scouts,1);assert.equal(f.state.messages.length,1);
  assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM daily_drafts")).rows[0].n,1);
  assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM content_jobs")).rows[0].n,1);
  // A later (late/duplicate) cron call on the finished slot does nothing.
  const again=await f.daily.createDailyDraft('2026-10-01','morning');
  assert.equal(again.status,'already_claimed');assert.equal(f.state.scouts,1);assert.equal(f.state.messages.length,1);
  const states=f.events('daily_slot_claim');
  assert.ok(states.some(e=>e.claim==='accepted'));assert.ok(states.some(e=>e.claim==='rejected'&&e.slotState==='in_progress'));
  assert.ok(states.some(e=>e.claim==='rejected'&&e.slotState==='done'));
  const sent=f.events('daily_slot_whatsapp');assert.equal(sent.length,1);assert.deepEqual([sent[0].whatsapp,sent[0].slotCompleted],['approval_sent',true]);
  assert.ok(['product_found','content_planning','draft_saved','whatsapp_send'].every(stage=>f.events('daily_slot_stage').some(e=>e.stage===stage)));
});

test('a failure before the draft exists leaves the slot open; the next invocation in the window retries it and logs step and cause',async t=>{
  const f=await fixture(t);f.state.failScout=1;
  const first=await f.daily.createDailyDraft('2026-10-01','afternoon');
  assert.equal(first.status,'failed');
  assert.deepEqual(await slotRow(f.pg,'2026-10-01','afternoon'),{status:'failed',attempts:1,whatsapp_message_id:null});
  const failure=f.events('daily_draft_failed')[0];
  assert.equal(failure.stage,'product_search');assert.match(failure.reason,/Amazon unavailable <url>/);assert.ok(!JSON.stringify(failure).includes('secret.example'));
  const second=await f.daily.createDailyDraft('2026-10-01','afternoon');
  assert.equal(second.status,'awaiting_approval');assert.equal(second.whatsapp,'approval_sent');
  assert.equal((await slotRow(f.pg,'2026-10-01','afternoon')).attempts,2);assert.equal(f.state.messages.length,1);
  assert.ok(f.events('daily_slot_claim').some(e=>e.claim==='reclaimed'));
});

test('a WhatsApp failure after the draft was saved keeps one draft: no second job, the saved draft is not lost',async t=>{
  const f=await fixture(t);f.state.sendError=new Error('socket hang up');
  const first=await f.daily.createDailyDraft('2026-10-01','morning');
  assert.deepEqual([first.status,first.whatsapp],['awaiting_approval','approval_send_failed']);
  assert.equal(f.events('daily_draft_failed')[0].stage,'whatsapp_send');
  f.state.sendError=null;
  assert.equal((await f.daily.createDailyDraft('2026-10-01','morning')).status,'already_claimed');
  assert.equal(f.state.scouts,1);assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM content_jobs')).rows[0].n,1);
  assert.equal((await slotRow(f.pg,'2026-10-01','morning')).status,'awaiting_approval');
});

test('a definite WhatsApp rejection is retried by the next invocation without planning a second draft',async t=>{
  const f=await fixture(t);f.state.sendError=new Rejected('rejected');
  const first=await f.daily.createDailyDraft('2026-10-01','morning');
  assert.equal(first.whatsapp,'approval_send_failed');
  f.state.sendError=null;
  const retry=await f.daily.createDailyDraft('2026-10-01','morning');
  assert.equal(retry.status,'already_claimed');assert.equal(retry.whatsapp,'approval_sent');
  assert.equal(f.state.scouts,1);assert.equal(f.state.messages.length,1);assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM content_jobs')).rows[0].n,1);
});

test('morning and afternoon of the same day, and the next day, are independent slots',async t=>{
  const f=await fixture(t);
  f.state.failScout=1; // the morning attempt fails and must not affect the afternoon
  assert.equal((await f.daily.createDailyDraft('2026-10-01','morning')).status,'failed');
  assert.equal((await f.daily.createDailyDraft('2026-10-01','afternoon')).status,'awaiting_approval');
  assert.equal((await f.daily.createDailyDraft('2026-10-01','morning')).status,'awaiting_approval');
  assert.equal((await f.daily.createDailyDraft('2026-10-02','morning')).status,'awaiting_approval');
  const rows=(await f.pg.query("SELECT day::text AS day,slot,status FROM daily_drafts ORDER BY day,slot")).rows;
  assert.equal(rows.length,3);assert.ok(rows.every(r=>r.status==='awaiting_approval'));
  assert.equal(f.state.messages.length,3);
});

test('an exhausted slot is reported instead of disappearing silently',async t=>{
  const f=await fixture(t);
  await f.pg.query("INSERT INTO daily_drafts(day,slot,job_id,status,attempts) VALUES('2026-10-01','morning',gen_random_uuid(),'failed',3)");
  assert.equal((await f.daily.createDailyDraft('2026-10-01','morning')).status,'already_claimed');
  assert.equal(f.events('daily_slot_exhausted').length,1);
});

test('the weekly report runs next to the daily automation without touching or blocking slots',async t=>{
  const f=await fixture(t);const weeklyMessages=[];
  const weekly=loadRoute('lib/reporting/weekly.ts',{
    '../memory/db':{getDatabase:()=>f.db},
    '../meta/connection':{cachedMetaConnection:async()=>({resolved:false}),metaConfig:()=>({})},
    '../whatsapp/client':{sendWhatsAppText:async body=>{weeklyMessages.push(body);return `wamid.weekly.${weeklyMessages.length}`;},sendWeeklyNotificationTemplate:async()=>'wamid.wt',weeklyNotificationTemplateConfigured:()=>false},
  });
  f.state.delay=20;
  const [daily,report,morning]=await Promise.all([
    f.daily.createDailyDraft('2026-10-05','morning'),
    weekly.createWeeklyReport(new Date('2026-10-05T08:15:00Z'),f.db),
    f.daily.createDailyDraft('2026-10-05','afternoon'),
  ]);
  assert.equal(daily.status,'awaiting_approval');assert.equal(morning.status,'awaiting_approval');assert.ok(report.weekStart);
  assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM daily_drafts WHERE day='2026-10-05'")).rows[0].n,2);
  assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM weekly_reports")).rows[0].n,1);
  assert.equal(f.state.messages.length,2);
});

const manualHarness=(f)=>{
  const sent=[];
  const search=require('../.test-build/lib/whatsapp/start-image-post');
  const msg=(id,body)=>({id,from:'491234',body,replyToMessageId:null,payload:{}});
  return {sent,run:(id,term)=>search.startProductSearch(msg(id,`Artikelsuche ${term}`),{search:term},f.db,f.daily.createDailyDraft,async text=>{sent.push(text);return 'wamid.s';})};
};
const berlinToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin'}).format(new Date());

test('a manual „Artikelsuche“ never claims or consumes a scheduled slot: the daily run in the same window still happens exactly once',async t=>{
  const f=await fixture(t);const h=manualHarness(f);const today=berlinToday();
  await h.run('wamid.in.manual1','Silpat Backmatte');
  assert.equal(f.state.messages.length,1);
  const manual=(await f.pg.query("SELECT slot,status FROM daily_drafts")).rows;
  assert.equal(manual.length,1);assert.match(manual[0].slot,/^manual:/);
  assert.equal(manual.filter(r=>r.slot==='morning'||r.slot==='afternoon').length,0,'no scheduled slot was claimed');
  // The scheduled cron of the same window arrives afterwards.
  const daily=await f.daily.createDailyDraft(today,'morning');
  assert.equal(daily.status,'awaiting_approval',JSON.stringify(daily));assert.equal(daily.whatsapp,'approval_sent');
  assert.equal(f.state.messages.length,2);
  // And a duplicate cron call creates nothing more.
  assert.equal((await f.daily.createDailyDraft(today,'morning')).status,'already_claimed');
  assert.equal(f.state.messages.length,2);
  const rows=(await f.pg.query("SELECT slot,status FROM daily_drafts ORDER BY slot")).rows;
  assert.equal(rows.length,2);assert.equal(rows.find(r=>r.slot==='morning').status,'awaiting_approval');
  assert.equal((await f.pg.query("SELECT count(DISTINCT job_id)::int AS n FROM daily_drafts")).rows[0].n,2);
});

test('a manual search while the scheduled slot is running or finished is not blocked by it, and does not change it',async t=>{
  const f=await fixture(t);const h=manualHarness(f);const today=berlinToday();f.state.delay=40;
  const scheduled=f.daily.createDailyDraft(today,'afternoon');
  await new Promise(r=>setTimeout(r,10));
  assert.equal((await slotRow(f.pg,today,'afternoon')).status,'claimed');
  await h.run('wamid.in.manual2','Silpat Backmatte');   // while the slot is still in progress
  assert.equal((await scheduled).status,'awaiting_approval');
  await h.run('wamid.in.manual3','Edelstahl Reibe');    // after the slot finished
  assert.equal(f.state.messages.length,3);
  assert.equal((await slotRow(f.pg,today,'afternoon')).attempts,1);
  assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM daily_drafts WHERE slot LIKE 'manual:%'")).rows[0].n,2);
  assert.equal((await f.daily.createDailyDraft(today,'afternoon')).status,'already_claimed');
  assert.equal(f.state.messages.length,3);
});

test('a failed manual search leaves the scheduled slots untouched and retry-able',async t=>{
  const f=await fixture(t);const h=manualHarness(f);const today=berlinToday();f.state.failScout=1;
  await h.run('wamid.in.manual4','Silpat Backmatte');
  assert.equal((await f.pg.query("SELECT status FROM daily_drafts WHERE slot LIKE 'manual:%'")).rows[0].status,'failed');
  assert.equal((await f.daily.createDailyDraft(today,'morning')).status,'awaiting_approval');
  assert.equal((await f.daily.createDailyDraft(today,'afternoon')).status,'awaiting_approval');
  assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM daily_drafts WHERE slot IN ('morning','afternoon')")).rows[0].n,2);
});
