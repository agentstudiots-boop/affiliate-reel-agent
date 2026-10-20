const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const pgliteDatabase=require('./helpers/pglite-db.cjs');
const P=require('../.test-build/lib/enterprise/controlling/price-catalog');
const {importModelCalls,repriceModelCallEntries}=require('../.test-build/lib/enterprise/controlling/import-model-calls');

// Synthetic prices only: the repository is public, these are no real provider prices.
const entry=(extra={})=>({provider:'beispiel',item:'modell-a',unit:'input_token',price:'0,000002',validFrom:'2026-10-01',
  sourceUrl:'https://example.com/preise',enteredBy:'betreiber',...extra});
const call=(db,fields)=>{const row={agent:'content_text',model:'modell-a',provider:'beispiel',ok:true,latency_ms:800,input_tokens:1000,output_tokens:null,predict_time_s:null,
  created_at:'2026-10-19T08:00:00Z',...fields};const keys=Object.keys(row);
  return db.query(`INSERT INTO model_calls(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING id`,keys.map(k=>row[k])).then(r=>Number(r.rows[0].id));};
const count=async db=>Number((await db.query('SELECT count(*) AS n FROM price_catalog')).rows[0].n);

test('prices are validated and parsed exactly, never guessed (AC-1)',async()=>{
  const db=await pgliteDatabase();
  const added=await P.addPrice(db,entry());
  assert.equal(added.status,'recorded');
  assert.deepEqual(await P.listPrices(db),[{id:added.id,provider:'beispiel',item:'modell-a',unit:'input_token',priceMicros:2,currency:'EUR',
    validFrom:'2026-09-30T22:00:00.000Z',validTo:null,sourceUrl:'https://example.com/preise',enteredBy:'betreiber'}]); // Berlin midnight
  assert.equal((await P.addPrice(db,entry({unit:'output_token',price:'1.234,5',currency:'USD',validFrom:'01.11.2026',validTo:'2026-12-01'}))).status,'recorded');
  const [, usd]=await P.listPrices(db);
  assert.deepEqual([usd.priceMicros,usd.currency,usd.validFrom,usd.validTo],[1234500000,'USD','2026-10-31T23:00:00.000Z','2026-11-30T23:00:00.000Z']);
  for(const [extra,pattern] of [[{provider:'Beispiel'},/Anbieter/],[{provider:''},/Anbieter/],[{item:' '},/Artikel/],[{item:'x'.repeat(121)},/Artikel/],
    [{unit:'token'},/Einheit/],[{unit:'toString'},/Einheit/],[{price:'0.000002'},/Preis/],[{price:'0,0000001'},/Preis/],[{price:'-1'},/Preis/],[{price:2},/Preis/],
    [{currency:'eur'},/Währung/],[{validFrom:'2026-02-30'},/Gültig ab/],[{validTo:'morgen'},/Gültig bis/],[{validTo:'2026-10-01'},/nach Gültig ab/],
    [{sourceUrl:'http://example.com'},/https/],[{sourceUrl:'https//x'},/https/],[{sourceUrl:'HTTPS://example.com/preise'},/https/],[{sourceUrl:'https://'},/https/],[{sourceUrl:null},/https/],[{enteredBy:''},/Erfasst von/],[{enteredBy:'x'.repeat(101)},/Erfasst von/]])
    assert.match((await P.addPrice(db,entry(extra))).reason,pattern,JSON.stringify(extra));
  assert.equal(await count(db),2);
  await db.close();
});

test('same price again is a duplicate; different content under the same start is rejected, not overwritten (AC-2)',async()=>{
  const db=await pgliteDatabase();
  const {id}=await P.addPrice(db,entry());
  assert.deepEqual(await P.addPrice(db,entry({enteredBy:'zweite person'})),{status:'duplicate',id});
  assert.deepEqual(await P.addPrice(db,entry({validFrom:'01.10.2026'})),{status:'duplicate',id});
  for(const extra of [{price:'0,000003'},{currency:'USD'},{sourceUrl:'https://example.com/andere'},{validTo:'2026-11-01'}])
    assert.match((await P.addPrice(db,entry(extra))).reason,/nicht überschrieben/,JSON.stringify(extra));
  assert.deepEqual((await P.listPrices(db)).map(p=>[p.priceMicros,p.validTo,p.enteredBy]),[[2,null,'betreiber']]);
  // overlapping prices of the same unit are allowed (rule of 040)
  assert.equal((await P.addPrice(db,entry({price:'0,000003',validFrom:'2026-10-15'}))).status,'recorded');
  await db.close();
});

