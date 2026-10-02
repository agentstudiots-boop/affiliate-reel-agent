const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const loadRoute=require('./helpers/load-route.cjs');
const S=require('../.test-build/lib/content/strategy');
const {loadSelectionHistory}=require('../.test-build/lib/content/selection-history');
const {CONTENT_CHANCES,CHANCE_SEEDS}=require('../.test-build/lib/agents/content-chances');

const base={type:'problem_solver',hook:'',concept:'c-default',demonstrable:false,beforeAfter:false,wow:false,fun:false,impulse:false,gift:false,aesthetic:false,broadAppeal:false,seasonalFit:false};
const chance=(over)=>({...base,...over});
const solver=chance({hook:'Verschmierte Glasscheibe vorher, klare Scheibe nachher',concept:'glass',demonstrable:true,beforeAfter:true,broadAppeal:true});
const fun=chance({type:'fun_impulse',hook:'Pizza mit der Schere schneiden: Hingucker, den man jemandem zeigen will',concept:'pizza-scissors',demonstrable:true,fun:true,impulse:true,broadAppeal:true});
const deco=chance({type:'deco_lifestyle',hook:'Sternenhimmel an der Zimmerdecke: Wow-Effekt in Sekunden sichtbar',concept:'stars',demonstrable:true,wow:true,aesthetic:true,impulse:true,gift:true,broadAppeal:true});
const empty=S.emptyHistory;

test('a standard article without a content chance is rejected (mini measuring cup, square grater)',()=>{
  for(const name of ['Mini Messbecher 3er Set','Vierkantreibe Edelstahl','Aufbewahrungsboxen mit Deckel']){
    const a=S.assessContentChance(name,undefined,empty());
    assert.equal(a.passed,false,name);assert.equal(a.score,0);assert.match(a.reasons[0],/Keine belegte Content-Chance/);
  }
  // Even with a category-typical description but no hook / effect / appeal the article does not pass.
  const bland=S.assessContentChance('Messbecher mit Skala',chance({hook:'Abmessen gehört zu vielen Rezepten',demonstrable:true}),empty());
  assert.equal(bland.passed,false);
});

test('a clear problem solver with a demonstrable use case, a fun impulse product and visual deco/lifestyle pass',()=>{
  for(const [name,c] of [['Duschabzieher',solver],['Pizzaschere',fun],['Sternenhimmel Projektor',deco]]){
    const a=S.assessContentChance(name,c,empty());
    assert.equal(a.passed,true,`${name}: ${JSON.stringify(a)}`);assert.ok(a.score>=S.PASS_SCORE);
  }
  // A candle class is not automatically good: without a concrete reason it fails, with one it passes.
  assert.equal(S.assessContentChance('Duftkerze Herbst',chance({type:'deco_lifestyle',hook:'Duftkerze für den Herbst',broadAppeal:true,seasonalFit:true}),empty()).passed,false);
  assert.equal(S.assessContentChance('LED Kerzen flackernd',CONTENT_CHANCES['x']||CHANCE_SEEDS.find(s=>s.name==='LED Kerzen flackernd').chance,empty()).passed,true);
});

test('"seasonal" alone is not a quality criterion',()=>{
  const seasonalOnly=chance({hook:'Passend zur Herbstsaison und gemütlich für kalte Tage',concept:'blanket',broadAppeal:true,seasonalFit:true});
  const a=S.assessContentChance('Wärmende Kuscheldecke',seasonalOnly,empty());
  assert.equal(a.passed,false);assert.ok(a.score<S.PASS_SCORE);
  // Timing reinforces a real chance, it does not create one.
  const withEffect=S.assessContentChance('Halloween LED Kürbis Lichterkette',CHANCE_SEEDS.length?CONTENT_CHANCES['Halloween LED Kürbis Lichterkette']:null,empty());
  assert.equal(withEffect.passed,true);
  const without={...CONTENT_CHANCES['Halloween LED Kürbis Lichterkette'],seasonalFit:false};
  assert.equal(S.assessContentChance('x',without,empty()).score,withEffect.score-5);
});

