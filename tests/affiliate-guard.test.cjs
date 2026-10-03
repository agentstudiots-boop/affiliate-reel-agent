const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const G=require('../.test-build/lib/affiliate-guard');
const A=require('../.test-build/lib/amazon');
const {runContentJob}=require('../.test-build/lib/content/orchestrator');
const {memoryRepository}=require('../.test-build/lib/memory/repository');
const {verifyAmazonProductPage}=require('../.test-build/lib/product-resolver');
const {asinFromOperatorLink}=require('../.test-build/lib/whatsapp/product-link');

const ASIN='B0DB22FD87';
const affiliate=`https://www.amazon.de/dp/${ASIN}?tag=alltaeglichle-21`;
const detail=`https://www.amazon.de/dp/${ASIN}`;
const product=()=>({name:'Silikon Backmatte',productVerifiedName:'Silikon Backmatte',productVerifiedAt:'2026-09-26T08:00:00.000Z',price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:'',
  ...A.bindAmazonProduct({name:'Silikon Backmatte',sourceUrl:detail,affiliateUrl:'',price:'',targetGroup:'Haushalte',benefits:'Eigenschaften vor Kauf prüfen',notes:''})});
const noNetwork=t=>{const calls=[];t.mock.method(globalThis,'fetch',async(...args)=>{calls.push(args);throw new Error('Unexpected network access');});return calls;};
const captureLogs=t=>{const lines=[];t.mock.method(console,'error',l=>lines.push(String(l)));t.mock.method(console,'info',l=>lines.push(String(l)));return lines;};

test('creating, storing and embedding affiliate links is allowed and performs no network access',async t=>{
  const calls=noNetwork(t);
  // 1. generate (also several links at once, 9.)
  assert.equal(A.createAmazonAffiliateUrl(detail),affiliate);
  const many=Array.from({length:25},(_,i)=>A.createAmazonAffiliateUrl(`https://www.amazon.de/dp/B0${String(i).padStart(8,'0')}`));
  assert.ok(many.every(link=>link.endsWith('?tag=alltaeglichle-21')&&G.isAffiliateUrl(link)));
  // 2. store in the database (real repository claim) and read it back
  const pg=new PGlite();t.after(()=>pg.close());
  for(const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort())await pg.exec(fs.readFileSync(`db/migrations/${name}`,'utf8'));
  const db={query:(q,v)=>pg.query(q,v),exec:q=>pg.exec(q),transaction:fn=>pg.transaction(tx=>fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)}))};
  const id=crypto.randomUUID();
  const opportunity={product:product(),category:'household',useCaseKey:'seasonal-product-guide',targetPlatform:'facebook',useCase:'Das Produkt im Alltag verwenden und die Eignung vor dem Kauf prüfen.',trend:'',goal:'education',budget:'low',verifiedFacts:[]};
  await memoryRepository(db).claim(id,opportunity,'reference');
  const stored=(await pg.query('SELECT opportunity FROM content_jobs WHERE id=$1',[id])).rows[0].opportunity;
  assert.equal(stored.product.affiliateUrl,affiliate);
  // 3. embed in content (caption/CTA of a planned post)
  const job=await runContentJob(opportunity,{id,mode:'reference',allowedFormats:['image']});
  assert.equal(job.status,'awaiting_approval');
  assert.ok(JSON.stringify(job.content).includes(affiliate)||job.opportunity.product.affiliateUrl===affiliate);
  assert.equal(calls.length,0,'no request was made while generating, storing or embedding');
});

test('GET, HEAD, redirect checks and Request objects against an affiliate link are blocked before any network access',async t=>{
  const logs=captureLogs(t);let inner=0;
  const guarded=G.guardedFetch(async()=>{inner++;return new Response('x');});
  for(const init of [undefined,{method:'GET'},{method:'HEAD'},{method:'GET',redirect:'follow'},{redirect:'manual'},{redirect:'error'},{method:'OPTIONS'},{method:'POST',body:'x'}])
    await assert.rejects(guarded(affiliate,init),e=>e.code===G.AFFILIATE_ACCESS_BLOCKED);
  await assert.rejects(guarded(new URL(affiliate)),e=>e instanceof G.AffiliateLinkBlockedError);
  await assert.rejects(guarded(new Request(affiliate,{method:'HEAD'})),e=>e.code===G.AFFILIATE_ACCESS_BLOCKED);
  assert.equal(inner,0);
  // The safety event is structured and leaks neither the URL nor the tracking ID.
  const events=logs.map(l=>{try{return JSON.parse(l);}catch{return {};}}).filter(e=>e.event===G.AFFILIATE_ACCESS_BLOCKED);
  assert.ok(events.length>=10);assert.ok(events.every(e=>e.host==='www.amazon.de'&&e.context==='fetch'));
  assert.ok(!logs.join(' ').includes('alltaeglichle-21')&&!logs.join(' ').includes(ASIN));
});

