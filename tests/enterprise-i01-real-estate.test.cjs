// I-01: the assessment "Immobilienanalyse" is recomputed with the real F-01/F-04 functions from its fixture, and the document
// must state exactly that result. Nothing in the fixture may look like invented market data.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {evaluateOpportunity,CRITERIA,CRITERION_IDS}=require('../.test-build/lib/enterprise/opportunity/scoring');
const {assessEconomics}=require('../.test-build/lib/enterprise/opportunity/economics');

const fixture=JSON.parse(fs.readFileSync('tests/fixtures/i01-real-estate.json','utf8'));
const doc=fs.readFileSync('docs/ai-business/I01_BEWERTUNG_IMMOBILIENANALYSE.md','utf8');
const evaluation=evaluateOpportunity(fixture.assessments,null); // no weights: operator decision Q-07
const economics=assessEconomics({evaluation,assessments:fixture.assessments});

test('fixture: only assumptions with sources, no scores, no numbers (no invented market data)',()=>{
  assert.ok(fixture.assessments.length>0);
  for(const item of fixture.assessments){
    assert.equal(item.kind,'assumption',item.criterion);
    assert.ok(item.sources.length>0,`${item.criterion}: Quelle fehlt`);
    assert.equal(item.score,null,`${item.criterion}: keine Note ohne Daten`);
    assert.ok(!['number','range','scale'].includes(item.value.type),`${item.criterion}: keine Zahlen`);
  }
  assert.doesNotMatch(JSON.stringify(fixture),/\d+(?:[.,]\d+)?\s*(?:€|EUR|Euro|%|Mio|Mrd)/i,'keine Beträge oder Quoten');
});

test('recomputed result: blocked, confidence 0.06, total unknown, economics insufficient_data, no test',()=>{
  assert.deepEqual(evaluation.invalidCriteria,[]);
  assert.equal(evaluation.missingCriteria.length,11);
  assert.equal(evaluation.recommendation.status,'blocked');
  assert.equal(evaluation.total.status,'unknown');
  assert.match(evaluation.total.reason,/Q-07/);
  assert.equal(evaluation.confidence.toFixed(2),'0.06');
  assert.equal(economics.verdict.status,'insufficient_data');
  assert.equal(economics.forecast.paybackMonths.status,'unknown');
  assert.equal(economics.testRecommended,false);
});

test('the document states the recomputed result and covers every criterion',()=>{
  assert.match(doc,/\*\*Daten fehlen\*\*/);
  assert.match(doc,/Empfehlung \*\*blocked\*\*/);
  assert.match(doc,new RegExp(`Konfidenz \\*\\*${evaluation.confidence.toFixed(2).replace('.',',')}\\*\\*`));
  assert.match(doc,new RegExp(`${CRITERION_IDS.length-evaluation.missingCriteria.length} von ${CRITERION_IDS.length} Kriterien`));
  assert.match(doc,new RegExp(`${evaluation.missingCriteria.length} Kriterien fehlen`));
  assert.match(doc,new RegExp(`\\*\\*${economics.verdict.status}\\*\\*`));
  assert.match(doc,/Test empfohlen: \*\*nein\*\*/);
  for(const id of CRITERION_IDS){
    const row=doc.split('\n').find(line=>line.startsWith(`| ${CRITERIA[id].label} |`));
    assert.ok(row,`Zeile für ${CRITERIA[id].label}`);
    const assessed=!evaluation.missingCriteria.includes(id);
    assert.match(row,assessed?/\| Annahme \|/:/\| unbekannt \|/,CRITERIA[id].label);
  }
  // I-03 is only built after an operator Go on I-01.
  assert.match(doc,/I-03 \(Abteilungsskelett\) \*\*nicht\*\* gebaut/);
});
