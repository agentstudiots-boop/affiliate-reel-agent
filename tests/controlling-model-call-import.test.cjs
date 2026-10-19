const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {importModelCalls,amountCents}=require('../.test-build/lib/enterprise/controlling/import-model-calls');

const call=(db,fields)=>{const row={agent:'content_text',model:'openai/gpt-4.1',provider:'replicate',ok:true,latency_ms:800,input_tokens:1000,output_tokens:200,predict_time_s:1.5,
  created_at:'2026-10-19T08:00:00Z',...fields};const keys=Object.keys(row);
  return db.query(`INSERT INTO model_calls(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING id`,keys.map(k=>row[k])).then(r=>Number(r.rows[0].id));};
const price=(db,fields)=>{const row={id:crypto.randomUUID(),provider:'replicate',item:'openai/gpt-4.1',unit:'input_token',price_micros:2,currency:'EUR',
  valid_from:'2026-10-01T00:00:00Z',source_url:'https://replicate.com/openai/gpt-4.1',entered_by:'operator',...fields};const keys=Object.keys(row);
  return db.query(`INSERT INTO price_catalog(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>row[k])).then(()=>row.id);};
const lines=async db=>(await db.query('SELECT source_ref,department,unit,quantity::float AS quantity,amount_cents,value_kind,price_catalog_id FROM cost_entries ORDER BY source_ref')).rows
  .map(r=>({...r,amount_cents:r.amount_cents===null?null:Number(r.amount_cents)}));

test('amounts are computed in cents from micro prices, never from invalid input (AC-1)',()=>{
  assert.equal(amountCents(1000,2),0);            // 1000 tokens × 0.000002 EUR = 0.2 ct → 0
  assert.equal(amountCents(1_000_000,2),200);     // 2 EUR
  assert.equal(amountCents(1.5,15_000),2);        // 1.5 s × 0.015 EUR = 2.25 ct
  for(const [q,p] of [[-1,2],[1,-2],[NaN,1],[1,Infinity],[1e300,1e10]])assert.equal(amountCents(q,p),null,`${q},${p}`);
});

test('each reported unit becomes a measured line; amounts only with a price valid at the time (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const inputPrice=await price(db,{price_micros:2});
  await price(db,{unit:'output_token',price_micros:8,valid_from:'2026-10-20T00:00:00Z'}); // not yet valid on 19 October
  const id=await call(db,{input_tokens:1_000_000,output_tokens:500_000,predict_time_s:2});
  const result=await importModelCalls(db,{departmentOf:agent=>agent.startsWith('content_')?'affiliate':null});
  assert.deepEqual(result,{calls:1,inserted:3,priced:1,unpriced:2,lastCallId:id});
  assert.deepEqual(await lines(db),[
    {source_ref:`model_calls:${id}:input_token`,department:'affiliate',unit:'input_token',quantity:1_000_000,amount_cents:200,value_kind:'measured',price_catalog_id:inputPrice},
    {source_ref:`model_calls:${id}:output_token`,department:'affiliate',unit:'output_token',quantity:500_000,amount_cents:null,value_kind:'measured',price_catalog_id:null},
    {source_ref:`model_calls:${id}:second`,department:'affiliate',unit:'second',quantity:2,amount_cents:null,value_kind:'measured',price_catalog_id:null}]);
  await db.close();
});

test('missing metrics create no line; unknown or invalid departments stay unassigned (AC-3)',async()=>{
  const db=await pgliteDatabase();
  await call(db,{agent:'whatsapp_transcription',provider:'openai',input_tokens:null,output_tokens:null,predict_time_s:null});
  const mystery=await call(db,{agent:'mystery',input_tokens:10,output_tokens:null,predict_time_s:null});
  const bad=await call(db,{agent:'content_text',input_tokens:5,output_tokens:null,predict_time_s:null});
  const result=await importModelCalls(db,{departmentOf:agent=>agent==='content_text'?'Affiliate; DROP':null});
  assert.deepEqual([result.calls,result.inserted],[3,2]);
  assert.deepEqual((await lines(db)).map(l=>[l.source_ref,l.department]),[[`model_calls:${mystery}:input_token`,null],[`model_calls:${bad}:input_token`,null]]);
  await db.close();
});

test('the import is idempotent and resumable by cursor (AC-4)',async()=>{
  const db=await pgliteDatabase();
  const ids=[];for(let i=0;i<5;i++)ids.push(await call(db,{created_at:`2026-10-19T08:0${i}:00Z`}));
  const first=await importModelCalls(db,{limit:2});
  assert.deepEqual([first.calls,first.inserted,first.lastCallId],[2,6,ids[1]]);
  const rest=await importModelCalls(db,{afterId:first.lastCallId});
  assert.deepEqual([rest.calls,rest.inserted,rest.lastCallId],[3,9,ids[4]]);
  const again=await importModelCalls(db);
  assert.deepEqual([again.calls,again.inserted],[5,0],'a full re-run inserts nothing');
  assert.equal((await db.query('SELECT count(*)::int AS n FROM cost_entries')).rows[0].n,15);
  assert.deepEqual(await importModelCalls(db,{afterId:ids[4]}),{calls:0,inserted:0,priced:0,unpriced:0,lastCallId:null});
  for(const limit of [0,-5,5000,NaN])assert.ok((await importModelCalls(db,{limit})).calls<=1000);
  await db.close();
});

test('only cost_entries is written; model_calls stays untouched; not wired into app code (AC-5)',async()=>{
  const db=await pgliteDatabase();
  await call(db,{});
  const before=(await db.query('SELECT * FROM model_calls')).rows;
  await importModelCalls(db);
  assert.deepEqual((await db.query('SELECT * FROM model_calls')).rows,before);
  const source=fs.readFileSync('lib/enterprise/controlling/import-model-calls.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../../memory/db','node:crypto']);
  assert.doesNotMatch(source,/UPDATE|DELETE|process\.env|fetch\(|getDatabase/);
  assert.equal((source.match(/INSERT INTO (\w+)/g)||[]).join(),'INSERT INTO cost_entries');
  const users=[];
  const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()){if(entry.name!=='node_modules'&&!full.startsWith(path.join('lib','enterprise')))walk(full);}
    else if(/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)&&/import-model-calls/.test(fs.readFileSync(full,'utf8')))users.push(full);
  }};
  walk('app');walk('lib');
  assert.deepEqual(users,[]);
  await db.close();
});
