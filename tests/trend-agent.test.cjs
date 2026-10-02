const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const loadRoute=require('./helpers/load-route.cjs');
const S=require('../.test-build/lib/content/strategy');
const T=require('../.test-build/lib/content/trend');
const {discoverOpportunities,researchQueries}=require('../.test-build/lib/content/trend-scout');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');

const NOW=new Date('2026-10-02T07:30:00Z');
const evidence=[{title:'Gadgets, die alle teilen',url:'https://example.org/gadgets',content:'Ungewöhnliche Küchengadgets gehen viral.'},
  {title:'Herbstdeko 2026',url:'https://example.org/deko',content:'Lichter und Laternen im Herbst.'}];
const research=async()=>evidence;
const signals=(over={})=>({demonstrable:false,beforeAfter:false,wow:false,fun:false,impulse:false,gift:false,aesthetic:false,broadAppeal:false,...over});
const opp=(over={})=>({kind:'product_opportunity',title:'Spaghetti-Messer Hingucker',productIdea:'Spiralschneider Gemüse',chanceType:'fun_impulse',
  contentChance:'Gemüse wird in Sekunden zu Spiralen: Hingucker beim Kochen',hook:'Aus einer Zucchini werden Spaghetti in zehn Sekunden',
  rationale:'Sichtbarer Effekt, der zum Nachmachen anregt',targetNeed:'Abwechslung beim Kochen',formatSuggestion:'image',visualPotential:'high',entertainmentPotential:'high',
  signals:signals({demonstrable:true,beforeAfter:true,fun:true,impulse:true,broadAppeal:true}),shareReason:'Man zeigt es Freunden',trustRationale:'Nur sichtbare Anwendung, keine Versprechen',
  reachRationale:'Visuell sofort verständlich',timing:{season:null,relevance:'none'},novelty:'high',similarityNote:'Kein ähnliches Produkt kürzlich',concept:'veggie-spirals',group:null,
  confidence:80,evidenceUrls:['https://example.org/gadgets'],priority:1,...over});
const report=(opportunities,over={})=>({summary:'Test',opportunities,noGoodCandidate:false,rejectedIdeas:[],...over});
const gen=(value)=>async()=>typeof value==='function'?value():value;
const history=S.emptyHistory;

test('the agent discovers a content chance outside the static seeds and returns structured, source-backed output',async()=>{
  const result=await discoverOpportunities({now:NOW,slot:'2026-10-02:morning',history:history(),seedIdeas:[{name:'Duschabzieher',hook:'x'}],research,generate:gen(report([opp()]))});
  assert.equal(result.source,'trend_agent');assert.equal(result.candidates.length,1);
  const c=result.candidates[0];
  assert.equal(c.name,'Spiralschneider Gemüse');assert.ok(!['Duschabzieher'].includes(c.name));
  assert.equal(c.chance.type,'fun_impulse');assert.equal(c.chance.concept,'veggie-spirals');assert.equal(c.priority,1);
  assert.deepEqual(c.agent.evidence,[{title:'Gadgets, die alle teilen',url:'https://example.org/gadgets'}]);
  assert.equal(S.agentProvenanceSchema.safeParse(c.agent).success,true);
  assert.equal(result.evidenceCount,2);assert.deepEqual(result.queries,{ok:4,failed:0});
  assert.equal(researchQueries(NOW).length,4);
  assert.equal(S.assessContentChance(c.name,c.chance,history(),c.extraPenalties).passed,true);
});

