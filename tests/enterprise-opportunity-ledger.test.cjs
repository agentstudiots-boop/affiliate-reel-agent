const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {applyMigrations}=require('../.test-build/lib/memory/migrations');
const {evaluateOpportunity,CRITERION_IDS}=require('../.test-build/lib/enterprise/opportunity/scoring');
const {assessEconomics}=require('../.test-build/lib/enterprise/opportunity/economics');
const L=require('../.test-build/lib/enterprise/opportunity/ledger');

const SQL=fs.readFileSync('db/migrations/042_opportunities.sql','utf8');
// Test inputs only – not proposed weights or limits (operator decision Q-07), same grid as the F-04 tests.
const VALUES={
  marketPotential:{type:'text',text:'Nische'},targetAudience:{type:'text',text:'Haushalte'},competition:{type:'scale',level:3},
  entryBarriers:{type:'scale',level:2},investmentNeed:{type:'number',amount:500,unit:'EUR'},runningCosts:{type:'number',amount:20,unit:'EUR/Monat'},
  revenueProfitPotential:{type:'range',low:50,high:250,unit:'EUR/Monat'},scalability:{type:'scale',level:4},
  payback:{type:'range',low:2,high:10,unit:'Monate'},technicalFeasibility:{type:'scale',level:4},automationLevel:{type:'number',amount:60,unit:'%'},
  legalRisks:{type:'list',items:['Kennzeichnung']},thirdPartyDependency:{type:'list',items:['Amazon']},trendDuration:{type:'text',text:'1–2 Jahre'},
};
const KIND={revenueProfitPotential:'forecast',payback:'forecast',trendDuration:'forecast'};
const grid=(score=4)=>CRITERION_IDS.map(id=>({criterion:id,kind:KIND[id]??'assumption',confidence:0.8,sources:[],value:VALUES[id],score,rationale:'Annahmen offengelegt'}));
const CONFIG={version:'test-1',weights:Object.fromEntries(CRITERION_IDS.map(id=>[id,1])),minimumTotalScore:3,minimumConfidence:0.5};
const LIMITS={version:'limits-test',maxPaybackMonths:12};

test('migration 042 is additive, idempotent, registered and enforces its rules (AC-1)',async()=>{
  assert.doesNotMatch(SQL,/\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|RENAME)\b/i);
  for(const statement of SQL.match(/CREATE (TABLE|UNIQUE INDEX|INDEX)[^\n]*/g))assert.match(statement,/IF NOT EXISTS/,statement);
  const db=await pgliteDatabase();
  await db.exec(SQL);
  const again=await applyMigrations(db);
  assert.deepEqual(again.applied,[]);
  assert.ok(again.alreadyApplied.includes('042_opportunities.sql'));
  assert.match(fs.readFileSync('lib/memory/ensure-automation-schema.ts','utf8'),/opportunity_assessments'\) IS NOT NULL AS opportunities/);
  assert.match(fs.readFileSync('lib/architecture/model.ts','utf8'),/Migrationen 001–042/);
  const {id}=await L.createOpportunity(db,{title:'Idee',origin:'operator'});
  const base={opportunity_id:id,version:1,weights_version:'w',criteria:'[]',evaluation:'{}',economics:'{}',recommendation:'blocked',test_recommended:false,created_by:'operator'};
  const insert=fields=>{const r={id:crypto.randomUUID(),...base,...fields};const k=Object.keys(r);
    return db.query(`INSERT INTO opportunity_assessments(${k.join(',')}) VALUES(${k.map((_,i)=>`$${i+1}`).join(',')})`,k.map(x=>r[x]));};
  for(const bad of [{test_recommended:true},{recommendation:'approved'},{created_by:'scout'},{model_calls:-1},{cost_cents:-1},{version:0},{opportunity_id:crypto.randomUUID()}])
    await assert.rejects(insert(bad),undefined,JSON.stringify(bad));
  await insert({});
  await assert.rejects(insert({}),undefined,'same version twice');
  await assert.rejects(db.query("INSERT INTO opportunities(id,title,origin) VALUES($1,'x','gpt')",[crypto.randomUUID()]));
  await db.close();
});

