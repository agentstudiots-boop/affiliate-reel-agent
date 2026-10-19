const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {departmentForAgent}=require('../.test-build/lib/enterprise/controlling/agent-departments');
const {readControllingSnapshot,berlinMonth,controllingSnapshotSchema}=require('../.test-build/lib/enterprise/controlling/snapshot');

const NOW=new Date('2026-11-15T12:00:00Z');
const insert=(db,table,row)=>{const keys=Object.keys(row);return db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>row[k]));};
const call=(db,fields)=>insert(db,'model_calls',{agent:'content_text',model:'openai/gpt-4.1',provider:'replicate',ok:true,latency_ms:500,input_tokens:100,output_tokens:20,predict_time_s:1,created_at:'2026-11-10T08:00:00Z',...fields});
// Cost amounts in micro units (1 ct = 10 000 µ); a currency only with a known amount (migration 040).
const cost=(db,fields)=>{const row={id:crypto.randomUUID(),occurred_at:'2026-11-10T08:00:00Z',department:'affiliate',provider:'replicate',category:'model',quantity:1,unit:'request',
  value_kind:'measured',source:'manual',source_ref:`manual:${crypto.randomUUID()}`,...fields};
  if(!('currency' in fields))row.currency=row.amount_micros==null?null:'EUR';return insert(db,'cost_entries',row);};
const revenue=(db,fields)=>insert(db,'revenue_entries',{id:crypto.randomUUID(),period_start:'2026-11-01',period_end:'2026-11-30',department:'affiliate',channel:'amazon_partnernet',
  amount_cents:1500,value_kind:'measured',source:'manual',source_ref:`manual:${crypto.randomUUID()}`,...fields});
const dept=(snap,id)=>snap.departments.find(d=>d.department===id);

test('Berlin month boundaries (AC-1)',()=>{
  assert.deepEqual(berlinMonth(new Date('2026-10-31T23:30:00Z')).period,'2026-11');
  assert.deepEqual(berlinMonth(new Date('2026-12-31T23:30:00Z')).period,'2027-01');
  assert.match(berlinMonth(NOW).start,/^2026-11-01 00:00:00 Europe\/Berlin$/);
});

test('empty ledger: every department visible, no invented numbers (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const snap=await readControllingSnapshot(db,NOW);
  assert.equal(controllingSnapshotSchema.safeParse(snap).success,true);
  assert.deepEqual(snap.parts,{modelUsage:'ok',costs:'ok',revenue:'ok'});
  assert.equal(snap.departments.length,5);
  const a=dept(snap,'affiliate');
  assert.deepEqual(a.costs.measured,{amountCents:null,entries:0,unknownAmountEntries:0,complete:true},'no amount is null, not 0');
  assert.deepEqual(a.revenue.measured.amountCents,null);
  assert.equal(a.modelUsage.calls,0);
  assert.deepEqual(snap.sources.map(s=>s.table),['model_calls','cost_entries','revenue_entries']);
  await db.close();
});