test('problem solver, fun/impulse, social/game and deco/lifestyle chances are recognised; seasonal alone and weak standard items are not',()=>{
  const items=[
    opp({title:'Fugen',productIdea:'Fugenbürste',chanceType:'problem_solver',concept:'grout-clean',hook:'Verdreckte Fugen vorher, saubere Fugen nachher',signals:signals({demonstrable:true,beforeAfter:true,broadAppeal:true}),priority:1}),
    opp({title:'Pizza',productIdea:'Pizzaschere',concept:'pizza-scissors',priority:2}),
    opp({title:'Spiel',productIdea:'Partyspiel Karten',chanceType:'social_game',concept:'party-cards',hook:'Spielrunde mit Freunden, in der die Reaktionen der Inhalt sind',signals:signals({fun:true,impulse:true,gift:true,broadAppeal:true}),entertainmentPotential:'high',priority:3}),
    opp({title:'Licht',productIdea:'Sternenhimmel Projektor',chanceType:'deco_lifestyle',concept:'star-projector',hook:'Sternenhimmel an der Zimmerdecke in Sekunden sichtbar',signals:signals({demonstrable:true,wow:true,aesthetic:true,impulse:true,gift:true,broadAppeal:true}),priority:4}),
    opp({title:'Decke',productIdea:'Kuscheldecke',chanceType:'deco_lifestyle',concept:'blanket',hook:'Passend zur Herbstsaison und gemütlich für kalte Tage',signals:signals({broadAppeal:true}),visualPotential:'medium',entertainmentPotential:'low',timing:{season:'Herbst',relevance:'high'},priority:5}),
    opp({title:'Messbecher',productIdea:'Mini Messbecher',concept:'measuring',hook:'Abmessen gehört zu vielen Rezepten dazu',signals:signals({demonstrable:true}),entertainmentPotential:'low',priority:6}),
  ];
  const intake=T.intakeTrendReport(report(items),evidence);assert.equal(intake.ok,true);
  const verdict=Object.fromEntries(intake.candidates.map(c=>[c.name,S.assessContentChance(c.name,c.chance,history(),c.extraPenalties)]));
  for(const name of ['Fugenbürste','Pizzaschere','Partyspiel Karten','Sternenhimmel Projektor'])assert.equal(verdict[name].passed,true,name);
  assert.deepEqual(['problem_solver','fun_impulse','social_game','deco_lifestyle'],['Fugenbürste','Pizzaschere','Partyspiel Karten','Sternenhimmel Projektor'].map(n=>intake.candidates.find(c=>c.name===n).chance.type));
  assert.equal(verdict['Kuscheldecke'].passed,false,'seasonal alone');
  assert.equal(verdict['Mini Messbecher'].passed,false,'weak standard article');
});

test('recent rejections weigh on similar ideas; a clearly different strong chance in the same area stays possible; repeated concepts are blocked',()=>{
  const hist={rejected:[{group:'kitchen_small_tool',concept:'measuring',name:'Mini Messbecher'}],recent:[{group:null,concept:'pizza-scissors',name:'Pizzaschere'}]};
  const similar=T.intakeTrendReport(report([opp({productIdea:'Eierschneider',concept:'egg-slicer',signals:signals({demonstrable:true,fun:true,impulse:true,broadAppeal:true})})]),evidence).candidates[0];
  const base=S.assessContentChance(similar.name,similar.chance,history());
  const after=S.assessContentChance(similar.name,similar.chance,hist);
  assert.equal(base.passed,true);assert.equal(after.score,base.score-30);assert.equal(after.passed,false);
  const strong=T.intakeTrendReport(report([opp({productIdea:'Fleischkrallen Pulled Pork',concept:'shredding-claws',chanceType:'fun_impulse',
    signals:signals({demonstrable:true,beforeAfter:true,wow:true,fun:true,impulse:true,aesthetic:true,gift:true,broadAppeal:true}),group:'kitchen_small_tool'})]),evidence).candidates[0];
  assert.equal(S.assessContentChance(strong.name,strong.chance,hist).passed,true);
  // Very similar concept to a recent one (different wording): blocked.
  const repeat=T.intakeTrendReport(report([opp({productIdea:'Pizza Cutter Schere',concept:'pizza-scissors-fun'})]),evidence).candidates[0];
  const repeated=S.assessContentChance(repeat.name,repeat.chance,hist);
  assert.equal(repeated.passed,false);assert.match(repeated.reasons.join(' '),/Content-Konzept kürzlich/);
  // Within one answer the second, near-identical concept is dropped.
  const twice=T.intakeTrendReport(report([opp({concept:'veggie-spirals'}),opp({title:'Zweite Fassung',productIdea:'Spiralschneider Zucchini',concept:'veggie-spirals-idea',priority:2})]),evidence);
  assert.equal(twice.candidates.length,1);assert.match(twice.dropped[0].reason,/Doppelt/);
});

