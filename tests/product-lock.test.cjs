const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {reserveProduct,productFamily}=require('../.test-build/lib/daily/product-lock');
const loadRoute=require('./helpers/load-route.cjs');

test('seven-day reservations block exact ASIN and narrow family before planning',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())
    await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v)}))};
  const product=(name,asin)=>({name,asin,sourceUrl:`https://www.amazon.de/dp/${asin}`});
  const first=crypto.randomUUID(),second=crypto.randomUUID();
  assert.equal(productFamily('Kürbis Schnitzset'),'pumpkin_carving_kit');
  assert.equal(await reserveProduct(db,product('Kürbis Schnitzset','B000000001'),first),true);
  assert.equal(await reserveProduct(db,product('Kürbis Schnitzset','B000000001'),second),false);
  assert.equal(await reserveProduct(db,product('Pumpkin Carving Kit','B000000002'),second),false);
  assert.equal(await reserveProduct(db,product('Saugroboter','B000000003'),second),true);
  await pg.query("UPDATE product_selection_locks SET expires_at=now()-interval '1 minute' WHERE job_id=$1",[first]);
  assert.equal(await reserveProduct(db,product('Kürbis Schnitzset','B000000001'),second),true);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM content_jobs')).rows[0].n,0);
});

test('publication time extends the seven-day block; an older pending draft still blocks',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())
    await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v)}))};
  const prior=crypto.randomUUID(),publication=crypto.randomUUID(),next=crypto.randomUUID();
  const item={name:'Saugroboter Modell R',asin:'B000000010',sourceUrl:'https://www.amazon.de/dp/B000000010'};
  await pg.query('INSERT INTO products(id,name,source_url) VALUES($1,$2,$3)',[item.asin,item.name,item.sourceUrl]);
  await pg.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,
    opportunity,status,snapshot,created_at,updated_at)
    VALUES($1,$2,'household','robot-vacuum','education','facebook','',$3,'approved','{}',
    now()-interval '9 days',now()-interval '9 days')`,
    [prior,item.asin,JSON.stringify({product:item})]);
  await pg.query(`INSERT INTO publications(id,job_id,platform,status,url,published_at)
    VALUES($1,$2,'facebook','published','https://www.facebook.com/example',now()-interval '6 days')`,
    [publication,prior]);
  assert.equal(await reserveProduct(db,item,next),false);
  await pg.query("UPDATE publications SET published_at=now()-interval '8 days' WHERE id=$1",[publication]);
  assert.equal(await reserveProduct(db,item,next),true);

  const pending=crypto.randomUUID(),other=crypto.randomUUID();
  const pendingProduct={name:'Vakuumierer Modell X',asin:'B000000011',sourceUrl:'https://www.amazon.de/dp/B000000011'};
  await pg.query('INSERT INTO products(id,name,source_url) VALUES($1,$2,$3)',
    [pendingProduct.asin,pendingProduct.name,pendingProduct.sourceUrl]);
  await pg.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,
    opportunity,status,snapshot,created_at,updated_at)
    VALUES($1,$2,'kitchen','vacuum-sealer','education','facebook','',$3,'awaiting_approval','{}',
    now()-interval '20 days',now()-interval '20 days')`,
    [pending,pendingProduct.asin,JSON.stringify({product:pendingProduct})]);
  assert.equal(await reserveProduct(db,pendingProduct,other),false);
});

test('TrendScout omits cooldown products before presenting suggestions',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())
    await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v)}))};
  const blocked={name:'Kürbis Schnitzset A',asin:'B000000001',sourceUrl:'https://www.amazon.de/dp/B000000001'};
  const sameFamily={name:'Pumpkin Carving Kit B',asin:'B000000002',sourceUrl:'https://www.amazon.de/dp/B000000002'};
  const fresh={name:'Kuscheldecke Modell C',asin:'B000000003',sourceUrl:'https://www.amazon.de/dp/B000000003'};
  assert.equal(await reserveProduct(db,blocked,crypto.randomUUID()),true);
  const candidates=[blocked,sameFamily,fresh].map(p=>({name:p.name,searchQuery:p.name,targetGroup:'Haushalte',kind:p===fresh?'Dauerläufer':'Saisontrend'}));
  const lookups=[];
  const scout=loadRoute('lib/orchestrator.ts',{
    '@/lib/agents/product-scout':{scoutProducts:async()=>({output:{candidates},sources:[]})},
    '@/lib/product-resolver':{findAmazonProduct:async name=>{lookups.push(name);return [blocked,sameFamily,fresh].find(p=>p.name===name)}},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/agents/product-reviewer':{},
    '@/lib/agents/script-writer':{},
    '@/lib/content/orchestrator':{},
  });
  const report=await scout.runProductScout();
  assert.deepEqual(report.candidates.map(c=>c.name),[fresh.name]);
  assert.deepEqual(lookups,[fresh.name]);
  assert.equal(report.cooldownBlocked,2);
  assert.equal(report.cooldownBlockedSeasonal,2);
  assert.equal(report.cooldownBlockedAutomatic,2);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM content_jobs')).rows[0].n,0);
});

test('scout rotates diverse unblocked families by daily slot within the existing lookup budget',async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())
    await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v)}))};
  const blocked={name:'Kürbis Schnitzset',asin:'B000000001',sourceUrl:'https://www.amazon.de/dp/B000000001'};
  assert.equal(await reserveProduct(db,blocked,crypto.randomUUID()),true);
  const names=['Kürbis Schnitzset','Silikon Backmatte','Messbecher mit Skala','Wäschekorb mit Griffen',
    'LED Schreibtischlampe','Edelstahl Trinkflasche','Brotdose mit Fächern','Duschabzieher','Gartenhandschuhe'];
  const candidates=names.map((name,i)=>({name,searchQuery:name,targetGroup:'Haushalte',kind:i?'Dauerläufer':'Saisontrend'}));
  const lookups=[];
  const scout=loadRoute('lib/orchestrator.ts',{
    '@/lib/agents/product-scout':{scoutProducts:async()=>({output:{candidates},sources:[]})},
    '@/lib/product-resolver':{findAmazonProduct:async name=>{lookups.push(name);const asin=`B${String(names.indexOf(name)+1).padStart(9,'0')}`;
      return {name,asin,sourceUrl:`https://www.amazon.de/dp/${asin}`}}},
    '@/lib/memory/db':{getDatabase:()=>db},
    '@/lib/agents/product-reviewer':{},'@/lib/agents/script-writer':{},'@/lib/content/orchestrator':{},
  });
  const first=await scout.runProductScout(undefined,'2026-09-30:morning');
  assert.equal(first.cooldownBlocked,1);
  assert.equal(first.candidates.length,5);
  assert.equal(lookups.length,5);
  assert.ok(!lookups.includes(blocked.name));
  const firstOrder=[...lookups];lookups.length=0;
  const second=await scout.runProductScout(undefined,'2026-09-30:afternoon');
  assert.equal(second.candidates.length,5);
  assert.equal(lookups.length,5);
  assert.notDeepEqual(lookups,firstOrder);
});