test('the stored evaluation is always computed by F-01/F-04 from the stored criteria, never taken from the caller (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const {id}=await L.createOpportunity(db,{title:'  Küchenhelfer   Nische ',summary:'Test',origin:'scout'});
  const criteria=grid(4);
  // A caller trying to smuggle in its own verdict: extra fields are ignored, only the criteria count.
  const result=await L.recordAssessment(db,id,{criteria,config:CONFIG,limits:LIMITS,createdBy:'department',recommendation:'recommend_test',testRecommended:true,
    research:[{reference:'https://example.org/markt',note:'Marktübersicht'}],usage:{modelCalls:2,costCents:3}});
  const evaluation=evaluateOpportunity(criteria,CONFIG);
  const economics=assessEconomics({evaluation,assessments:criteria,measured:null,limits:LIMITS});
  assert.equal(result.version,1);
  assert.equal(result.recommendation,evaluation.recommendation.status);
  assert.equal(result.testRecommended,economics.testRecommended);
  const row=(await db.query('SELECT * FROM opportunity_assessments WHERE id=$1',[result.id])).rows[0];
  assert.deepEqual(row.evaluation,JSON.parse(JSON.stringify(evaluation)));
  assert.deepEqual(row.economics,JSON.parse(JSON.stringify(economics)));
  assert.deepEqual(row.criteria,JSON.parse(JSON.stringify(criteria)));
  assert.deepEqual([row.weights_version,row.model_calls,Number(row.cost_cents),row.created_by],['test-1',2,3,'department']);
  assert.deepEqual(row.research,[{reference:'https://example.org/markt',note:'Marktübersicht'}]);
  // Low scores: the same functions say "not recommended", whatever the caller wants.
  const low=await L.recordAssessment(db,id,{criteria:grid(1),config:CONFIG,limits:LIMITS,createdBy:'executive'});
  assert.equal(low.version,2);
  assert.equal(low.recommendation,'not_recommended');
  assert.equal(low.testRecommended,false);
  // Without weights the total is unknown and nothing is recommended (Q-07 open).
  const unweighted=await L.recordAssessment(db,id,{criteria:grid(5),config:null,createdBy:'operator'});
  assert.equal(unweighted.recommendation,'blocked');
  assert.equal((await db.query('SELECT weights_version FROM opportunity_assessments WHERE id=$1',[unweighted.id])).rows[0].weights_version,'keine Gewichtung');
  const list=await L.listOpportunities(db);
  assert.equal(list.length,1);
  assert.equal(list[0].title,'Küchenhelfer Nische');
  assert.deepEqual([list[0].status,list[0].latest.version,list[0].latest.recommendation],['assessed',3,'blocked']);
  await db.close();
});

test('inputs are bounded and checked; closed opportunities take no new assessment (AC-3)',async()=>{
  const db=await pgliteDatabase();
  for(const bad of [{title:''},{title:'x'.repeat(201)},{title:'ok',summary:'y'.repeat(2001)},{title:'ok',origin:'gpt'}])
    await assert.rejects(L.createOpportunity(db,{origin:'operator',...bad}),L.OpportunityInputError,JSON.stringify(bad).slice(0,60));
  const {id}=await L.createOpportunity(db,{title:'Idee',origin:'operator'});
  const ok={criteria:grid(),config:CONFIG,createdBy:'operator'};
  for(const bad of [
    {research:Array.from({length:L.MAX_RESEARCH_SOURCES+1},(_,i)=>({reference:`r${i}`}))},
    {research:[{reference:''}]},{research:[{reference:'x'.repeat(501)}]},
    {usage:{modelCalls:-1,costCents:0}},{usage:{modelCalls:1.5,costCents:0}},{usage:{modelCalls:0,costCents:Number.NaN}},
    {createdBy:'scout'},
  ])await assert.rejects(L.recordAssessment(db,id,{...ok,...bad}),L.OpportunityInputError,JSON.stringify(bad).slice(0,60));
  await assert.rejects(L.recordAssessment(db,crypto.randomUUID(),ok),/nicht gefunden/);
  await db.query("UPDATE opportunities SET status='rejected' WHERE id=$1",[id]);   // test-only: operator rejected it
  await assert.rejects(L.recordAssessment(db,id,ok),/abgeschlossen/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM opportunity_assessments')).rows[0].n,0);
  await db.close();
});

test('one opportunity per WhatsApp message; parallel assessments get distinct versions (AC-4)',async()=>{
  const db=await pgliteDatabase();
  const first=await L.createOpportunity(db,{title:'Idee',origin:'operator',sourceMessageId:'wamid.1'});
  const again=await L.createOpportunity(db,{title:'Anders',origin:'operator',sourceMessageId:'wamid.1'});
  assert.deepEqual([first.created,again.created,again.id],[true,false,first.id]);
  const other=await L.createOpportunity(db,{title:'Idee',origin:'scout'});
  assert.notEqual(other.id,first.id);
  const results=await Promise.all(Array.from({length:5},()=>L.recordAssessment(db,first.id,{criteria:grid(),config:CONFIG,createdBy:'executive'})));
  assert.deepEqual(results.map(r=>r.version).sort(),[1,2,3,4,5]);
  await db.close();
});

test('the ledger is isolated: no network, no model, no clock, no approval path, not wired into app code yet (AC-5)',()=>{
  const source=fs.readFileSync('lib/enterprise/opportunity/ledger.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../../memory/db','./economics','./scoring','node:crypto']);
  assert.doesNotMatch(source,/fetch\(|process\.env|Date\.now|new Date\(\)|recordModelCall|enterprise_decisions|DELETE|DROP|require\(|import\(/);
  const tables=[...new Set([...source.matchAll(/(?:INSERT INTO|UPDATE)\s+(\w+)/g)].map(m=>m[1]))].sort();
  assert.deepEqual(tables,['opportunities','opportunity_assessments']);
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&!full.startsWith(path.join('lib','enterprise')))walk(full);}
    else if(/\.(ts|tsx)$/.test(entry.name)&&/opportunity\/ledger/.test(fs.readFileSync(full,'utf8')))users.push(full);}};
  walk('app');walk('lib');
  assert.deepEqual(users,[]);
});
