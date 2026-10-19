const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {evaluateOpportunity,CRITERION_IDS}=require('../.test-build/lib/enterprise/opportunity/scoring');
const {assessEconomics,FORECAST_FORMULA}=require('../.test-build/lib/enterprise/opportunity/economics');

// Test inputs only – not proposed weights or limits (operator decision Q-07).
const VALUES={
  marketPotential:{type:'text',text:'Nische'},targetAudience:{type:'text',text:'Haushalte'},competition:{type:'scale',level:3},
  entryBarriers:{type:'scale',level:2},investmentNeed:{type:'number',amount:500,unit:'EUR'},runningCosts:{type:'number',amount:20,unit:'EUR/Monat'},
  revenueProfitPotential:{type:'range',low:50,high:250,unit:'EUR/Monat'},scalability:{type:'scale',level:4},
  payback:{type:'range',low:2,high:10,unit:'Monate'},technicalFeasibility:{type:'scale',level:4},automationLevel:{type:'number',amount:60,unit:'%'},
  legalRisks:{type:'list',items:['Kennzeichnung']},thirdPartyDependency:{type:'list',items:['Amazon']},trendDuration:{type:'text',text:'1–2 Jahre'},
};
const KIND={revenueProfitPotential:'forecast',payback:'forecast',trendDuration:'forecast'};
const grid=(over={})=>CRITERION_IDS.filter(id=>over[id]!==null).map(id=>({criterion:id,kind:KIND[id]??'assumption',confidence:0.8,sources:[],
  value:VALUES[id],score:4,rationale:'Annahmen offengelegt',...over[id]}));
const CONFIG={version:'test-1',weights:Object.fromEntries(CRITERION_IDS.map(id=>[id,1])),minimumTotalScore:3,minimumConfidence:0.5};
const run=(over={},extra={})=>{const assessments=grid(over);return assessEconomics({evaluation:evaluateOpportunity(assessments,extra.config===undefined?CONFIG:extra.config),assessments,...extra});};
const eur=(amountCents,kind='measured')=>({amountCents,currency:'EUR',kind});
const LIMITS={version:'limits-test',maxPaybackMonths:12};

test('forecast payback is a range from investment and profit range, with its formula (AC-2)',()=>{
  const result=run();
  assert.deepEqual(result.forecast.investment,{status:'known',value:{lowCents:50000,highCents:50000,currency:'EUR'}});
  assert.deepEqual(result.forecast.monthlyProfit,{status:'known',value:{lowCents:5000,highCents:25000,currency:'EUR'}});
  assert.deepEqual(result.forecast.paybackMonths,{status:'known',value:{lowMonths:2,highMonths:10}});
  assert.equal(result.forecast.formula,FORECAST_FORMULA);
  const ranged=run({investmentNeed:{value:{type:'range',low:300,high:900,unit:'EUR'}}});
  assert.deepEqual(ranged.forecast.paybackMonths.value,{lowMonths:300/250,highMonths:900/50});
  // lowest profit 0: never pays back in the unfavourable case; highest profit 0: unknown
  assert.deepEqual(run({revenueProfitPotential:{value:{type:'range',low:0,high:250,unit:'EUR/Monat'}}}).forecast.paybackMonths.value,{lowMonths:2,highMonths:null});
  assert.match(run({revenueProfitPotential:{value:{type:'range',low:-100,high:0,unit:'EUR/Monat'}}}).forecast.paybackMonths.reason,/nicht positiv/);
});

test('units, currencies and cents are checked instead of guessed (AC-3)',()=>{
  const cases=[
    [{investmentNeed:{value:{type:'number',amount:500,unit:'Euro'}}},/Währungscode/],
    [{revenueProfitPotential:{value:{type:'range',low:50,high:250,unit:'EUR'}}},/<Währung>\/Monat/],
    [{investmentNeed:{value:{type:'number',amount:500,unit:'USD'}}},/unterschiedliche Währungen/],
    [{investmentNeed:{value:{type:'number',amount:10.005,unit:'EUR'}}},/nicht in Cent darstellbar/],
  ];
  for(const [over,pattern] of cases){
    const result=run(over);
    assert.equal(result.forecast.paybackMonths.status,'unknown',JSON.stringify(over));
    assert.match(result.forecast.paybackMonths.reason,pattern);
  }
  assert.deepEqual(run({investmentNeed:{value:{type:'number',amount:12.5,unit:'EUR'}}}).forecast.investment.value,{lowCents:1250,highCents:1250,currency:'EUR'});
});

test('missing or invalid grid criteria leave the forecast unknown, never estimated (AC-3)',()=>{
  const missing=run({investmentNeed:null});
  assert.match(missing.forecast.investment.reason,/Investitionsbedarf: nicht bewertet/);
  assert.equal(missing.forecast.paybackMonths.status,'unknown');
  assert.equal(missing.verdict.status,'insufficient_data');
  const invalid=run({revenueProfitPotential:{kind:'assumption'}}); // F-01 accepts profit potential only as forecast
  assert.match(invalid.forecast.monthlyProfit.reason,/Umsatz-\/Gewinnpotenzial/);
  assert.equal(invalid.testRecommended,false);
});