test('other tracking variants, short links, redirect parameters and our tag on any host are recognised; plain product pages and internal links are not',()=>{
  for(const blocked of [affiliate,`https://amazon.de/dp/${ASIN}?tag=other-21`,`https://www.amazon.de/dp/${ASIN}?linkCode=ll1&tag=x-21`,`https://www.amazon.de/dp/${ASIN}?ascsubtag=abc`,
    `https://amzn.to/abc?tag=alltaeglichle-21`,`https://www.amazon.com/dp/${ASIN}?tag=foo`,`https://example.org/go?tag=alltaeglichle-21`,
    `https://www.amazon.de/gp/redirect.html?u=${encodeURIComponent(`/dp/${ASIN}?tag=alltaeglichle-21`)}`])
    assert.equal(G.isAffiliateUrl(blocked),true,blocked);
  for(const allowed of [detail,`https://www.amazon.de/dp/${ASIN}?th=1`,'https://graph.facebook.com/v25.0/123/photos','https://api.tavily.com/search','https://k6pclvml1podnlqd.public.blob.vercel-storage.com/a.png',
    'https://affiliate-reel-agent.vercel.app/api/landing/click','http://localhost:3000/produkte','/produkte','not a url'])
    assert.equal(G.isAffiliateUrl(allowed),false,allowed);
});

test('the global guard covers every module: installed once, blocks affiliate links, passes everything else',async()=>{
  const seen=[];const target={fetch:async url=>{seen.push(String(url));return new Response('ok');}};
  assert.equal(G.installAffiliateFetchGuard(target),true);assert.equal(G.installAffiliateFetchGuard(target),false,'idempotent');
  await assert.rejects(target.fetch(affiliate,{method:'HEAD'}),e=>e.code===G.AFFILIATE_ACCESS_BLOCKED);
  assert.equal((await target.fetch('https://example.org/internal')).status,200);   // 10. ordinary non-Amazon link keeps working
  assert.equal((await target.fetch(detail)).status,200);                          // clean product page (no tracking) stays possible
  assert.deepEqual(seen,['https://example.org/internal',detail]);
  assert.match(fs.readFileSync('instrumentation.ts','utf8'),/installAffiliateFetchGuard/);
});