test('unbelievable or unsafe agent output is sanitised: invented sources, prices, tests, guarantees, links; topics are kept apart',()=>{
  const intake=T.intakeTrendReport(report([
    opp({title:'Mit Preis',hook:'Jetzt nur 9,99 € statt 19,99 € – Testsieger bei allen Tests',concept:'price-bait'}),
    opp({title:'Link',productIdea:'https://www.amazon.de/dp/B0ABCDEFGH',concept:'link-idea',priority:2}),
    opp({title:'Erfundene Quelle',productIdea:'Pizzaschere',concept:'pizza-scissors',evidenceUrls:['https://invented.example/x'],priority:3}),
    opp({kind:'topic_opportunity',title:'Herbstliche Ordnungstipps',productIdea:null,concept:'autumn-order-tips',priority:4,chanceType:'problem_solver'}),
  ]),evidence);
  assert.equal(intake.candidates.length,1);assert.equal(intake.candidates[0].name,'Pizzaschere');
  assert.deepEqual(intake.candidates[0].agent.evidence,[],'an invented source is never kept');
  assert.deepEqual(intake.candidates[0].extraPenalties.map(p=>p.points),[-10]);
  assert.equal(intake.topics.length,1);assert.equal(intake.topics[0].title,'Herbstliche Ordnungstipps');
  assert.equal(intake.dropped.length,2);
});

test('incomplete or failing agent answers and research outages degrade safely to the seed fallback',async()=>{
  const base={now:NOW,slot:'x',history:history(),seedIdeas:[],research};
  assert.equal((await discoverOpportunities({...base,generate:gen({summary:'kaputt'})})).failure,'invalid_response');
  assert.equal((await discoverOpportunities({...base,generate:gen(()=>{throw new Error('Modellantwort HTTP 500');})})).source,'seed_fallback');
  assert.equal((await discoverOpportunities({...base,generate:gen(()=>{throw new Error('timeout')})})).failure,'timeout');
  assert.equal((await discoverOpportunities({...base,generate:gen(()=>{throw new Error('Modellantwort HTTP 429');})})).failure,'rate_limited');
  assert.equal((await discoverOpportunities({...base,generate:null})).failure,'agent_unavailable');
  const down=await discoverOpportunities({...base,research:async()=>{throw new Error('Tavily down');},generate:gen(()=>{throw new Error('must not be called');})});
  assert.deepEqual([down.source,down.failure,down.queries],['seed_fallback','research_unavailable',{ok:0,failed:4}]);
  // Partial research outage still works.
  let n=0;const partial=await discoverOpportunities({...base,research:async()=>{if(n++%2)throw new Error('x');return evidence;},generate:gen(report([opp()]))});
  assert.deepEqual([partial.source,partial.queries],['trend_agent',{ok:2,failed:2}]);
});

// ---- integration: Jarvis scout, daily slot, manual search ------------------------------------------
async function world(t){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const lookups=[];
  const productScout=loadRoute('lib/agents/product-scout.ts',{'@/lib/tavily':{tavilySearch:async()=>[{title:'Haushaltstipps',score:0.5}],tavilySources:()=>[]},
    '@/lib/agents/content-chances':require('../.test-build/lib/agents/content-chances')});
  const orchestrator=loadRoute('lib/orchestrator.ts',{
    '@/lib/agents/product-scout':productScout,
    '@/lib/product-resolver':{findAmazonProduct:async name=>{lookups.push(name);const asin=`B${String(lookups.length).padStart(9,'0')}`;return {name,productVerifiedName:name,productVerifiedAt:'2026-09-26T08:00:00.000Z',asin,sourceUrl:`https://www.amazon.de/dp/${asin}`,affiliateUrl:`https://www.amazon.de/dp/${asin}?tag=alltaeglichle-21`,price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''};}},
    '@/lib/memory/db':{getDatabase:()=>db},'@/lib/agents/product-reviewer':{},'@/lib/agents/script-writer':{},'@/lib/content/orchestrator':{},
  });
  return {pg,db,lookups,orchestrator};
}

