const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {reserveProduct,productFamily}=require('../.test-build/lib/daily/product-lock');

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