test('no browser automation, prefetch or prerender path exists for links; link access via browser tooling is blocked',async()=>{
  const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
  const deps=Object.keys({...pkg.dependencies,...pkg.devDependencies});
  assert.deepEqual(deps.filter(name=>/puppeteer|playwright|selenium|webdriver|cypress|chromium/i.test(name)),[]);
  const files=[];(function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.next','.test-build','.git'].includes(entry.name))continue;
    const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(/\.(ts|tsx|js|cjs|mjs)$/.test(entry.name)&&!full.startsWith('tests'))files.push(full);}})('.');
  for(const file of files.filter(f=>!/^(?:\.\/)?tests/.test(f)&&!/affiliate-guard/.test(f))){
    const source=fs.readFileSync(file,'utf8');
    assert.ok(!/from\s+["'](?:puppeteer|playwright|selenium-webdriver)/.test(source),`${file}: browser automation import`);
    assert.ok(!/rel=["'](?:prefetch|prerender|preload)["'][^>]*amazon|\.prefetch\(|next\/link|speculationrules/i.test(source),`${file}: prefetch/prerender path`);
  }
  assert.throws(()=>G.assertNoAffiliateAccess(affiliate,'browser'),e=>e.code===G.AFFILIATE_ACCESS_BLOCKED&&e.context==='browser');
  assert.throws(()=>G.assertNoAffiliateAccess(new URL(affiliate),'preview'),e=>e.context==='preview');
  for(const purpose of ['prefetch','prerender'])await assert.rejects(G.guardedFetch(async()=>new Response('x'))(affiliate,{headers:{Purpose:purpose,'Sec-Purpose':purpose}}),e=>e.code===G.AFFILIATE_ACCESS_BLOCKED);
  assert.doesNotThrow(()=>G.assertNoAffiliateAccess('https://example.org/preview','preview'));
});

test('existing flows keep working without touching affiliate URLs: live page verification and short-link resolution',async t=>{
  const requested=[];
  const request=async url=>{requested.push(String(url));
    return new Response(`<html><span id="productTitle">Silikon Backmatte Premium Antihaft</span><a href="/dp/${ASIN}/x">data</a></html>`,{status:200});};
  Object.defineProperty(Response.prototype,'url',{configurable:true,get(){return this._u||'';}});t.after(()=>{delete Response.prototype.url;});
  assert.equal(await verifyAmazonProductPage(ASIN,request),'Silikon Backmatte Premium Antihaft');
  assert.deepEqual(requested,[detail]);assert.ok(!requested.some(G.isAffiliateUrl),'the live check uses the clean product URL, never the tracking link');
  // The short link is resolved without following its redirect, even if the target would be an affiliate link.
  const resolved=[];
  const asin=await asinFromOperatorLink('https://amzn.eu/d/abc123',async(url,init)=>{resolved.push([String(url),init.redirect]);
    return new Response(null,{status:302,headers:{location:affiliate}});});
  assert.equal(asin,ASIN);assert.deepEqual(resolved,[['https://amzn.eu/d/abc123','manual']]);
  // A forwarded affiliate link that carries our tag is parsed locally, never requested.
  const calls=noNetwork(t);
  assert.equal(await asinFromOperatorLink(affiliate),ASIN);assert.equal(calls.length,0);
});

test('product detail page policy stays intact (structural validation only)',()=>{
  const ok=product();
  assert.equal(A.productIdentityError(ok),null);
  assert.equal(G.affiliateLinkStructureIssue(ok.affiliateUrl,ASIN),null);
  // Required product facts
  for(const broken of [{name:''},{asin:undefined},{productUrl:undefined},{affiliateUrl:detail},{trackingId:undefined},{productVerifiedAt:undefined}])
    assert.equal(A.productIdentityError({...ok,...broken}),A.PRODUCT_UNRESOLVED,JSON.stringify(broken));
  // Not a product detail page: never accepted
  const trk='tag=alltaeglichle-21';
  assert.equal(G.affiliateLinkStructureIssue(`https://www.amazon.de/s?k=backmatte&${trk}`),'not_a_product_detail_page');
  assert.equal(G.affiliateLinkStructureIssue(`https://www.amazon.de/b?node=123&${trk}`),'not_a_product_detail_page');
  assert.equal(G.affiliateLinkStructureIssue(`https://www.amazon.de/gp/bestsellers/kitchen?${trk}`),'not_a_product_detail_page');
  assert.equal(G.affiliateLinkStructureIssue(`https://www.amazon.de/?${trk}`),'not_a_product_detail_page');
  assert.equal(G.affiliateLinkStructureIssue(`https://www.amazon.com/dp/${ASIN}?${trk}`),'not_a_product_detail_page');
  assert.equal(G.affiliateLinkStructureIssue(`http://www.amazon.de/dp/${ASIN}?${trk}`),'not_a_product_detail_page');
  assert.equal(G.affiliateLinkStructureIssue(`https://www.amazon.de/dp/${ASIN}`),'unexpected_parameters');
  assert.equal(G.affiliateLinkStructureIssue(`https://www.amazon.de/dp/${ASIN}?tag=wrong-21`),'tracking_id_mismatch');
  assert.equal(G.affiliateLinkStructureIssue(`https://www.amazon.de/dp/${ASIN}?${trk}&x=1`),'unexpected_parameters');
  assert.equal(G.affiliateLinkStructureIssue(affiliate,'B0AAAAAAAA'),'asin_mismatch');
  assert.equal(G.affiliateLinkStructureIssue('nope'),'invalid_url');
  // Text with another destination is refused by the existing copy check.
  assert.equal(A.productIdentityError(ok,`Mehr: https://www.amazon.de/s?k=x&${trk}`),A.PRODUCT_UNRESOLVED);
});
