// Controlling run (cron /api/cron/controlling-import): books model_calls once, continues from the ledger cursor, skips while
// another run holds the lock, applies prices entered later, never assumes a price and stays off without its switch.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {runControllingImport,ledgerCursor}=require('../.test-build/lib/enterprise/controlling/import-run');
const {switchOn,switchValue,switchSource,ROLLOUT}=require('../.test-build/lib/config/rollout');

const call=(db,fields)=>{const row={agent:'content_text',model:'openai/gpt-4.1',provider:'replicate',ok:true,latency_ms:800,input_tokens:1000,output_tokens:200,
  predict_time_s:null,created_at:'2026-10-19T08:00:00Z',...fields};const keys=Object.keys(row);
  return db.query(`INSERT INTO model_calls(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING id`,keys.map(k=>row[k])).then(r=>Number(r.rows[0].id));};
const lines=async db=>Number((await db.query("SELECT count(*)::int AS n FROM cost_entries WHERE source='model_calls'")).rows[0].n);

test('a run books every reported unit once, assigns the department and leaves unknown prices unknown',async()=>{
  const db=await pgliteDatabase();
  await call(db,{});await call(db,{agent:'opportunity_research',input_tokens:null,output_tokens:null,predict_time_s:2.5});await call(db,{agent:'unbekannt_neu'});
  const first=await runControllingImport(db);
  assert.equal(first.status,'ok');assert.equal(first.inserted,5);assert.equal(first.unpriced,5);assert.equal(first.priced,0);
  const rows=(await db.query("SELECT agent,department,amount_micros,currency FROM cost_entries ORDER BY source_ref")).rows;
  assert.ok(rows.every(row=>row.amount_micros===null&&row.currency===null),'no price ⇒ unknown, never 0');
  assert.deepEqual([...new Set(rows.map(row=>`${row.agent}:${row.department}`))].sort(),['content_text:affiliate','opportunity_research:opportunity','unbekannt_neu:null']);
  const second=await runControllingImport(db);
  assert.equal(second.inserted,0);assert.equal(second.cursorFrom,await ledgerCursor(db));assert.equal(await lines(db),5);
  await db.close();
});

test('the cursor continues after the last booked call; more than one batch is read in one run',async()=>{
  const db=await pgliteDatabase();
  for(let i=0;i<25;i++)await call(db,{output_tokens:null});
  const run=await runControllingImport(db,{batchSize:10});
  assert.equal(run.batches,3);assert.equal(run.inserted,25);
  const later=await call(db,{output_tokens:null});
  const next=await runControllingImport(db,{batchSize:10});
  assert.equal(next.inserted,1);assert.equal(next.cursorTo,later);
  await db.close();
});

test('a run skips while another run holds the import lock and books nothing twice',async()=>{
  const db=await pgliteDatabase();
  await call(db,{});
  const locked={...db,transaction:fn=>db.transaction(sql=>fn({...sql,query:(q,v)=>/pg_try_advisory_xact_lock/.test(q)?Promise.resolve({rows:[{ok:false}]}):sql.query(q,v)}))};
  const skipped=await runControllingImport(locked);
  assert.equal(skipped.status,'skipped');assert.equal(await lines(db),0);
  await db.close();
});

test('a price entered later fills only the unknown amounts',async()=>{
  const db=await pgliteDatabase();
  await call(db,{});
  await runControllingImport(db);
  await db.query(`INSERT INTO price_catalog(id,provider,item,unit,price_micros,currency,valid_from,source_url,entered_by)
    VALUES($1,'replicate','openai/gpt-4.1','input_token',2,'USD','2026-10-01T00:00:00Z','https://replicate.com/openai/gpt-4.1','operator')`,[crypto.randomUUID()]);
  const run=await runControllingImport(db);
  assert.equal(run.repriced,1);
  const rows=(await db.query("SELECT unit,amount_micros,currency FROM cost_entries ORDER BY unit")).rows;
  assert.deepEqual(rows.map(r=>[r.unit,r.amount_micros===null?null:Number(r.amount_micros),r.currency]),[['input_token',2000,'USD'],['output_token',null,null]]);
  await db.close();
});

