const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {applyMigrations}=require('../.test-build/lib/memory/migrations');

const SQL=fs.readFileSync('db/migrations/040_controlling_cost_ledger.sql','utf8');
const TABLES=['price_catalog','cost_entries','revenue_entries','budgets'];
const id=()=>crypto.randomUUID();
const insert=(db,table,row)=>{const keys=Object.keys(row);
  return db.query(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>row[k]));};
const rejects=(promise,label)=>assert.rejects(promise,undefined,label);
const price=(fields={})=>({id:id(),provider:'replicate',item:'openai/gpt-4.1',unit:'input_token',price_micros:2,valid_from:'2026-10-01T00:00:00Z',
  source_url:'https://replicate.com/openai/gpt-4.1',entered_by:'operator',...fields});
const cost=(fields={})=>({id:id(),occurred_at:'2026-10-19T08:00:00Z',department:'affiliate',agent:'content_text',provider:'replicate',category:'model',
  quantity:1200,unit:'input_token',value_kind:'measured',source:'model_calls',source_ref:`model_calls:${id()}`,...fields});
const revenue=(fields={})=>({id:id(),period_start:'2026-10-01',period_end:'2026-10-31',department:'affiliate',channel:'amazon_partnernet',
  amount_cents:1234,value_kind:'measured',source:'partnernet_export',source_ref:`export:${id()}`,...fields});