test('one pricing basis per provider and item at a time; a switch needs the old basis ended (AC-3)',async()=>{
  const db=await pgliteDatabase();
  const tokens=await P.addPrice(db,entry());
  assert.equal((await P.addPrice(db,entry({unit:'output_token',price:'0,000008'}))).status,'recorded'); // same basis
  assert.match((await P.addPrice(db,entry({unit:'second',price:'0,001',validFrom:'2026-11-01'}))).reason,/anderer Basis bepreist \(input_token, output_token\)/);
  assert.match((await P.addPrice(db,entry({unit:'second',price:'0,001',validFrom:'2026-09-01',validTo:'2026-10-02'}))).reason,/anderer Basis/);
  assert.equal((await P.addPrice(db,entry({unit:'second',price:'0,001',validFrom:'2026-09-01',validTo:'2026-10-01'}))).status,'recorded'); // ends where tokens start
  assert.equal((await P.addPrice(db,entry({item:'modell-b',unit:'second',price:'0,001'}))).status,'recorded'); // other item
  assert.equal((await P.addPrice(db,entry({provider:'anderer',unit:'second',price:'0,001'}))).status,'recorded'); // other provider
  const output=(await P.listPrices(db,{provider:'beispiel'})).find(p=>p.unit==='output_token');
  assert.equal((await P.endPrice(db,tokens.id,'2026-11-01')).status,'recorded');
  assert.match((await P.addPrice(db,entry({unit:'second',price:'0,001',validFrom:'2026-11-01'}))).reason,/output_token/); // output still open
  assert.equal((await P.endPrice(db,output.id,'2026-11-01')).status,'recorded');
  assert.equal((await P.addPrice(db,entry({unit:'second',price:'0,001',validFrom:'2026-11-01'}))).status,'recorded');
  await db.close();
});

test('endPrice only sets a missing end after the start and never deletes (AC-4)',async()=>{
  const db=await pgliteDatabase();
  const {id}=await P.addPrice(db,entry());
  assert.match((await P.endPrice(db,id,'2026-10-01')).reason,/nach Gültig ab/);
  assert.match((await P.endPrice(db,id,'30.02.2026')).reason,/Gültig bis ungültig/);
  assert.match((await P.endPrice(db,'00000000-0000-4000-8000-000000000000','2026-11-01')).reason,/nicht gefunden/);
  assert.match((await P.endPrice(db,"x' OR 1=1 --",'2026-11-01')).reason,/nicht gefunden/);
  assert.deepEqual(await P.endPrice(db,id,'2026-11-01'),{status:'recorded',id});
  assert.match((await P.endPrice(db,id,'2026-12-01')).reason,/bereits ein Ende/);
  assert.equal((await P.listPrices(db))[0].validTo,'2026-10-31T23:00:00.000Z');
  assert.equal(await count(db),1);
  await db.close();
});

test('prices used for imported costs are not changed retroactively (AC-5)',async()=>{
  const db=await pgliteDatabase();
  const {id}=await P.addPrice(db,entry());
  await call(db,{created_at:'2026-10-19T08:00:00Z'});
  assert.equal((await importModelCalls(db)).priced,1);
  assert.match((await P.endPrice(db,id,'2026-10-15')).reason,/bereits verwendet/);
  assert.match((await P.addPrice(db,entry({price:'0,000003',validFrom:'2026-10-10'}))).reason,/rückwirkend/);
  assert.match((await P.addPrice(db,entry({price:'0,000003',validFrom:'2026-10-19',validTo:'2026-10-20'}))).reason,/rückwirkend/);
  // after the last priced cost line both are fine
  assert.equal((await P.addPrice(db,entry({price:'0,000003',validFrom:'2026-10-20'}))).status,'recorded');
  assert.equal((await P.endPrice(db,id,'2026-10-25')).status,'recorded');
  // a newer price for a unit without priced lines may start earlier (unknown amounts are filled by repricing)
  await call(db,{input_tokens:null,output_tokens:500,created_at:'2026-10-19T09:00:00Z'});
  assert.equal((await importModelCalls(db)).unpriced,1);
  assert.equal((await P.addPrice(db,entry({unit:'output_token',price:'0,000008',validFrom:'2026-10-01'}))).status,'recorded');
  assert.equal((await repriceModelCallEntries(db)).repriced,1);
  await db.close();
});

