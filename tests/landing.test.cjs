const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {loadPublishedProducts,shortName,categoryLabel,excerpt}=require('../.test-build/lib/landing/published');

async function fixture(t){
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  let n=0;
  const add=async({status='published',category='household',name='Silikon Backmatte',affiliate='https://www.amazon.de/dp/B000000001?tag=alltaeglichle-21',image=true,caption='Fertiger Beitragstext.',publishedAt,updatedAt='2026-09-20T10:00:00Z'}={})=>{
    n++;const id=crypto.randomUUID();
    await pg.query("INSERT INTO products(id,name,source_url) VALUES($1,$2,'https://www.amazon.de/dp/B000000001')",[`p${n}`,name]);
    const opportunity={product:{name,affiliateUrl:affiliate,asin:'B000000001'}};
    await pg.query(`INSERT INTO content_jobs(id,product_id,category,use_case_key,goal,target_platform,trend,opportunity,status,snapshot,created_at,updated_at)
      VALUES($1,$2,$3,'k','post','facebook','t',$4,'approved',$5,now(),now())`,[id,`p${n}`,category,JSON.stringify(opportunity),JSON.stringify({opportunity})]);
    const request=crypto.randomUUID();
    await pg.query(`INSERT INTO publication_requests(id,job_id,platform,status,caption,image_url,content_hash,approver_wa_id,whatsapp_message_id,meta_post_id,permalink,updated_at)
      VALUES($1,$2,'facebook',$3,$4,$5,'hash','491234',$6,$7,'https://www.facebook.com/x/posts/1',$8)`,
      [request,id,status,caption,image?`https://s.public.blob.vercel-storage.com/generated/facebook/${id}/${'a'.repeat(64)}.png`:null,`wamid.${n}`,`meta${n}`,updatedAt]);
    if(publishedAt)await pg.query("INSERT INTO publications(id,job_id,platform,status,url,published_at) VALUES($1,$2,'facebook','published','https://www.facebook.com/x/posts/1',$3)",[crypto.randomUUID(),id,publishedAt]);
    return {id,request};
  };
  return {pg,add,db:{query:(q,v)=>pg.query(q,v)}};
}

