const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {contributionMargin,simpleRoi,simplePayback}=require('../.test-build/lib/enterprise/controlling/metrics');

const eur=(amountCents,kind='measured',currency='EUR')=>({amountCents,currency,kind});
const known=result=>{assert.equal(result.status,'known',result.reason);return result.value;};
const unknown=(result,pattern)=>{assert.equal(result.status,'unknown');assert.match(result.reason,pattern);};

test('contribution margin separates measured and estimated direct costs (AC-2)',()=>{
  assert.deepEqual(known(contributionMargin(eur(10000),[eur(2000),eur(1000,'estimated')])),{currency:'EUR',measuredRevenueCents:10000,
    measuredDirectCostsCents:2000,estimatedDirectCostsCents:1000,contributionCents:7000,includesEstimates:true});
  assert.deepEqual(known(contributionMargin(eur(10000),[eur(2500),eur(500)])),{currency:'EUR',measuredRevenueCents:10000,
    measuredDirectCostsCents:3000,estimatedDirectCostsCents:0,contributionCents:7000,includesEstimates:false});
  // A margin may be negative; it is not a company profit, only revenue minus the direct costs passed in.
  assert.equal(known(contributionMargin(eur(1000),[eur(4000)])).contributionCents,-3000);
});

test('empty cost list is confirmed zero cost, a missing list is unknown (AC-3)',()=>{
  assert.equal(known(contributionMargin(eur(500),[])).contributionCents,500);
  unknown(contributionMargin(eur(500),null),/Kostenliste fehlt/);
  unknown(contributionMargin(eur(500),undefined),/Kostenliste fehlt/);
});

test('forecasts and non-measured revenue never enter a margin (AC-2)',()=>{
  unknown(contributionMargin(eur(10000,'forecast'),[]),/nur gemessene Werte/);
  unknown(contributionMargin(eur(10000,'estimated'),[]),/nur gemessene Werte/);
  unknown(contributionMargin(eur(10000),[eur(100,'forecast')]),/Prognosen/);
});

test('invalid amounts and currencies yield unknown with a reason, never zero (AC-3)',()=>{
  const cases=[
    [eur(null),/Betrag fehlt/],[eur(Number.NaN),/keine endliche Zahl/],[eur(Number.POSITIVE_INFINITY),/keine endliche Zahl/],
    [eur(10.5),/Bruchteile/],[eur(-1),/negativer Betrag/],[eur(2**53),/sicheren Zahlenbereichs/],[eur(100,'measured',''),/Währung fehlt/],
    [eur(100,'measured','  '),/Währung fehlt/],[eur(100,'guess'),/Werteart/],[null,/Angabe fehlt/],
  ];
  for(const [input,pattern] of cases){
    unknown(contributionMargin(input,[]),pattern);
    unknown(contributionMargin(eur(100),[input]),pattern);
  }
  unknown(contributionMargin(eur(100),[eur(10,'measured','USD')]),/unterschiedliche Währungen/);
  // 0 is a value, null is not
  assert.equal(known(contributionMargin(eur(0),[eur(0)])).contributionCents,0);
});

test('cost sums outside the safe integer range are unknown (AC-3)',()=>{
  const big=Number.MAX_SAFE_INTEGER-1;
  unknown(contributionMargin(eur(100),[eur(big),eur(big)]),/Kostensumme/);
  unknown(contributionMargin(eur(100),[eur(big,'estimated'),eur(big,'estimated')]),/Kostensumme/);
  unknown(contributionMargin(eur(0),[eur(big),eur(big,'estimated')]),/Deckungsbeitrag außerhalb/);
});

test('simple ROI is netReturn / investment * 100, not annualised (AC-4)',()=>{
  assert.equal(known(simpleRoi(eur(2000),eur(10000))),20);
  assert.equal(known(simpleRoi(eur(-2000),eur(10000))),-20);
  assert.ok(Math.abs(known(simpleRoi(eur(1),eur(3)))-33.333333333333336)<1e-9); // unrounded (AC-6)
  unknown(simpleRoi(eur(2000),eur(0)),/größer als 0/);
  unknown(simpleRoi(eur(2000),eur(-10000)),/negativer Betrag/);
  unknown(simpleRoi(eur(2000,'estimated'),eur(10000)),/nur gemessene Werte/);
  unknown(simpleRoi(eur(2000),eur(10000,'forecast')),/nur gemessene Werte/);
  unknown(simpleRoi(eur(2000),eur(10000,'measured','USD')),/unterschiedliche Währungen/);
  unknown(simpleRoi(eur(null),eur(10000)),/Betrag fehlt/);
});

test('simple payback in months; non-positive inflow never pays back (AC-5)',()=>{
  assert.equal(known(simplePayback(eur(120000),eur(10000))),12);
  assert.equal(known(simplePayback(eur(0),eur(10000))),0);
  assert.equal(known(simplePayback(eur(100000),eur(30000))),100000/30000);
  unknown(simplePayback(eur(120000),eur(0)),/größer als 0/);
  unknown(simplePayback(eur(120000),eur(-500)),/größer als 0/);
  unknown(simplePayback(eur(0),eur(0)),/größer als 0/);
  unknown(simplePayback(eur(-1),eur(10000)),/negativer Betrag/);
  unknown(simplePayback(eur(120000,'estimated'),eur(10000)),/nur gemessene Werte/);
  unknown(simplePayback(eur(120000),eur(10000,'measured','CHF')),/unterschiedliche Währungen/);
});

test('inputs are not mutated and results are deterministic (AC-1)',()=>{
  const revenue=eur(10000);const costs=[eur(2000),eur(1000,'estimated')];
  const snapshot=JSON.stringify([revenue,costs]);
  const first=contributionMargin(revenue,costs);
  assert.deepEqual(contributionMargin(revenue,costs),first);
  assert.deepEqual(simpleRoi(eur(2000),eur(10000)),simpleRoi(eur(2000),eur(10000)));
  assert.equal(JSON.stringify([revenue,costs]),snapshot);
});

test('module is pure and isolated: no imports, no clock, not used by app code (AC-1, AC-7)',()=>{
  const source=fs.readFileSync('lib/enterprise/controlling/metrics.ts','utf8');
  assert.doesNotMatch(source,/^\s*import\s/m);
  assert.doesNotMatch(source,/require\(|Date\.|new Date|Math\.random|process\.|fetch\(/);
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&!full.startsWith(path.join('lib','enterprise')))walk(full);}
    else if(/\.(ts|tsx)$/.test(entry.name)&&/enterprise\/controlling\/metrics/.test(fs.readFileSync(full,'utf8')))users.push(full);
  }};
  walk('app');walk('lib');
  assert.deepEqual(users,[]);
});