test('listPrices at a moment selects exactly the price the importer uses (PRICE_AT rule of E-03)',async()=>{
  const db=await pgliteDatabase();
  await P.addPrice(db,entry({price:'0,000001',validFrom:'2026-09-01'}));
  await P.addPrice(db,entry({price:'0,000002',validFrom:'2026-10-01'}));                    // overlaps, newer start wins
  await P.addPrice(db,entry({price:'0,000005',validFrom:'2026-10-10',validTo:'2026-10-12'})); // short promotion
  await P.addPrice(db,entry({unit:'output_token',price:'0,000008',validFrom:'2026-10-05'}));
  await P.addPrice(db,entry({provider:'anderer',price:'0,000009',validFrom:'2026-09-01'}));
  const moments=['2026-09-15T12:00:00Z','2026-09-30T21:59:59Z','2026-09-30T22:00:00Z','2026-10-04T12:00:00Z','2026-10-10T12:00:00Z',
    '2026-10-11T21:59:59Z','2026-10-11T22:00:00Z','2026-10-19T08:00:00Z'];
  for(const at of moments)await call(db,{created_at:at,output_tokens:10});
  await importModelCalls(db);
  const used=(await db.query(`SELECT c.unit, to_char(c.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, c.price_catalog_id FROM cost_entries c`)).rows;
  assert.equal(used.length,moments.length*2);
  for(const line of used){
    const listed=(await P.listPrices(db,{provider:'beispiel',at:line.at})).find(p=>p.unit===line.unit);
    assert.equal(listed?.id??null,line.price_catalog_id,`${line.unit} @ ${line.at}`);
  }
  assert.deepEqual((await P.listPrices(db,{provider:'beispiel',at:'2026-10-10T12:00:00Z'})).map(p=>[p.unit,p.priceMicros]),[['input_token',5],['output_token',8]]);
  assert.deepEqual((await P.listPrices(db,{at:'2026-09-15T12:00:00Z'})).map(p=>[p.provider,p.priceMicros]),[['anderer',9],['beispiel',1]]);
  assert.equal((await P.listPrices(db)).length,5);
  await assert.rejects(P.listPrices(db,{at:'kein datum'}),/kein gültiger Zeitpunkt/);
  await db.close();
});

test('module is isolated: writes only price_catalog, reads no clock or network, not used by app code (AC-6)',()=>{
  const source=fs.readFileSync('lib/enterprise/controlling/price-catalog.ts','utf8');
  assert.deepEqual([...source.matchAll(/from\s+"([^"]+)"/g)].map(m=>m[1]).sort(),['../../memory/db','./manual-entries','node:crypto']);
  assert.deepEqual([...new Set([...source.matchAll(/(?:INSERT INTO|UPDATE|DELETE FROM)\s+(\w+)/g)].map(m=>m[1]))],['price_catalog']);
  assert.doesNotMatch(source,/DELETE|DROP|TRUNCATE|require\(|import\(|Date\.now|new Date\(\)|process\.|fetch\(/);
  const users=[];
  const scan=full=>{if(/\.(ts|tsx|js|mjs|cjs)$/.test(full)&&/controlling\/price-catalog/.test(fs.readFileSync(full,'utf8')))users.push(full);};
  const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,item.name);
    if(item.isDirectory()){if(item.name!=='node_modules')walk(full);}else scan(full);
  }};
  walk('app');walk('lib');walk('scripts');
  for(const file of fs.readdirSync('.'))if(/\.(ts|tsx)$/.test(file))scan(file);
  assert.deepEqual(users,[]);
});