test('measured figures go through E-05; estimates never enter ROI or payback (AC-1, AC-4)',()=>{
  const measured={periodMonths:2,revenue:eur(100000),directCosts:[eur(20000)],investment:eur(120000)};
  const result=run({}, {measured});
  assert.equal(result.measured.contribution.value.contributionCents,80000);
  assert.ok(Math.abs(result.measured.roiPercent.value-200/3)<1e-9);
  assert.equal(result.measured.paybackMonths.value,3); // 120000 / (80000 / 2 months)
  const withEstimate=run({}, {measured:{...measured,directCosts:[eur(20000),eur(5000,'estimated')]}});
  assert.equal(withEstimate.measured.contribution.value.includesEstimates,true);
  assert.match(withEstimate.measured.roiPercent.reason,/geschätzte Kosten/);
  assert.equal(withEstimate.measured.paybackMonths.status,'unknown');
  const forecastRevenue=run({}, {measured:{...measured,revenue:eur(100000,'forecast')}});
  assert.match(forecastRevenue.measured.contribution.reason,/nur gemessene Werte/);
  assert.match(run({}, {measured:{...measured,periodMonths:0}}).measured.paybackMonths.reason,/Messzeitraum/);
  assert.match(run({}, {measured:{...measured,investment:eur(null)}}).measured.paybackMonths.reason,/Betrag fehlt/);
  assert.match(run({}, {measured:{...measured,revenue:eur(10000)}}).measured.paybackMonths.reason,/größer als 0/); // negative contribution
});

test('verdict needs the operator limit; measured wins over forecast, forecast is judged by its unfavourable end (AC-5)',()=>{
  assert.deepEqual(run().verdict,{status:'no_operator_limit',basis:'forecast',limitsVersion:null,reasons:['maximale Amortisationsdauer nicht festgelegt (Betreiberentscheidung Q-07)']});
  assert.equal(run({}, {limits:{version:'v',maxPaybackMonths:null}}).verdict.status,'no_operator_limit');
  assert.deepEqual(run({}, {limits:LIMITS}).verdict,{status:'within_limit',basis:'forecast',limitsVersion:'limits-test',reasons:[]}); // 10 ≤ 12
  assert.equal(run({}, {limits:{...LIMITS,maxPaybackMonths:9}}).verdict.status,'outside_limit'); // unfavourable end 10 > 9
  const neverPays=run({revenueProfitPotential:{value:{type:'range',low:0,high:250,unit:'EUR/Monat'}}},{limits:LIMITS});
  assert.equal(neverPays.verdict.status,'outside_limit');assert.match(neverPays.verdict.reasons[0],/keine Amortisation/);
  const measured={periodMonths:2,revenue:eur(100000),directCosts:[],investment:eur(1200000)}; // payback 24 months
  const byMeasurement=run({}, {measured,limits:LIMITS});
  assert.deepEqual([byMeasurement.verdict.status,byMeasurement.verdict.basis],['outside_limit','measured']);
});

test('test recommended only if the grid recommends a test and the verdict is within the limit (AC-6)',()=>{
  assert.equal(run({}, {limits:LIMITS}).testRecommended,true);
  assert.equal(run({}, {limits:{...LIMITS,maxPaybackMonths:9}}).testRecommended,false);
  assert.equal(run().testRecommended,false); // no operator limit
  const noWeights=run({}, {config:null,limits:LIMITS});
  assert.deepEqual([noWeights.scoring.recommendation,noWeights.verdict.status,noWeights.testRecommended],['blocked','within_limit',false]);
});

test('inputs are not mutated and results are deterministic (AC-1)',()=>{
  const assessments=grid();const evaluation=evaluateOpportunity(assessments,CONFIG);
  const measured={periodMonths:2,revenue:eur(100000),directCosts:[eur(20000)],investment:eur(120000)};
  const snapshot=JSON.stringify([assessments,evaluation,measured,LIMITS]);
  const first=assessEconomics({evaluation,assessments,measured,limits:LIMITS});
  assert.deepEqual(assessEconomics({evaluation,assessments,measured,limits:LIMITS}),first);
  assert.equal(JSON.stringify([assessments,evaluation,measured,LIMITS]),snapshot);
});

test('module is pure and isolated: only E-05 and F-01 imported, no clock, not used by app code (AC-7)',()=>{
  const source=fs.readFileSync('lib/enterprise/opportunity/economics.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../controlling/metrics','./scoring']);
  assert.doesNotMatch(source,/require\(|import\(|Date\.|new Date|Math\.random|process\.|fetch\(/);
  const users=[];
  const scan=full=>{if(/\.(ts|tsx|js|mjs|cjs)$/.test(full)&&/enterprise\/opportunity\/economics/.test(fs.readFileSync(full,'utf8')))users.push(full);};
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&full!==path.join('lib','enterprise'))walk(full);}else scan(full);
  }};
  walk('app');walk('lib');walk('scripts');
  for(const file of fs.readdirSync('.'))if(/\.(ts|tsx)$/.test(file))scan(file);
  assert.deepEqual(users,[]);
});