test('migration is additive and idempotent; ensureAutomationSchema knows it (AC-1)',async()=>{
  assert.doesNotMatch(SQL,/\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|RENAME)\b/i);
  for(const statement of SQL.match(/CREATE (TABLE|INDEX)[^\n]*/g))assert.match(statement,/IF NOT EXISTS/,statement);
  const db=await pgliteDatabase();
  for(const table of TABLES)assert.equal((await db.query('SELECT to_regclass($1) IS NOT NULL AS ok',[`public.${table}`])).rows[0].ok,true,table);
  await db.exec(SQL);
  const again=await applyMigrations(db);
  assert.deepEqual(again.applied,[]);
  assert.ok(again.alreadyApplied.includes('040_controlling_cost_ledger.sql'));
  assert.match(fs.readFileSync('lib/memory/ensure-automation-schema.ts','utf8'),/cost_entries'\) IS NOT NULL AS controlling_ledger/);
  for(const table of TABLES)assert.equal((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n,0,`${table} is not pre-filled`);
  await db.close();
});

test('prices need a source and an author; validity is consistent (AC-2)',async()=>{
  const db=await pgliteDatabase();
  await insert(db,'price_catalog',price());
  for(const bad of [{source_url:'http://example.org'},{source_url:''},{entered_by:''},{price_micros:-1},{unit:'token'},{currency:'eur'},
    {valid_to:'2026-09-01T00:00:00Z'},{provider:'Replicate'}])await rejects(insert(db,'price_catalog',price(bad)),JSON.stringify(bad));
  await rejects(insert(db,'price_catalog',price()),'same provider/item/unit/valid_from twice');
  await db.close();
});

test('costs: amounts from usage need a price, unknown amounts stay NULL, imports are idempotent (AC-3)',async()=>{
  const db=await pgliteDatabase();
  const p=price();await insert(db,'price_catalog',p);
  await insert(db,'cost_entries',cost());                                         // usage without amount: allowed, amount unknown
  await insert(db,'cost_entries',cost({amount_micros:2400,currency:'EUR',price_catalog_id:p.id,item:'openai/gpt-4.1'})); // 0,24 Cent: kept, not rounded to 0
  assert.equal(Number((await db.query("SELECT amount_micros FROM cost_entries WHERE amount_micros IS NOT NULL")).rows[0].amount_micros),2400);
  await rejects(insert(db,'cost_entries',cost({amount_micros:1,currency:'EUR'})),'amount from usage without price');
  await rejects(insert(db,'cost_entries',cost({amount_micros:1,price_catalog_id:p.id})),'amount without currency');
  await rejects(insert(db,'cost_entries',cost({currency:'EUR'})),'currency without amount');
  await rejects(insert(db,'cost_entries',cost({value_kind:'forecast'})),'imported usage is always measured');
  await insert(db,'cost_entries',cost({source:'invoice',source_ref:'invoice:2026-10-vercel',category:'infra',amount_micros:20_000_000,currency:'USD',quantity:1,unit:'month',value_kind:'measured'}));
  await insert(db,'cost_entries',cost({source:'manual',source_ref:'manual:abo-chatgpt-2026-10',category:'subscription',amount_micros:23_000_000,currency:'EUR',quantity:1,unit:'month',value_kind:'forecast'}));
  await insert(db,'cost_entries',cost({source_ref:'model_calls:42'}));
  await rejects(insert(db,'cost_entries',cost({source_ref:'model_calls:42'})),'same model call imported twice');
  for(const bad of [{amount_micros:-5,currency:'EUR',source:'manual'},{item:''},{quantity:-1},{category:'misc'},{value_kind:'guessed'},{source:'tavily'},{department:'Affiliate'},
    {task_id:id()}])await rejects(insert(db,'cost_entries',cost(bad)),JSON.stringify(bad));
  await db.close();
});

test('revenue: measured needs an amount, periods are ordered, imports are idempotent (AC-4)',async()=>{
  const db=await pgliteDatabase();
  await insert(db,'revenue_entries',revenue());
  await insert(db,'revenue_entries',revenue({amount_cents:-300}));                // cancellation
  await insert(db,'revenue_entries',revenue({amount_cents:null,value_kind:'estimated'}));
  await rejects(insert(db,'revenue_entries',revenue({amount_cents:null})),'measured without amount');
  await rejects(insert(db,'revenue_entries',revenue({period_end:'2026-09-30'})),'end before start');
  await insert(db,'revenue_entries',revenue({source_ref:'export:2026-10'}));
  await rejects(insert(db,'revenue_entries',revenue({source_ref:'export:2026-10'})),'same export twice');
  await rejects(insert(db,'revenue_entries',revenue({source:'landing_clicks'})),'clicks are no revenue source');
  await db.close();
});

test('budgets: one per department, month and kind; approval stays explicit (AC-5)',async()=>{
  const db=await pgliteDatabase();
  const budget=(fields={})=>({id:id(),department:'opportunity',period:'2026-11',limit_cents:5000,kind:'hard',...fields});
  await insert(db,'budgets',budget());
  await insert(db,'budgets',budget({kind:'soft'}));
  await rejects(insert(db,'budgets',budget()),'second hard budget for the same month');
  for(const bad of [{period:'2026-13'},{limit_cents:-1},{kind:'flexible'},{department:''}])await rejects(insert(db,'budgets',budget(bad)),JSON.stringify(bad));
  assert.equal((await db.query("SELECT approved_decision_id FROM budgets WHERE kind='hard'")).rows[0].approved_decision_id,null,'no implicit approval');
  await db.close();
});

// Kernel modules in lib/enterprise (importer E-03) may use the ledger; their own isolation tests make sure they are not wired in.
// Since the rollout of 24.10.2026 the import cron is the one reviewed application entry point (writes via import-run.ts).
test('application code reaches the controlling ledger only through the reviewed entry points (AC-6)',()=>{
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&full!==path.join('lib','enterprise'))walk(full);}
    else if(/\.(ts|tsx)$/.test(entry.name)&&/\b(price_catalog|cost_entries|revenue_entries)\b|\b(FROM|INTO|UPDATE|JOIN|TABLE)\s+budgets\b/i.test(fs.readFileSync(full,'utf8')))users.push(full);
  }};
  walk('app');walk('lib');
  // The Command Center reads the ledger in READ ONLY transactions (snapshot.ts); model.ts only names it as text.
  assert.deepEqual(users,[path.join('app','api','cron','controlling-import','route.ts'),path.join('lib','architecture','model.ts'),path.join('lib','architecture','snapshot.ts'),path.join('lib','memory','ensure-automation-schema.ts')]);
});
