const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {evaluateOpportunity,CRITERIA,CRITERION_IDS}=require('../.test-build/lib/enterprise/opportunity/scoring');

// Test inputs only – not proposed weights. Real weights and thresholds are the operator's decision (Q-07).
const VALUES={
  marketPotential:{type:'text',text:'wachsende Nische'},targetAudience:{type:'text',text:'Haushalte'},
  competition:{type:'scale',level:3},entryBarriers:{type:'scale',level:2},investmentNeed:{type:'number',amount:500,unit:'EUR'},
  runningCosts:{type:'range',low:20,high:40,unit:'EUR/Monat'},revenueProfitPotential:{type:'range',low:0,high:300,unit:'EUR/Monat'},
  scalability:{type:'scale',level:4},payback:{type:'range',low:2,high:25,unit:'Monate'},technicalFeasibility:{type:'scale',level:4},
  automationLevel:{type:'number',amount:60,unit:'%'},legalRisks:{type:'list',items:['Kennzeichnung']},
  thirdPartyDependency:{type:'list',items:['Amazon']},trendDuration:{type:'text',text:'1–2 Jahre'},
};
const KIND={revenueProfitPotential:'forecast',payback:'forecast',trendDuration:'forecast'};
const assessment=(criterion,over={})=>({criterion,kind:KIND[criterion]??'assumption',confidence:0.8,sources:[],value:VALUES[criterion],
  score:3,rationale:'Annahmen offengelegt',...over});
const all=(over={})=>CRITERION_IDS.map(id=>assessment(id,over[id]));
const weights=(value=1)=>Object.fromEntries(CRITERION_IDS.map(id=>[id,value]));
const config=(over={})=>({version:'test-1',weights:weights(),minimumTotalScore:3,minimumConfidence:0.5,...over});
const blockedBy=(result,pattern)=>{assert.equal(result.recommendation.status,'blocked');assert.ok(result.recommendation.reasons.some(r=>pattern.test(r)),result.recommendation.reasons.join(' | '));};

test('grid covers exactly the 14 criteria of 02 §6 (AC-2)',()=>{
  assert.equal(CRITERION_IDS.length,14);
  assert.deepEqual(Object.values(CRITERIA).map(c=>c.label),['Marktpotenzial','Zielgruppe','Wettbewerb','Eintrittsbarrieren','Investitionsbedarf',
    'Laufende Kosten','Umsatz-/Gewinnpotenzial','Skalierbarkeit','Amortisationsdauer','Technische Umsetzbarkeit','Automatisierungsgrad',
    'Rechtliche Risiken','Abhängigkeit von Drittanbietern','Voraussichtliche Trenddauer']);
});

test('complete assessment with operator config yields the weighted mean and recommends a test (AC-4, AC-6)',()=>{
  const result=evaluateOpportunity(all({competition:{score:5},legalRisks:{score:1}}),config({weights:{...weights(),competition:3}}));
  // (3·5 + 1·1 + 12·3) / 16
  assert.deepEqual(result.total,{status:'known',value:(15+1+36)/16,weightsVersion:'test-1'});
  assert.ok(Math.abs(result.confidence-0.8)<1e-12);
  assert.deepEqual(result.recommendation,{status:'recommend_test',reasons:[]});
  assert.deepEqual(result.missingCriteria,[]);assert.deepEqual(result.invalidCriteria,[]);
});

test('total below the operator minimum is not recommended (AC-6)',()=>{
  const result=evaluateOpportunity(all(),config({minimumTotalScore:3.5}));
  assert.equal(result.total.value,3);
  assert.equal(result.recommendation.status,'not_recommended');
});

test('no default weights: missing or invalid weights make the total unknown (AC-3)',()=>{
  for(const [cfg,pattern] of [
    [undefined,/Gewichte fehlen/],[null,/Gewichte fehlen/],[{version:'v1'},/Gewichte fehlen/],[config({version:' '}),/Version fehlt/],
    [config({weights:{...weights(),competition:undefined}}),/Gewicht fehlt.*Wettbewerb/],[config({weights:{...weights(),scalability:-1}}),/Skalierbarkeit/],
    [config({weights:{...weights(),scalability:Number.NaN}}),/Skalierbarkeit/],[config({weights:{...weights(),bonus:1}}),/unbekannte Kriterien \(bonus\)/],
    [config({weights:weights(0)}),/Summe ist 0/],
  ]){
    const result=evaluateOpportunity(all(),cfg);
    assert.equal(result.total.status,'unknown');assert.match(result.total.reason,pattern);
    blockedBy(result,/Gesamtwert unbekannt/);
  }
});

test('weight 0 ignores the score; a weighted criterion without score is unknown, not estimated (AC-4)',()=>{
  const zero=evaluateOpportunity(all({targetAudience:{score:null},competition:{score:1}}),config({weights:{...weights(),targetAudience:0,competition:0}}));
  assert.equal(zero.total.value,3);
  const missingScore=evaluateOpportunity(all({targetAudience:{score:null}}),config());
  assert.equal(missingScore.total.status,'unknown');assert.match(missingScore.total.reason,/ohne Bewertung: Zielgruppe/);
});

test('missing criteria lower the confidence and block the recommendation (AC-5)',()=>{
  const result=evaluateOpportunity(all().filter(a=>a.criterion!=='legalRisks'),config({weights:{...weights(),legalRisks:0}}));
  assert.deepEqual(result.missingCriteria,['legalRisks']);
  assert.equal(result.total.status,'known'); // weight 0, so the total itself is still defined
  assert.ok(Math.abs(result.confidence-0.8*13/14)<1e-12);
  blockedBy(result,/fehlende Kriterien: Rechtliche Risiken/);
  const none=evaluateOpportunity(null,config());
  assert.equal(none.missingCriteria.length,14);assert.equal(none.confidence,0);blockedBy(none,/Bewertungsliste fehlt/);
});

