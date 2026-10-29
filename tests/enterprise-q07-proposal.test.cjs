// Q-07 proposal: the drafted weights, thresholds and payback limit are recomputed with the real F-01/F-04 functions, the
// document must state exactly these values, and the draft must not be active in the operator configuration.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {evaluateOpportunity,CRITERIA,CRITERION_IDS}=require('../.test-build/lib/enterprise/opportunity/scoring');
const {assessEconomics}=require('../.test-build/lib/enterprise/opportunity/economics');
const {SCORING_CONFIG,ECONOMICS_LIMITS}=require('../.test-build/lib/enterprise/opportunity/operator-config');

const proposal=JSON.parse(fs.readFileSync('tests/fixtures/q07-proposal.json','utf8'));
const doc=fs.readFileSync('docs/ai-business/Q07_VORSCHLAG_BEWERTUNGSRASTER.md','utf8');
const decimal=value=>String(value).replace('.',',');

// A complete, valid grid: every criterion assessed with the same score and confidence; profit range in EUR/Monat.
function grid({score=4,confidence=0.8,investment=300,profit=[50,150]}={}){
  const values={
    marketPotential:{type:'text',text:'Nachfrage belegt'},targetAudience:{type:'text',text:'Haushalte'},
    competition:{type:'scale',level:3},entryBarriers:{type:'scale',level:3},investmentNeed:{type:'number',amount:investment,unit:'EUR'},
    runningCosts:{type:'range',low:10,high:20,unit:'EUR/Monat'},revenueProfitPotential:{type:'range',low:profit[0],high:profit[1],unit:'EUR/Monat'},
    scalability:{type:'scale',level:3},payback:{type:'range',low:2,high:6,unit:'Monate'},technicalFeasibility:{type:'scale',level:3},
    automationLevel:{type:'number',amount:70,unit:'%'},legalRisks:{type:'list',items:['Kennzeichnung']},
    thirdPartyDependency:{type:'list',items:['Tavily']},trendDuration:{type:'text',text:'mehrere Jahre'},
  };
  const kinds={revenueProfitPotential:'forecast',payback:'forecast',trendDuration:'assumption'};
  return CRITERION_IDS.map(criterion=>({criterion,kind:kinds[criterion]??'fact',confidence,sources:[{reference:'https://example.org/q'}],
    value:values[criterion],score,rationale:'Annahme offengelegt'}));
}

test('the draft is not active: operator configuration stays null until the operator decides Q-07',()=>{
  assert.equal(SCORING_CONFIG,null);
  assert.equal(ECONOMICS_LIMITS,null);
  assert.match(proposal.status,/nicht wirksam/);
});

test('weights cover every criterion, are positive and sum to 100; thresholds are within range',()=>{
  assert.deepEqual(Object.keys(proposal.scoring.weights).sort(),[...CRITERION_IDS].sort());
  for(const id of CRITERION_IDS) assert.ok(proposal.scoring.weights[id]>0,id);
  assert.equal(CRITERION_IDS.reduce((sum,id)=>sum+proposal.scoring.weights[id],0),100);
  assert.ok(proposal.scoring.minimumTotalScore>=1&&proposal.scoring.minimumTotalScore<=5);
  assert.ok(proposal.scoring.minimumConfidence>=0&&proposal.scoring.minimumConfidence<=1);
  assert.ok(proposal.budget.dailyLimit>=1&&proposal.budget.dailyLimit<=10);
});

test('recomputed: all 4 → total 4.0, test recommended; all 3 → 3.0, not recommended',()=>{
  const good=evaluateOpportunity(grid({score:4}),proposal.scoring);
  assert.equal(good.total.status,'known');
  assert.equal(good.total.value.toFixed(1),'4.0');
  assert.equal(good.total.weightsVersion,proposal.scoring.version);
  assert.equal(good.recommendation.status,'recommend_test');
  const economics=assessEconomics({evaluation:good,assessments:grid({score:4}),limits:proposal.economics});
  assert.deepEqual(economics.forecast.paybackMonths.value,{lowMonths:2,highMonths:6});
  assert.equal(economics.verdict.status,'within_limit');
  assert.equal(economics.testRecommended,true);
  const middling=evaluateOpportunity(grid({score:3}),proposal.scoring);
  assert.equal(middling.total.value.toFixed(1),'3.0');
  assert.equal(middling.recommendation.status,'not_recommended');
});

test('payback limit: 300 EUR at 20–100 EUR/Monat is 3–15 months, outside 12; no test recommended',()=>{
  const assessments=grid({profit:[20,100]});
  const economics=assessEconomics({evaluation:evaluateOpportunity(assessments,proposal.scoring),assessments,limits:proposal.economics});
  assert.deepEqual(economics.forecast.paybackMonths.value,{lowMonths:3,highMonths:15});
  assert.equal(economics.verdict.status,'outside_limit');
  assert.equal(economics.testRecommended,false);
});

test('confidence example: 6 sourced at 0.8 and 8 unsourced at 0.3 gives 0.51 (passes 0.5); 8 sourced fail 0.6',()=>{
  const mixed=sourced=>grid().map((item,index)=>index<sourced?item:{...item,kind:item.kind==='fact'?'assumption':item.kind,sources:[],confidence:0.3});
  const six=evaluateOpportunity(mixed(6),proposal.scoring);
  assert.equal(six.confidence.toFixed(2),'0.51');
  assert.equal(six.recommendation.status,'recommend_test');
  assert.ok(evaluateOpportunity(mixed(8),proposal.scoring).confidence<0.6);
  assert.ok(evaluateOpportunity(mixed(9),proposal.scoring).confidence>=0.6);
});

test('a missing criterion blocks the recommendation regardless of weights',()=>{
  const evaluation=evaluateOpportunity(grid().filter(item=>item.criterion!=='trendDuration'),proposal.scoring);
  assert.equal(evaluation.recommendation.status,'blocked');
});

test('the document states the proposed values for every criterion',()=>{
  for(const id of CRITERION_IDS) assert.match(doc,new RegExp(`\\| ${CRITERIA[id].label} \\| ${proposal.scoring.weights[id]} \\|`),id);
  assert.match(doc,new RegExp(`\\*\\*${decimal(proposal.scoring.minimumTotalScore)}\\*\\* von 5`));
  assert.match(doc,new RegExp(`\\*\\*${decimal(proposal.scoring.minimumConfidence)}\\*\\*`));
  assert.match(doc,new RegExp(`\\*\\*${proposal.economics.maxPaybackMonths} Monate\\*\\*`));
  assert.match(doc,new RegExp(`\\*\\*${proposal.budget.dailyLimit} Prüfungen pro Tag\\*\\*`));
  assert.match(doc,/Entwurf, nicht wirksam/);
});