test('only published Facebook products are shown, newest publication first, with stored image, final caption and saved affiliate link',async t=>{
  const f=await fixture(t);
  await f.add({name:'Älteres Produkt',publishedAt:'2026-09-25T08:00:00Z',caption:'Text alt'});
  await f.add({name:'Neueres Produkt',publishedAt:'2026-09-30T08:00:00Z',caption:'Text neu\nzweite Zeile',affiliate:'https://www.amazon.de/dp/B000000002?tag=alltaeglichle-21'});
  await f.add({name:'Ohne publications-Zeile',updatedAt:'2026-09-27T08:00:00Z'});
  for(const status of ['pending','approved','publishing','unknown','rejected','changes_requested','preparing'])await f.add({name:`Nicht veröffentlicht ${status}`,status,publishedAt:'2026-10-01T08:00:00Z'});
  const {items}=await loadPublishedProducts(f.db);
  assert.deepEqual(items.map(item=>item.name),['Neueres Produkt','Ohne publications-Zeile','Älteres Produkt']);
  assert.equal(items[0].excerpt,'Text neu zweite Zeile');
  assert.equal(items[0].affiliateUrl,'https://www.amazon.de/dp/B000000002?tag=alltaeglichle-21');
  assert.match(items[0].imageUrl,/^https:\/\/s\.public\.blob\.vercel-storage\.com\/generated\/facebook\//);
  // Only the fields the page needs leave the database layer: no approver, message ids, hashes or post ids.
  assert.deepEqual(Object.keys(items[0]).sort(),['affiliateUrl','category','categoryLabel','contentId','excerpt','id','imageUrl','name','publishedAt']);
  assert.match(items[0].contentId,/^[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(items).match(/491234|wamid|meta\d|hash/));
});

test('entries without a usable image or a valid tagged Amazon product link are not shown',async t=>{
  const f=await fixture(t);
  await f.add({name:'Gut'});
  await f.add({name:'Ohne Bild',image:false});
  await f.add({name:'Ohne Tag',affiliate:'https://www.amazon.de/dp/B000000003'});
  await f.add({name:'Suchseite',affiliate:'https://www.amazon.de/s?k=matte&tag=alltaeglichle-21'});
  await f.add({name:'Fremde Domain',affiliate:'https://evil.example/dp/B000000004?tag=alltaeglichle-21'});
  await f.add({name:'Leerer Link',affiliate:''});
  await f.add({name:'Leerer Text',caption:''});
  const {items}=await loadPublishedProducts(f.db);
  assert.deepEqual(items.map(item=>item.name),['Gut']);
});

test('category filter uses the stored job category; categories list only what exists',async t=>{
  const f=await fixture(t);
  await f.add({name:'A',category:'household',publishedAt:'2026-09-25T08:00:00Z'});
  await f.add({name:'B',category:'home_living',publishedAt:'2026-09-26T08:00:00Z'});
  await f.add({name:'C',category:'household',publishedAt:'2026-09-27T08:00:00Z'});
  const all=await loadPublishedProducts(f.db);
  assert.deepEqual(all.categories.map(c=>c.value).sort(),['home_living','household']);
  assert.deepEqual(all.categories.find(c=>c.value==='home_living'),{value:'home_living',label:'Home & Living'});
  const household=await loadPublishedProducts(f.db,'household');
  assert.deepEqual(household.items.map(item=>item.name),['C','A']);
  assert.equal((await loadPublishedProducts(f.db,'technology')).items.length,0);
  assert.equal(categoryLabel('unbekannt'),'unbekannt');
});

test('headings are short, decoded and repaired Amazon titles',()=>{
  assert.equal(shortName('Silikon Backmatte Backunterlage Backofen Matte - Backen Knusprig Backformhundekekse HitzebestäNdig Mit Pyramiden Noppen Leicht Zu Reinigen Wiederverwendbar FüR').length<=66,true);
  assert.match(shortName('Silikon Backmatte Backunterlage Backofen Matte - Backen Knusprig Backformhundekekse HitzebestäNdig Mit Pyramiden Noppen'),/ …$/);
  assert.equal(shortName('Tortillapresse 10&#34; Orange &amp; Co'),'Tortillapresse 10" Orange & Co');
});

test('the excerpt is only a truncation of the approved caption: no links, no disclosure line, nothing added',()=>{
  const caption='Backen ohne Sauerei – so bleibt die Küche blitzsauber.\nWerbung | Affiliate-Link\nProdukt direkt ansehen: https://www.amazon.de/dp/B0CM14MKY8?tag=alltaeglichle-21\n\nMit einer Silikon-Backmatte bleibt die Küche beim Backen sauber. Ideal für alle, die Backen lieben, aber Putzen nicht! Noch ein weiterer Satz, der den Auszug über die Länge hinaus verlängert und abgeschnitten wird.\n\nJetzt entdecken!';
  const text=excerpt(caption);
  assert.ok(text.length<=181);assert.ok(!/https?:|Werbung|Affiliate|ansehen/i.test(text));
  const source=new Set(caption.split(/\s+/));for(const word of text.replace(/ …$/,'').split(/\s+/))assert.ok(source.has(word),`word from the approved text: ${word}`);
  assert.equal(excerpt('Kurzer Text.'),'Kurzer Text.');
  assert.match(excerpt('Wort '.repeat(80)),/ …$/);
});

test('click counting: only published items count, the target is never taken from the request, foreign origins are refused, failures stay silent',async t=>{
  const loadRoute=require('./helpers/load-route.cjs');
  const f=await fixture(t);
  const published=await f.add({name:'Veröffentlicht',publishedAt:'2026-09-30T08:00:00Z'});
  const pending=await f.add({name:'Nicht veröffentlicht',status:'pending'});
  const db={query:(q,v)=>f.pg.query(q,v),exec:q=>f.pg.exec(q),transaction:fn=>f.pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const route=loadRoute('app/api/landing/click/route.ts',{'@/lib/memory/db':{getDatabase:()=>db}});
  const post=(body,headers={})=>route.POST(new Request('https://studio.example/api/landing/click',{method:'POST',headers,body:typeof body==='string'?body:JSON.stringify(body)}));
  assert.equal((await post({id:published.request},{origin:'https://studio.example'})).status,204);
  assert.equal((await post({id:published.request})).status,204);
  const rows=(await f.pg.query('SELECT publication_id,job_id FROM landing_clicks')).rows;
  assert.equal(rows.length,2);assert.deepEqual(rows[0],{publication_id:published.request,job_id:published.id});
  assert.equal((await post({id:pending.request})).status,204);
  assert.equal((await post({id:'not-a-uuid'})).status,204);
  assert.equal((await post('{"id":'+'1'.repeat(300)+'}')).status,204);
  assert.equal((await post('not json')).status,204);
  assert.equal((await post({id:published.request,url:'https://evil.example'})).status,204);
  assert.equal((await post({id:published.request},{origin:'https://evil.example'})).status,403);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM landing_clicks')).rows[0].n,3,'only valid published ids on the own origin were counted');
  assert.deepEqual(Object.keys((await f.pg.query('SELECT * FROM landing_clicks')).rows[0]).sort(),['clicked_at','id','job_id','publication_id'],'no IP, agent or other personal data is stored');
});