test('Jarvis hands the research job to the trend agent: new chances are looked up, seeds are not; failures fall back to seeds',async t=>{
  const w=await world(t);
  const agentCalls=[];
  const trend={research,generate:async(agent,instruction,input)=>{agentCalls.push({agent,input});return report([opp({priority:2}),opp({title:'Fugen',productIdea:'Fugenbürste',chanceType:'problem_solver',concept:'grout-clean',hook:'Verdreckte Fugen vorher, saubere Fugen nachher',signals:signals({demonstrable:true,beforeAfter:true,broadAppeal:true}),priority:1})]);}};
  const out=await w.orchestrator.runProductScout(undefined,'2026-10-02:morning',{quality:true,trend});
  assert.equal(agentCalls.length,1);assert.equal(agentCalls[0].agent,'trend');
  assert.ok(agentCalls[0].input.evidence.length>0&&Array.isArray(agentCalls[0].input.history.recent)&&agentCalls[0].input.seedIdeas.length>0,'brief carries evidence, history and seeds');
  assert.deepEqual(out.candidates.map(c=>c.name),['Fugenbürste','Spiralschneider Gemüse'],'agent priority order is kept');
  assert.ok(out.candidates.every(c=>c.assessment.passed&&c.agent.source==='trend_agent'&&c.resolvedProduct.asin));
  assert.ok(!w.lookups.includes('Duschabzieher'),'static seeds are not used when the agent delivers');
  assert.deepEqual([out.trend.source,out.trend.proposed],['trend_agent',2]);
  // Agent failure: static seeds with the same quality gate.
  w.lookups.length=0;
  const fb=await w.orchestrator.runProductScout(undefined,'2026-10-02:afternoon',{quality:true,trend:{research,generate:async()=>{throw new Error('Modellantwort HTTP 500');}}});
  assert.deepEqual([fb.trend.source,fb.trend.failure],['seed_fallback','agent_error']);
  assert.ok(fb.candidates.length>=1&&fb.candidates.every(c=>c.assessment.passed));assert.ok(!w.lookups.includes('Messbecher mit Skala'));
});

test('manual article search never calls the trend agent and is never filtered',async t=>{
  const w=await world(t);let called=0;
  const trend={research:async()=>{called++;return evidence;},generate:async()=>{called++;return report([]);}};
  const manual=await w.orchestrator.runProductScout('Silpat Backmatte','2026-10-02:manual:x',{quality:false,trend});
  assert.equal(called,0);assert.equal(manual.trend,null);assert.equal(manual.qualityBlocked,0);
  assert.equal(manual.candidates.length,1);
  const open=await w.orchestrator.runProductScout(undefined,'2026-10-02:manual:y',{trend});
  assert.equal(called,0);assert.ok(open.candidates.length>0);
});

class Rejected extends Error{}
function dailyWith(w,t,trend,state){
  process.env.WHATSAPP_APPROVER_WA_ID='491234';t.after(()=>{delete process.env.WHATSAPP_APPROVER_WA_ID;});
  return loadRoute('lib/daily/draft.ts',{
    '@/lib/orchestrator':{runContentJob,runProductScout:(search,key,options)=>w.orchestrator.runProductScout(search,key,{...options,trend})},
    '@/lib/memory/db':{getDatabase:()=>w.db},
    '@/lib/whatsapp/client':{WhatsAppRejectedError:Rejected,sendWhatsAppText:async b=>{state.messages.push(b);return `wamid.${state.messages.length}`;},dailyNotificationTemplateConfigured:()=>false,sendDailyNotificationTemplate:async()=>{throw Error('x');}},
  });
}

test('no good candidate from the trend agent: no forced affiliate post, no job, no message, no retry spam',async t=>{
  const w=await world(t);const state={messages:[]};let calls=0;
  await w.pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.1','491234','changes_requested','{}')");
  const daily=dailyWith(w,t,{research,generate:async()=>{calls++;return report([],{noGoodCandidate:true,rejectedIdeas:[{idea:'Mini Messbecher',reason:'Kein Hook, austauschbar'}]});}},state);
  const first=await daily.createDailyDraft('2026-10-02','morning');
  assert.deepEqual([first.status,first.reason],['needs_input','no_quality_candidate']);
  assert.equal(state.messages.length,0);assert.equal((await w.pg.query('SELECT count(*)::int AS n FROM content_jobs')).rows[0].n,0);
  assert.equal((await daily.createDailyDraft('2026-10-02','morning')).status,'already_claimed');assert.equal(calls,1);
  const report1=(await w.pg.query("SELECT scout_report FROM daily_drafts WHERE slot='morning'")).rows[0].scout_report;
  assert.match(JSON.stringify(report1),/Kein Hook, austauschbar/);
});

