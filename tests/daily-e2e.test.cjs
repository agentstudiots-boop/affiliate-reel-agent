const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const loadRoute=require('./helpers/load-route.cjs');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {latestImagePostsStatus}=require('../.test-build/lib/reporting/whatsapp-status');

const SECRET='s'.repeat(24);
const signals={demonstrable:true,beforeAfter:true,wow:false,fun:true,impulse:true,gift:false,aesthetic:false,broadAppeal:true};
const opportunity=(over={})=>({kind:'product_opportunity',title:'Pizza mit der Schere',productIdea:'Pizzaschere',chanceType:'fun_impulse',contentChance:'Pizza wird mit der Schere geschnitten: Hingucker am Tisch',
  hook:'Pizza mit der Schere statt dem Rollrädchen schneiden – ein Hingucker am Tisch',rationale:'Sichtbarer Effekt, den man anderen zeigen möchte',targetNeed:'Abwechslung beim Essen',formatSuggestion:'image',visualPotential:'high',entertainmentPotential:'high',
  signals,shareReason:'Man zeigt es Freunden',trustRationale:'Nur gezeigte Anwendung, keine Versprechen',reachRationale:'Sofort verständlich',timing:{season:null,relevance:'none'},novelty:'high',similarityNote:'Kein ähnliches Produkt kürzlich',
  concept:'pizza-scissors',group:null,confidence:80,evidenceUrls:['https://example.org/gadgets'],priority:1,...over});