test('a functionally similar product shortly after a rejection is rated worse; a clearly new and strong use case stays possible',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q)};
  const job=async(name,{draft,jobStatus='awaiting_approval',feedback='',ageDays=0}={})=>{
    const id=crypto.randomUUID();
    await pg.query("INSERT INTO products(id,name,source_url) VALUES($1,$2,'https://www.amazon.de/dp/B000000001')",[id,name]);
    await pg.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at)
      VALUES($1,$5,'general','x','education','facebook','',$2,$3,'{}',now()-make_interval(days=>$4),now())`,[id,JSON.stringify({product:{name,asin:'B000000001'}}),jobStatus,ageDays,id]);
    if(draft)await pg.query("INSERT INTO daily_drafts(day,slot,job_id,status,feedback) VALUES(current_date,$2,$1,$3,$4)",[id,`manual:${id}`,draft,feedback]);
    return id;
  };
  await job('Mini Messbecher 3er Set',{draft:'rejected'});
  await job('Kuscheldecke',{draft:'awaiting_approval'});
  await job('Silikon Backmatte',{draft:'rejected',ageDays:10});      // too old to count
  await job('Gartenhandschuhe',{draft:'needs_input',feedback:'replaced_by_operator'});
  const history=await loadSelectionHistory(db);
  assert.deepEqual(history.rejected.map(r=>r.group).sort(),['garden_basic','kitchen_small_tool']);
  assert.ok(history.recent.some(r=>r.group==='cosy_textile'));

  const similar=chance({type:'fun_impulse',hook:'Vierkantreibe für Käse und Gemüse in einem Zug',concept:'square-grater',demonstrable:true,fun:true,impulse:true,broadAppeal:true});
  const before=S.assessContentChance('Vierkantreibe Edelstahl',similar,empty());
  const after=S.assessContentChance('Vierkantreibe Edelstahl',similar,history);
  assert.equal(before.passed,true);
  assert.equal(after.passed,false);assert.equal(after.score,before.score-30);
  assert.match(after.reasons.join(' '),/ähnliches Produkt wurde kürzlich abgelehnt/);
  // Same area, but a clearly new and strong use case: still allowed.
  const strong=chance({type:'fun_impulse',hook:'Zerpflücken wie ein Bär: ungewöhnliches Werkzeug, bei dem man „Was ist das denn?“ fragt',concept:'shredding-claws',group:'kitchen_small_tool',
    demonstrable:true,wow:true,fun:true,impulse:true,aesthetic:true,gift:true,broadAppeal:true});
  assert.equal(S.assessContentChance('Fleischkrallen',strong,history).passed,true);
  // A different area is not affected at all.
  assert.equal(S.assessContentChance('Duschabzieher',solver,history).score,S.assessContentChance('Duschabzieher',solver,empty()).score);
  // The same content concept within the cooldown is blocked outright.
  const repeated={rejected:[],recent:[{group:null,concept:'glass'}]};
  assert.equal(S.assessContentChance('Duschabzieher',solver,repeated).passed,false);
});

test('the real scout seeds: weak ideas never reach Amazon lookups, strong ideas do, ranked by content chance',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v)}))};
  const productScout=loadRoute('lib/agents/product-scout.ts',{'@/lib/tavily':{tavilySearch:async()=>[{title:'Aktuelle Haushaltstipps im Herbst',score:0.5}],tavilySources:()=>[]},
    '@/lib/agents/content-chances':require('../.test-build/lib/agents/content-chances')});
  const lookups=[];
  const orchestrator=loadRoute('lib/orchestrator.ts',{
    '@/lib/agents/product-scout':productScout,
    '@/lib/product-resolver':{findAmazonProduct:async name=>{lookups.push(name);const asin=`B${String(lookups.length).padStart(9,'0')}`;return {name,asin,sourceUrl:`https://www.amazon.de/dp/${asin}`,affiliateUrl:''};}},
    '@/lib/memory/db':{getDatabase:()=>db},'@/lib/agents/product-reviewer':{},'@/lib/agents/script-writer':{},'@/lib/content/orchestrator':{},
  });
  const report=await orchestrator.runProductScout(undefined,'2026-10-02:morning',{quality:true});
  assert.ok(report.candidates.length>=1&&report.candidates.length<=5);
  assert.ok(report.candidates.every(c=>c.assessment.passed&&c.chance));
  const scores=report.candidates.map(c=>c.assessment.score);assert.deepEqual(scores,[...scores].sort((a,b)=>b-a));
  for(const weak of ['Messbecher mit Skala','Hochwertige Küchenreibe','Wäschekorb mit Griffen','Wärmende Kuscheldecke','Aufbewahrungsboxen mit Deckel'])
    assert.ok(!lookups.includes(weak),`${weak} must not be looked up`);
  assert.ok(report.qualityBlocked>=5);assert.ok(report.qualityRejected.some(r=>r.name==='Messbecher mit Skala'));
  // Operator searches and calls without the flag are not filtered.
  lookups.length=0;
  const unfiltered=await orchestrator.runProductScout(undefined,'2026-10-02:manual:x');
  assert.ok(unfiltered.candidates.some(c=>!('assessment' in c)));assert.equal(unfiltered.qualityBlocked,0);
});

// --- Jarvis gate inside the content orchestrator ----------------------------------------------
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const product={name:'Duschabzieher Edelstahl',productVerifiedName:'Duschabzieher Edelstahl',productVerifiedAt:'2026-09-26T08:00:00.000Z',sourceUrl:'https://www.amazon.de/dp/B000000011',asin:'B000000011',affiliateUrl:'https://www.amazon.de/dp/B000000011?tag=alltaeglichle-21',price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''};
const opportunity=(record)=>({product,category:'household',useCaseKey:'seasonal-product-guide',targetPlatform:'facebook',useCase:'Das Produkt im Alltag verwenden und die Eignung vor dem Kkauf prüfen.',trend:'',goal:'education',budget:'low',verifiedFacts:[],...(record?{contentChance:record}:{})});
const record=(name,c,history)=>({chance:c,assessment:S.assessContentChance(name,c,history||empty())});