test('rollout switch: on by rollout (27.10.2026), environment wins in both directions („false“ is the emergency stop)',()=>{
  assert.equal(ROLLOUT.CONTROLLING_IMPORT_ENABLED,'true');
  assert.equal(switchOn('CONTROLLING_IMPORT_ENABLED',{}),true);
  assert.equal(switchOn('CONTROLLING_IMPORT_ENABLED',{CONTROLLING_IMPORT_ENABLED:'false'}),false,'emergency stop without a code deployment');
  assert.equal(switchOn('CONTROLLING_IMPORT_ENABLED',{CONTROLLING_IMPORT_ENABLED:'true'}),true);
  assert.equal(switchSource('CONTROLLING_IMPORT_ENABLED',{}),'rollout');
  assert.equal(switchSource('CONTROLLING_IMPORT_ENABLED',{CONTROLLING_IMPORT_ENABLED:'false'}),'env');
  assert.equal(switchValue('UNKNOWN_SWITCH',{}),undefined);assert.equal(switchOn('UNKNOWN_SWITCH',{}),false);
});

test('the cron route checks the secret first, then the switch, then the environment guard',()=>{
  const source=fs.readFileSync('app/api/cron/controlling-import/route.ts','utf8');
  const order=['timingSafeEqual','switchOn("CONTROLLING_IMPORT_ENABLED")','effectDecision("scheduled_job")','runControllingImport('].map(s=>source.indexOf(s));
  assert.ok(order.every((pos,i)=>pos>0&&(i===0||pos>order[i-1])),String(order));
  const crons=JSON.parse(fs.readFileSync('vercel.json','utf8')).crons.filter(c=>c.path==='/api/cron/controlling-import');
  assert.equal(crons.length,1);
});

// Rollout 27.10.2026: the real cron and price routes with only their I/O replaced.
const loadRoute=require('./helpers/load-route.cjs');
const withEnv=async(env,fn)=>{const saved={};for(const k of Object.keys(env)){saved[k]=process.env[k];if(env[k]===undefined)delete process.env[k];else process.env[k]=env[k];}
  try{return await fn();}finally{for(const k of Object.keys(saved)){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}}};
function cronRoute(db,guard){
  const calls={db:0};
  const mod=loadRoute('app/api/cron/controlling-import/route.ts',{'@/lib/memory/db':{getDatabase:()=>{calls.db++;return db;}},
    ...(guard?{'@/lib/security/runtime-guard':{effectDecision:()=>({ok:true})}}:{})});
  const get=(secret='s3cret')=>mod.GET(new Request('https://example.test/api/cron/controlling-import',{headers:{authorization:`Bearer ${secret}`}}));
  return {get,calls};
}

test('cron route after the rollout: imports in production; "false" in the environment stops it without database access; preview never runs',async()=>{
  const db=await pgliteDatabase();
  await call(db,{});
  const info=console.info;console.info=()=>{};
  try{
    await withEnv({CRON_SECRET:'s3cret',CONTROLLING_IMPORT_ENABLED:'false'},async()=>{
      const {get,calls}=cronRoute(db,true);
      assert.equal((await get('wrong')).status,401);
      assert.deepEqual(await (await get()).json(),{status:'disabled'});
      assert.equal(calls.db,0);
    });
    await withEnv({CRON_SECRET:'s3cret',CONTROLLING_IMPORT_ENABLED:undefined,VERCEL_ENV:'preview'},async()=>{
      const {get,calls}=cronRoute(db,false);
      assert.deepEqual(await (await get()).json(),{status:'skipped_non_production_environment'});
      assert.equal(calls.db,0);
    });
    await withEnv({CRON_SECRET:'s3cret',CONTROLLING_IMPORT_ENABLED:undefined},async()=>{
      const {get}=cronRoute(db,true);
      const body=await (await get()).json();
      assert.equal(body.inserted,2,'rollout value on: one line per token unit');
      assert.equal((await (await get()).json()).inserted,0,'idempotent on the next run');
    });
  }finally{console.info=info;}
  assert.equal(await lines(db),2);
  await db.close();
});

test('price route: JSON that is not an object is a bad request (400), not a catalogue failure',async()=>{
  const db=await pgliteDatabase();
  const mod=loadRoute('app/api/controlling/prices/route.ts',{'@/lib/memory/auth':{authorized:()=>true,unauthorizedResponse:()=>new Response('',{status:401})},
    '@/lib/memory/db':{databaseConfigured:()=>true,getDatabase:()=>db}});
  for(const raw of ['null','42','"add"','[]'])
    assert.equal((await mod.POST(new Request('https://example.test/api/controlling/prices',{method:'POST',body:raw}))).status,400,raw);
  assert.equal((await mod.POST(new Request('https://example.test/api/controlling/prices',{method:'POST',body:'{"action":"nope"}'}))).status,400);
  await db.close();
});