test('sums per department and kind; unknown amounts make a sum a lower bound (AC-3)',async()=>{
  const db=await pgliteDatabase();
  await call(db,{});await call(db,{ok:false});await call(db,{agent:'executive_planner'});await call(db,{agent:'mystery'});
  await call(db,{input_tokens:null});                                   // incomplete metrics
  await call(db,{created_at:'2026-10-31T22:30:00Z'});                   // 31.10. 23:30 Berlin → previous month
  await cost(db,{amount_micros:1_996_000,source:'invoice',source_ref:'invoice:a'});
  for(let i=0;i<10;i++)await cost(db,{amount_micros:400});             // ten sub-cent lines: 4 000 µ = 0,4 ct together
  await cost(db,{amount_micros:null});                                  // usage without price
  await cost(db,{amount_micros:9_000_000,currency:'USD',source:'invoice',source_ref:'invoice:usd'}); // not converted ⇒ unknown
  await cost(db,{amount_micros:5_000_000,value_kind:'forecast',source:'manual'});
  await cost(db,{department:null,amount_micros:700_000});               // unassigned
  await cost(db,{amount_micros:9_990_000,occurred_at:'2026-10-20T08:00:00Z'}); // previous month
  await revenue(db,{});await revenue(db,{amount_cents:-300});await revenue(db,{amount_cents:null,value_kind:'estimated'});
  await revenue(db,{period_start:'2026-10-01',period_end:'2026-10-31'});
  const snap=await readControllingSnapshot(db,NOW);
  const a=dept(snap,'affiliate');
  assert.deepEqual([a.modelUsage.calls,a.modelUsage.failures,a.modelUsage.usageComplete],[3,1,false]);
  // executive_planner is mapped to executive only with B-08 (E-06 register); without that mapping it is listed as unassigned.
  // Never guessed either way – the expectation follows the reviewed register, so the test holds before and after B-08.
  const planner=departmentForAgent('executive_planner');
  assert.equal(dept(snap,'executive').modelUsage.calls,planner==='executive'?1:0);
  assert.deepEqual(snap.unassigned.modelUsage.agents.sort(),planner?['mystery']:['executive_planner','mystery']);
  assert.deepEqual(a.costs.measured,{amountCents:200,entries:13,unknownAmountEntries:2,complete:false},'1 996 000 µ + 10 × 400 µ = 200 ct; no price and USD unknown');
  assert.equal(snap.currency,'EUR');
  assert.deepEqual(a.costs.forecast,{amountCents:500,entries:1,unknownAmountEntries:0,complete:true});
  assert.deepEqual(snap.unassigned.costs.measured.amountCents,70);
  assert.deepEqual(a.revenue.measured,{amountCents:1200,entries:2,unknownAmountEntries:0,complete:true});
  assert.deepEqual(a.revenue.estimated,{amountCents:null,entries:1,unknownAmountEntries:1,complete:false});
  await db.close();
});

test('missing tables make their part unavailable instead of zero; reads are read-only (AC-4)',async()=>{
  const statements=[];
  const fake={query:async()=>({rows:[]}),exec:async()=>{},transaction:async fn=>fn({query:async(text)=>{statements.push(text.trim().split(/\s+/)[0]);
    return {rows:/to_regclass/.test(text)?[{ok:false}]:[]};},exec:async()=>{}})};
  const snap=await readControllingSnapshot(fake,NOW);
  assert.deepEqual(snap.parts,{modelUsage:'unavailable',costs:'unavailable',revenue:'unavailable'});
  assert.equal(dept(snap,'affiliate').costs,null);
  assert.equal(statements[0],'SET');
  assert.ok(statements.slice(1).every(s=>s==='SELECT'),statements.join(','));
});

test('pure read module; only the read-only operations overview uses it (AC-5)',()=>{
  const source=fs.readFileSync('lib/enterprise/controlling/snapshot.ts','utf8');
  assert.match(source,/SET TRANSACTION READ ONLY/);
  assert.doesNotMatch(source,/\b(INSERT|UPDATE|DELETE)\b|process\.env|fetch\(|getDatabase/);
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&!full.startsWith(path.join('lib','enterprise')))walk(full);}
    else if(/\.(ts|tsx)$/.test(entry.name)&&/controlling\/snapshot/.test(fs.readFileSync(full,'utf8')))users.push(full);}};
  walk('app');walk('lib');
  // Only the read-only operations overview (E-07 display) uses the contract.
  assert.deepEqual(users,[path.join('lib','reporting','operations.ts')]);
});

test('operations overview carries the controlling contract (AC-6)',async()=>{
  const {getOperationsSnapshot}=require('../.test-build/lib/reporting/operations');
  const db=await pgliteDatabase();
  const snap=await getOperationsSnapshot(db);
  assert.equal(controllingSnapshotSchema.safeParse(snap.controlling).success,true);
  assert.deepEqual(snap.controlling.parts,{modelUsage:'ok',costs:'ok',revenue:'ok'});
  const panel=fs.readFileSync('app/operations-panel.tsx','utf8');
  for(const text of ['keine Daten','unbekannt','mind. ','nicht verfügbar'])assert.ok(panel.includes(text),text);
  await db.close();
});