test('a strong agent proposal flows into the existing pipeline and keeps its provenance; Jarvis can still reject it at the final gate',async t=>{
  const w=await world(t);const state={messages:[]};
  await w.pg.query("INSERT INTO whatsapp_events(message_id,wa_id,intent,payload) VALUES('in.1','491234','changes_requested','{}')");
  const daily=dailyWith(w,t,{research,generate:async()=>report([opp({productIdea:'Pizzaschere',concept:'pizza-scissors',title:'Pizza'})])},state);
  const result=await daily.createDailyDraft('2026-10-02','morning');
  assert.equal(result.status,'awaiting_approval',JSON.stringify(result));assert.equal(result.whatsapp,'approval_sent');
  const snap=(await w.pg.query('SELECT opportunity FROM content_jobs')).rows[0].opportunity;
  assert.equal(snap.contentChance.agent.source,'trend_agent');assert.equal(snap.contentChance.agent.evidence[0].url,'https://example.org/gadgets');
  assert.equal(snap.contentChance.chance.concept,'pizza-scissors');
  // The final gate in Jarvis still applies to agent proposals: trust risk / strategic rejection stops content production.
  const product={name:'Pizzaschere',productVerifiedName:'Pizzaschere',productVerifiedAt:'2026-09-26T08:00:00.000Z',sourceUrl:'https://www.amazon.de/dp/B000000021',asin:'B000000021',affiliateUrl:'https://www.amazon.de/dp/B000000021?tag=alltaeglichle-21',price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''};
  const proposal=T.intakeTrendReport(report([opp({hook:'Heilt Verspannungen garantiert, vorher nachher sichtbar'})]),evidence);
  assert.equal(proposal.candidates.length,0,'unsafe claims are already dropped at intake');
  const sneaky=T.intakeTrendReport(report([opp({hook:'Aus einer Zucchini werden Spaghetti in zehn Sekunden'})]),evidence).candidates[0];
  const record={chance:{...sneaky.chance,hook:'Wunder-Schneider, nie wieder Schmerzen beim Kochen und klinisch bewiesen'},assessment:S.assessContentChance('x',sneaky.chance,history()),agent:sneaky.agent};
  const gate=await runContentJob({product,category:'household',useCaseKey:'seasonal-product-guide',targetPlatform:'facebook',useCase:'Das Produkt im Alltag verwenden und die Eignung vor dem Kauf prüfen.',trend:'',goal:'education',budget:'low',verifiedFacts:[],contentChance:record},{mode:'reference',allowedFormats:['image']});
  assert.equal(gate.error,S.STRATEGY_REJECTED);assert.equal(gate.content,undefined);
  // AI mode: Jarvis's semantic verdict receives the agent's structured rationale and can reject.
  let seen;
  const ai=await runContentJob({product,category:'household',useCaseKey:'seasonal-product-guide',targetPlatform:'facebook',useCase:'Das Produkt im Alltag verwenden und die Eignung vor dem Kauf prüfen.',trend:'',goal:'education',budget:'low',verifiedFacts:[],
    contentChance:{chance:sneaky.chance,assessment:S.assessContentChance('x',sneaky.chance,history()),agent:sneaky.agent}},
    {mode:'ai',allowedFormats:['image'],generate:async(agent,instruction,input)=>{seen=input;return {decision:'reject',reason:'Strategisch zu beliebig.',reachPotential:30,trustRisk:false,betterChanceHint:null};}});
  assert.equal(ai.error,S.STRATEGY_REJECTED);assert.equal(seen.trendAgent.source,'trend_agent');
});

test('topic opportunities are carried in the structured report but do not create posts yet',async t=>{
  const w=await world(t);
  const out=await w.orchestrator.runProductScout(undefined,'2026-10-02:morning',{quality:true,trend:{research,generate:async()=>report([opp({kind:'topic_opportunity',productIdea:null,title:'Ordnung im Herbst',concept:'autumn-order',chanceType:'problem_solver'})])}});
  assert.equal(out.candidates.length,0);assert.equal(out.trend.topicOpportunities[0].concept,'autumn-order');assert.ok(out.qualityBlocked>=1);
});