// Whole chain with the real code: cron route → daily draft → scout → trend discovery → real model client → Amazon check → content → approval → WhatsApp.
async function world(t,{modelOutput,modelStatus=200,tavily=true,whatsappWindow=true,corrections=false}={}){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const env={CRON_SECRET:SECRET,WHATSAPP_APPROVER_WA_ID:'491234',REPLICATE_API_TOKEN:'r8_test',TAVILY_API_KEY:'tvly-test'};
  const old={};for(const [k,v] of Object.entries(env)){old[k]=process.env[k];process.env[k]=v;}
  t.after(()=>{for(const [k,v] of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  if(whatsappWindow)await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.1','491234','changes_requested','{}')");
  if(corrections){   // an approved operator correction makes scheduled content jobs run in AI mode
    await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.corr','491234','changes_requested','{}'),('conf.corr','491234','approve','{}')");
    await pg.query("INSERT INTO products(id,name,source_url) VALUES('pc','Alt','https://www.amazon.de/dp/B000000999')");
    const old=crypto.randomUUID();
    await pg.query("INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at) VALUES($1,'pc','general','x','education','facebook','','{}','approved','{}',now()-interval '30 days',now())",[old]);
    await pg.query("INSERT INTO operator_language_examples(operator_wa_id,source_message_id,confirmation_message_id,operator_message,interpreted_intent,structured_instruction,product_context,content_id) VALUES('491234','in.corr','conf.corr','Bitte das Motiv ruhiger gestalten','revise_image','{}','{}',$1)",[old]);
  }
  const calls={replicate:0,tavily:0,messages:[],lookups:[]};
  t.mock.method(globalThis,'fetch',async(url)=>{
    const u=String(url);
    if(u.startsWith('https://api.tavily.com')){calls.tavily++;if(!tavily)throw new Error('Tavily down');
      return Response.json({results:[{title:'Gadgets, die alle teilen',url:'https://example.org/gadgets',content:'Ungewöhnliche Küchengadgets gehen viral.',score:0.9}]});}
    if(u.includes('api.replicate.com/v1/models')){calls.replicate++;
      if(modelStatus!==200)return new Response('err',{status:modelStatus});
      const text=typeof modelOutput==='function'?modelOutput():modelOutput;
      return Response.json({id:'abcdefghijklmnop',status:'succeeded',output:[text]});}
    throw new Error(`Unexpected network access: ${u}`);
  });
  const product=name=>({name,productVerifiedName:name,productVerifiedAt:'2026-10-03T07:00:00.000Z',asin:'B000000031',sourceUrl:'https://www.amazon.de/dp/B000000031',affiliateUrl:'https://www.amazon.de/dp/B000000031?tag=alltaeglichle-21',trackingId:'alltaeglichle-21',productUrl:'https://www.amazon.de/dp/B000000031',price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''});
  const productScout=loadRoute('lib/agents/product-scout.ts',{'@/lib/tavily':require('../.test-build/lib/tavily'),'@/lib/agents/content-chances':require('../.test-build/lib/agents/content-chances')});
  const orchestrator=loadRoute('lib/orchestrator.ts',{
    '@/lib/agents/product-scout':productScout,
    '@/lib/product-resolver':{findAmazonProduct:async(name)=>{calls.lookups.push(name);return product(name);}},
    '@/lib/memory/db':{getDatabase:()=>db},'@/lib/agents/product-reviewer':{},'@/lib/agents/script-writer':{},'@/lib/content/orchestrator':{},
    '@/lib/tavily':require('../.test-build/lib/tavily'),'@/lib/content/model':require('../.test-build/lib/content/model'),
  });
  const wa={WhatsAppRejectedError:class extends Error{},sendWhatsAppText:async b=>{calls.messages.push(b);return `wamid.${calls.messages.length}`;},dailyNotificationTemplateConfigured:()=>false,sendDailyNotificationTemplate:async()=>{throw Error('no template');}};
  const draft=loadRoute('lib/daily/draft.ts',{'@/lib/orchestrator':{runContentJob,runProductScout:orchestrator.runProductScout},'@/lib/memory/db':{getDatabase:()=>db},'@/lib/whatsapp/client':wa});
  const route=loadRoute('app/api/cron/daily-draft/route.ts',{'@/lib/daily/draft':draft,'@/lib/daily/slots':require('../.test-build/lib/daily/slots')});
  let timers=false;
  const cron=async iso=>{if(timers)t.mock.timers.setTime(new Date(iso).getTime());else{t.mock.timers.enable({apis:['Date'],now:new Date(iso)});timers=true;}
    return route.GET(new Request('https://x.test/api/cron/daily-draft',{headers:{authorization:`Bearer ${SECRET}`}}));};
  return {pg,db,calls,cron};
}
const logs=t=>{const lines=[];t.mock.method(console,'info',l=>lines.push(String(l)));t.mock.method(console,'warn',l=>lines.push(String(l)));t.mock.method(console,'error',l=>lines.push(String(l)));
  return name=>lines.map(l=>{try{return JSON.parse(l);}catch{return {};}}).filter(e=>e.event===name);};

test('E2E: cron → orchestrator → trend agent (real model client, fenced JSON) → product → content → approval → WhatsApp',async t=>{
  const events=logs(t);
  const w=await world(t,{modelOutput:()=>'```json\n'+JSON.stringify({summary:'Eine starke Chance',opportunities:[opportunity()],noGoodCandidate:false,rejectedIdeas:[]})+'\n```'});
  const response=await w.cron('2026-10-03T07:30:00Z');   // 09:30 Berlin, morning window
  const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.status,'awaiting_approval');assert.equal(body.whatsapp,'approval_sent');
  assert.deepEqual([w.calls.tavily,w.calls.replicate],[4,1],'4 research queries, one model call');
  assert.deepEqual(w.calls.lookups,['Pizzaschere']);
  assert.equal(w.calls.messages.length,1);assert.match(w.calls.messages[0],/Pizzaschere/);assert.match(w.calls.messages[0],/B000000031/);assert.match(w.calls.messages[0],/tag=alltaeglichle-21/);
  const job=(await w.pg.query('SELECT opportunity,status FROM content_jobs')).rows[0];
  assert.equal(job.opportunity.contentChance.agent.source,'trend_agent');assert.equal(job.opportunity.contentChance.agent.evidence[0].url,'https://example.org/gadgets');
  const trend=events('trend_discovery')[0];assert.deepEqual([trend.source,trend.outcome],['trend_agent','success']);
  assert.ok(events('daily_cron_invocation').length>=1&&events('daily_slot_claim').length>=1&&events('daily_slot_whatsapp')[0].slotCompleted===true);
  // A second cron call in the same window changes nothing.
  assert.equal((await (await w.cron('2026-10-03T08:10:00Z')).json()).status,'already_claimed');
  assert.equal(w.calls.replicate,1);assert.equal(w.calls.messages.length,1);
  const status=await latestImagePostsStatus(w.db);
  assert.match(status,/Vormittag/);assert.match(status,/Trend-Agent: ok/);
});

test('E2E: agent failure modes (timeout/HTTP error/garbage/no candidate) never block the slot silently',async t=>{
  for(const [label,opts,expectOutcome] of [
    ['HTTP 500',{modelStatus:500},'failed'],
    ['invalid JSON',{modelOutput:'das ist kein json'},'failed'],
    ['schema mismatch',{modelOutput:JSON.stringify({summary:'x'})},'failed'],
    ['no candidate',{modelOutput:JSON.stringify({summary:'nichts',opportunities:[],noGoodCandidate:true,rejectedIdeas:[{idea:'Messbecher',reason:'Kein Hook'}]})},'no_candidate'],
    ['research down',{tavily:false,modelOutput:'{}'},'research_unavailable'],
  ]){
    await t.test(label,async t=>{
      const events=logs(t);const w=await world(t,opts);
      const response=await w.cron('2026-10-03T07:30:00Z');
      assert.equal(response.status,200,label);
      const trend=events('trend_discovery')[0];assert.equal(trend.outcome,expectOutcome,label);
      const slot=(await w.pg.query("SELECT status FROM daily_drafts WHERE slot='morning'")).rows[0];
      assert.ok(slot,'the slot is always recorded');
      if(expectOutcome==='no_candidate'){
        // Kein Post statt schwachem Post – aber nicht still: der Betreiber bekommt eine klare Meldung.
        assert.equal(slot.status,'needs_input');assert.equal(w.calls.lookups.length,0);
        assert.equal(w.calls.messages.length,1);assert.match(w.calls.messages[0],/Vormittag-Slot gibt es gerade keinen Vorschlag/);assert.match(w.calls.messages[0],/Content-Potenzial/);
        assert.ok(!/https?:/.test(w.calls.messages[0]));
        assert.equal((await w.pg.query('SELECT count(*)::int AS n FROM content_jobs')).rows[0].n,0);
      } else {
        // Fallback to the seed ideas with the same quality gate: a proposal is still produced.
        assert.equal(trend.source,'seed_fallback');assert.equal(slot.status,'awaiting_approval',label);
        assert.equal(w.calls.messages.length,1);assert.match(w.calls.messages[0],/Inhalt|Content|Beitragstext/i);
      }
    });
  }
});

test('E2E: a slot that ends without a proposal tells the operator once',async t=>{
  logs(t);
  const w=await world(t,{modelOutput:JSON.stringify({summary:'n',opportunities:[],noGoodCandidate:true,rejectedIdeas:[]})});
  await w.cron('2026-10-03T07:30:00Z');await w.cron('2026-10-03T08:30:00Z');
  assert.equal(w.calls.messages.length,1,'exactly one notice per slot');
  assert.equal((await w.pg.query("SELECT feedback FROM daily_drafts WHERE slot='morning'")).rows[0].feedback,'slot_notice_sent');
});

test('E2E: with a closed 24 h window the missing proposal is recorded and visible in Status instead of silently lost',async t=>{
  const events=logs(t);
  const closed=await world(t,{modelOutput:JSON.stringify({summary:'n',opportunities:[],noGoodCandidate:true,rejectedIdeas:[]}),whatsappWindow:false});
  await closed.cron('2026-10-03T07:30:00Z');
  assert.equal(closed.calls.messages.length,0);
  assert.ok(events('daily_slot_notice').some(e=>e.notice==='window_closed'),'logged, not silent');
  assert.match(await latestImagePostsStatus(closed.db),/kein Kandidat mit ausreichender Content-Chance/);
});

test('E2E: a draft saved while the WhatsApp window is closed is reported by Status as not delivered; a missing cron run is reported too',async t=>{
  logs(t);
  const w=await world(t,{modelOutput:JSON.stringify({summary:'ok',opportunities:[opportunity()],noGoodCandidate:false,rejectedIdeas:[]}),whatsappWindow:false});
  const body=await (await w.cron('2026-10-03T07:30:00Z')).json();
  assert.deepEqual([body.status,body.whatsapp],['awaiting_approval','template_required']);
  assert.equal(w.calls.messages.length,0);
  const status=await latestImagePostsStatus(w.db);
  assert.match(status,/noch nicht zugestellt/);
  t.mock.timers.setTime(new Date('2026-10-03T16:30:00Z').getTime());   // 18:30 Berlin, afternoon slot never ran
  assert.match(await latestImagePostsStatus(w.db),/Heute Nachmittag: kein Lauf registriert/);
});

test('E2E: if the model-written (AI mode) draft fails, the next invocation of the slot produces the reference draft instead of repeating the failure',async t=>{
  const events=logs(t);
  const w=await world(t,{modelStatus:500,corrections:true});
  const first=await (await w.cron('2026-10-03T07:30:00Z')).json();
  assert.equal(first.status,'needs_input');assert.equal(first.reason,'editorial_model_failed');
  assert.equal(w.calls.messages.length,0,'first, possibly transient failure: no notice yet, a retry follows');
  const second=await (await w.cron('2026-10-03T08:30:00Z')).json();
  assert.deepEqual([second.status,second.whatsapp],['awaiting_approval','approval_sent'],JSON.stringify(second));
  assert.equal(w.calls.messages.length,1);assert.match(w.calls.messages[0],/Beitragstext/);
  assert.ok(events('daily_slot_stage').some(e=>e.stage==='reference_mode_after_failed_attempt'));
  assert.equal((await w.pg.query("SELECT attempts,status FROM daily_drafts WHERE slot='morning'")).rows[0].status,'awaiting_approval');
});