test('Jarvis lets a strong candidate through to content planning (reference mode, no model call)',async()=>{
  const job=await runContentJob(opportunity(record('Duschabzieher',solver)),{mode:'reference',allowedFormats:['image']});
  assert.equal(job.status,'awaiting_approval',JSON.stringify(job.review||job.error));
  assert.ok(job.events.some(e=>/Strategic Quality Gate: geeignet/.test(e.message)));
  assert.equal(job.opportunity.contentChance.assessment.passed,true);
});

test('Jarvis rejects a candidate that does not fit reach/trust and produces no content',async()=>{
  const weakRecord=record('Messbecher',chance({hook:'Abmessen gehört zu vielen Rezepten',demonstrable:true}));
  const weak=await runContentJob(opportunity(weakRecord),{mode:'reference',allowedFormats:['image']});
  assert.equal(weak.status,'needs_input');assert.equal(weak.error,S.STRATEGY_REJECTED);assert.equal(weak.content,undefined);assert.equal(weak.ideas,undefined);
  // Trust risk: a strong chance with a health/guarantee promise in the hook is rejected anyway.
  const risky=record('Wundermittel',{...solver,hook:'Heilt Rückenschmerzen garantiert, vorher nachher sichtbar'});
  const rejected=await runContentJob(opportunity(risky),{mode:'reference',allowedFormats:['image']});
  assert.equal(rejected.error,S.STRATEGY_REJECTED);assert.match(rejected.review.issues[0],/Vertrauen/);
  // A model verdict can only tighten the baseline: the deterministic gate accepted, Jarvis (AI mode) rejects.
  const calls=[];
  const generate=async agent=>{calls.push(agent);
    if(agent!=='orchestrator')throw Error(`unexpected agent ${agent}`);
    return {decision:'reject',reason:'Wirkt wie beliebige Affiliate-Werbung ohne eigenen Anlass.',reachPotential:20,trustRisk:false,betterChanceHint:null};};
  const ai=await runContentJob(opportunity(record('Duschabzieher',solver)),{mode:'ai',generate,allowedFormats:['image']});
  assert.equal(ai.error,S.STRATEGY_REJECTED);assert.deepEqual(calls,['orchestrator']);assert.equal(ai.modelCalls,1);assert.match(ai.review.issues[0],/beliebige Affiliate-Werbung/);
});

test('operator-requested products carry no content chance and skip the gate',async()=>{
  const job=await runContentJob(opportunity(null),{mode:'reference',allowedFormats:['image']});
  assert.equal(job.status,'awaiting_approval');assert.ok(!job.events.some(e=>/Strategic Quality Gate/.test(e.message)));
});

// --- Daily slot: no forced content ---------------------------------------------------------
class Rejected extends Error{}
test('no sufficiently good candidate: the scheduled slot sends nothing, creates no job and is not retried',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  process.env.WHATSAPP_APPROVER_WA_ID='491234';t.after(()=>{delete process.env.WHATSAPP_APPROVER_WA_ID;});
  await pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.1','491234','changes_requested','{}')");
  const state={scouts:0,quality:[],messages:[]};
  const daily=loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runContentJob:runContentJob,runProductScout:async(search,key,options)=>{state.scouts++;state.quality.push(options?.quality);
      return {candidates:[],cooldownBlocked:0,cooldownBlockedAutomatic:0,qualityBlocked:6,qualityRejected:[{name:'Messbecher mit Skala',score:0,reason:'x'}]};}},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/whatsapp/client':{WhatsAppRejectedError:Rejected,sendWhatsAppText:async b=>{state.messages.push(b);return 'wamid.1';},dailyNotificationTemplateConfigured:()=>false,sendDailyNotificationTemplate:async()=>{throw Error('x');}},
  });
  const first=await daily.createDailyDraft('2026-10-02','morning');
  assert.deepEqual([first.status,first.reason],['needs_input','no_quality_candidate']);
  assert.deepEqual(state.quality,[true]);assert.equal(state.messages.length,0);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM content_jobs')).rows[0].n,0);
  // The next cron call in the window does not buy a second search for the same, unchanged outcome.
  assert.equal((await daily.createDailyDraft('2026-10-02','morning')).status,'already_claimed');assert.equal(state.scouts,1);
  // The afternoon slot is independent and asks again.
  assert.equal((await daily.createDailyDraft('2026-10-02','afternoon')).reason,'no_quality_candidate');assert.equal(state.scouts,2);
  // An operator-requested search is never held to the gate.
  await daily.createDailyDraft('2026-10-02','manual:abc');assert.equal(state.quality.at(-1),false);
  const row=(await pg.query("SELECT scout_report->>'reason' AS reason FROM daily_drafts WHERE slot='morning'")).rows[0];assert.equal(row.reason,'no_quality_candidate');
});