test('invalid assessments are rejected with a reason and never scored (AC-2, AC-5)',()=>{
  const cases=[
    ['marketPotential',{kind:'fact',sources:[]},/Fakt ohne Quelle/],['marketPotential',{kind:'rumour'},/unbekannte Art/],
    ['competition',{confidence:1.2},/Konfidenz/],['competition',{confidence:Number.NaN},/Konfidenz/],
    ['competition',{sources:[{reference:' '}]},/Quellen ungültig/],['competition',{score:0},/Bewertung nur/],['competition',{score:2.5},/Bewertung nur/],
    ['competition',{value:{type:'scale',level:6}},/Skala/],['competition',{value:{type:'text',text:'viel'}},/Werttyp text nicht zulässig/],
    ['revenueProfitPotential',{value:{type:'number',amount:200,unit:'EUR'}},/Werttyp number/],
    ['revenueProfitPotential',{kind:'assumption'},/Art assumption nicht zulässig/],
    ['revenueProfitPotential',{rationale:''},/Prognose ohne offengelegte Formel/],
    ['revenueProfitPotential',{value:{type:'range',low:300,high:0,unit:'EUR'}},/Untergrenze/],
    ['runningCosts',{value:{type:'range',low:0,high:Number.POSITIVE_INFINITY,unit:'EUR'}},/nicht endlich/],
    ['investmentNeed',{value:{type:'number',amount:500,unit:''}},/Einheit fehlt/],
    ['automationLevel',{value:{type:'number',amount:120,unit:'%'}},/0 bis 100/],['legalRisks',{value:{type:'list',items:['']}},/Liste/],
    ['trendDuration',{kind:'fact',sources:[{reference:'https://example.org'}]},/Art fact nicht zulässig/],['targetAudience',{value:null},/Wert fehlt/],
  ];
  for(const [criterion,over,pattern] of cases){
    const result=evaluateOpportunity(all({[criterion]:over}),config());
    const state=result.criteria.find(c=>c.criterion===criterion);
    assert.equal(state.state,'invalid',`${criterion} ${JSON.stringify(over)}`);assert.match(state.reason,pattern);
    assert.equal(state.confidence,0);assert.ok(result.invalidCriteria.includes(criterion));
    blockedBy(result,pattern);
  }
  // a fact with a source is fine
  const fact=evaluateOpportunity(all({marketPotential:{kind:'fact',sources:[{reference:'https://example.org/studie'}]}}),config());
  assert.equal(fact.recommendation.status,'recommend_test');
});

test('payback needs valid investment and profit range; duplicates and unknown criteria block (AC-2, AC-5)',()=>{
  const noInvestment=evaluateOpportunity(all().filter(a=>a.criterion!=='investmentNeed'),config());
  assert.match(noInvestment.criteria.find(c=>c.criterion==='payback').reason,/Amortisation ohne/);
  const badProfit=evaluateOpportunity(all({revenueProfitPotential:{kind:'assumption'}}),config());
  assert.equal(badProfit.criteria.find(c=>c.criterion==='payback').state,'invalid');
  const duplicate=evaluateOpportunity([...all(),assessment('competition',{score:5})],config());
  assert.match(duplicate.criteria.find(c=>c.criterion==='competition').reason,/mehrfach/);
  assert.equal(duplicate.total.status,'unknown');
  for(const bogus of [{criterion:'toString'},{criterion:'luck'},null]) blockedBy(evaluateOpportunity([...all(),bogus],config()),/unbekanntes Kriterium/);
});

test('thresholds are operator input: missing thresholds or low confidence block (AC-6)',()=>{
  blockedBy(evaluateOpportunity(all(),config({minimumTotalScore:undefined})),/Mindestgesamtwert fehlt/);
  blockedBy(evaluateOpportunity(all(),config({minimumTotalScore:7})),/Mindestgesamtwert fehlt oder ungültig/);
  blockedBy(evaluateOpportunity(all(),config({minimumConfidence:null})),/Mindestkonfidenz fehlt/);
  blockedBy(evaluateOpportunity(all({competition:{confidence:0.1}}),config({minimumConfidence:0.8})),/Konfidenz 0\.75 unter Mindestwert 0\.8/);
});

test('inputs are not mutated and results are deterministic (AC-1)',()=>{
  const input=all();const cfg=config();const snapshot=JSON.stringify([input,cfg]);
  const first=evaluateOpportunity(input,cfg);
  assert.deepEqual(evaluateOpportunity(input,cfg),first);
  assert.equal(JSON.stringify([input,cfg]),snapshot);
});

test('module is pure and isolated: no imports, no clock, not used by app code (AC-1, AC-7)',()=>{
  const source=fs.readFileSync('lib/enterprise/opportunity/scoring.ts','utf8');
  assert.doesNotMatch(source,/^\s*import\s/m);
  assert.doesNotMatch(source,/require\(|Date\.|new Date|Math\.random|process\.|fetch\(/);
  // Every production entry point outside lib/enterprise (enterprise modules may build on this grid later).
  const users=[];
  const scan=full=>{if(/\.(ts|tsx)$/.test(full)&&/enterprise\/opportunity\/scoring/.test(fs.readFileSync(full,'utf8')))users.push(full);};
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&full!==path.join('lib','enterprise'))walk(full);}else scan(full);
  }};
  walk('app');walk('lib');walk('scripts');
  for(const file of fs.readdirSync('.'))if(/\.(ts|tsx)$/.test(file))scan(file);
  assert.deepEqual(users,[]);
});
