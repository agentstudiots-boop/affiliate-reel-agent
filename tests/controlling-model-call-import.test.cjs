const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const {importModelCalls,repriceModelCallEntries,amountMicros}=require('../.test-build/lib/enterprise/controlling/import-model-calls');

const call=(db,fields)=>{const row={agent:'content_text',model:'openai/gpt-4.1',provider:'replicate',ok:true,latency_ms:800,input_tokens:1000,output_tokens:200,predict_time_s:1.5,
  created_at:'2026-10-19T08:00:00Z',...fields};const keys=Object.keys(row);
  return db.query(`INSERT INTO model_calls(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING id`,keys.map(k=>row[k])).then(r=>Number(r.rows[0].id));};
const price=(db,fields)=>{const row={id:crypto.randomUUID(),provider:'replicate',item:'openai/gpt-4.1',unit:'input_token',price_micros:2,currency:'EUR',
  valid_from:'2026-10-01T00:00:00Z',source_url:'https://replicate.com/openai/gpt-4.1',entered_by:'operator',...fields};const keys=Object.keys(row);
  return db.query(`INSERT INTO price_catalog(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')})`,keys.map(k=>row[k])).then(()=>row.id);};
const lines=async db=>(await db.query('SELECT source_ref,department,item,unit,quantity::float AS quantity,amount_micros,currency,value_kind,price_catalog_id FROM cost_entries ORDER BY source_ref')).rows
  .map(r=>({...r,amount_micros:r.amount_micros===null?null:Number(r.amount_micros)}));

test('amounts are exact micro units per line, never from invalid input (AC-1)',()=>{
  assert.equal(amountMicros(1000,2),2000);         // 1000 tokens × 0.000002 EUR = 0.2 ct – kept, not rounded to 0
  assert.equal(amountMicros(1_000_000,2),2_000_000); // 2 EUR
  assert.equal(amountMicros(1.5,15_000),22_500);   // 1.5 s × 0.015 EUR = 2.25 ct
  assert.equal(amountMicros(0.3333333,3),1);       // fractional seconds round to whole micro units
  for(const [q,p] of [[-1,2],[1,-2],[NaN,1],[1,Infinity],[1e300,1e10]])assert.equal(amountMicros(q,p),null,`${q},${p}`);
});

test('many tiny calls add up to their real cost instead of 0 (review #93)',async()=>{
  const db=await pgliteDatabase();
  await price(db,{price_micros:2});await price(db,{unit:'output_token',price_micros:8});
  for(let i=0;i<100;i++)await call(db,{input_tokens:2000,output_tokens:500,predict_time_s:null,created_at:`2026-10-19T08:${String(Math.floor(i/2)).padStart(2,'0')}:00Z`});
  const result=await importModelCalls(db);
  assert.deepEqual([result.calls,result.priced,result.unpriced],[100,200,0]);
  const sum=Number((await db.query('SELECT sum(amount_micros)::bigint AS s FROM cost_entries')).rows[0].s);
  assert.equal(sum,800_000,'100 × (2000×2 + 500×8) µ = 0,80 EUR');
  await db.close();
});

test('each reported unit becomes a measured line; amounts only with a price valid at the time (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const inputPrice=await price(db,{price_micros:2});
  await price(db,{unit:'output_token',price_micros:8,valid_from:'2026-10-20T00:00:00Z'}); // not yet valid on 19 October
  const id=await call(db,{input_tokens:1_000_000,output_tokens:500_000,predict_time_s:2});
  const result=await importModelCalls(db,{departmentOf:agent=>agent.startsWith('content_')?'affiliate':null});
  assert.deepEqual(result,{calls:1,inserted:3,priced:1,unpriced:2,lastCallId:id});
  assert.deepEqual(await lines(db),[
    {source_ref:`model_calls:${id}:input_token`,department:'affiliate',item:'openai/gpt-4.1',unit:'input_token',quantity:1_000_000,amount_micros:2_000_000,currency:'EUR',value_kind:'measured',price_catalog_id:inputPrice},
    {source_ref:`model_calls:${id}:output_token`,department:'affiliate',item:'openai/gpt-4.1',unit:'output_token',quantity:500_000,amount_micros:null,currency:null,value_kind:'measured',price_catalog_id:null},
    {source_ref:`model_calls:${id}:second`,department:'affiliate',item:'openai/gpt-4.1',unit:'second',quantity:2,amount_micros:null,currency:null,value_kind:'measured',price_catalog_id:null}]);
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

test('calls younger than a minute wait for the next run, so a late commit is not skipped by the cursor (review #93)',async()=>{
  const db=await pgliteDatabase();
  const old=await call(db,{});
  const fresh=await call(db,{created_at:new Date().toISOString()});
  const first=await importModelCalls(db);
  assert.deepEqual([first.calls,first.lastCallId],[1,old]);
  await db.query("UPDATE model_calls SET created_at=now() - interval '2 minutes' WHERE id=$1",[fresh]);
  assert.equal((await importModelCalls(db,{afterId:first.lastCallId})).lastCallId,fresh);
  await db.close();
});

test('a price entered later fills only unknown amounts; known amounts never change (review #93)',async()=>{
  const db=await pgliteDatabase();
  const inputPrice=await price(db,{price_micros:2});
  await call(db,{input_tokens:1000,output_tokens:100,predict_time_s:null});
  await importModelCalls(db);
  assert.deepEqual((await lines(db)).map(l=>[l.unit,l.amount_micros]),[['input_token',2000],['output_token',null]]);
  assert.deepEqual(await repriceModelCallEntries(db),{checked:0,repriced:0},'still no output price: nothing to do');
  const outputPrice=await price(db,{unit:'output_token',price_micros:8});
  await db.query("UPDATE price_catalog SET price_micros=999 WHERE id=$1",[inputPrice]); // a changed catalogue must not rewrite booked lines
  assert.deepEqual(await repriceModelCallEntries(db),{checked:1,repriced:1});
  assert.deepEqual((await lines(db)).map(l=>[l.unit,l.amount_micros,l.currency,l.price_catalog_id]),[['input_token',2000,'EUR',inputPrice],['output_token',800,'EUR',outputPrice]]);
  assert.deepEqual(await repriceModelCallEntries(db),{checked:0,repriced:0});
  await db.close();
});

test('lines that can never be priced do not block repricing of later lines (review #93)',async()=>{
  const db=await pgliteDatabase();
  for(let i=0;i<3;i++)await call(db,{model:'unknown/model',input_tokens:10,output_tokens:null,predict_time_s:null,created_at:'2026-10-19T07:00:00Z'});
  await call(db,{input_tokens:1000,output_tokens:null,predict_time_s:null,created_at:'2026-10-19T08:00:00Z'});
  await importModelCalls(db);
  await price(db,{price_micros:2});
  assert.deepEqual(await repriceModelCallEntries(db,{limit:1}),{checked:1,repriced:1},'the old unpriceable lines are skipped');
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
  assert.doesNotMatch(source,/DELETE|process\.env|fetch\(|getDatabase/);
  assert.equal((source.match(/INSERT INTO (\w+)/g)||[]).join(),'INSERT INTO cost_entries');
  assert.equal((source.match(/UPDATE (\w+)/g)||[]).join(),'UPDATE cost_entries','only unknown amounts of cost lines are filled');
  assert.match(source,/WHERE id=\$1 AND amount_micros IS NULL RETURNING id/);
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
