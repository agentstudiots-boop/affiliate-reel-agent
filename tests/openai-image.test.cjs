const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const zlib = require('node:zlib');
const { PGlite } = require('@electric-sql/pglite');
const { createOpenAIImageProvider, buildOriginalVisualPrompt, DEFAULT_OPENAI_IMAGE_MODEL } = require('../.test-build/lib/content/providers/openai-image');
const { imageProviderStatus, getOriginalVisualProvider } = require('../.test-build/lib/content/image-provider');
const { memoryRepository } = require('../.test-build/lib/memory/repository');
const { publicationRepository } = require('../.test-build/lib/meta/publication-gate');
const { runContentJob } = require('../.test-build/lib/content/orchestrator');
const { opportunitySchema } = require('../.test-build/lib/content/schema');

function opportunity(sourceUrl = 'https://www.amazon.de/s?k=Kuscheldecke', verifiedFacts = []) {
  return opportunitySchema.parse({
    product: { name: sourceUrl.includes('/dp/') ? 'Kuscheldecke Modell X' : 'Kuscheldecke', sourceUrl,
      affiliateUrl: sourceUrl, price: '', targetGroup: 'Haushalte', benefits: 'angeblich wasserdicht und selbstheizend', notes: '' },
    useCase: 'Ein ruhiger Herbstabend mit einer Kuscheldecke auf dem Sofa.', targetPlatform: 'facebook', budget: 'low', verifiedFacts,
  });
}

function pngFixture() {
  // A fully formed, compressible 1024x1280 PNG. This is generated locally; no model is called.
  const crcTable = Array.from({ length: 256 }, (_, i) => {
    let n = i; for (let j = 0; j < 8; j++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0;
  });
  function chunk(type, data) {
    const inner = Buffer.concat([Buffer.from(type), data]);
    let crc = -1; for (const byte of inner) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    const len = Buffer.alloc(4), check = Buffer.alloc(4); len.writeUInt32BE(data.length); check.writeUInt32BE((crc ^ -1) >>> 0);
    return Buffer.concat([len, inner, check]);
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1024, 0); ihdr.writeUInt32BE(1280, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc(1280 * (1 + 1024 * 3));
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}

const response = bytes => new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }], usage: { input_tokens: 12, output_tokens: 42, total_tokens: 54 } }), { status: 200 });
const dbAdapter = pg => ({ query: (q,v) => pg.query(q,v), exec: q => pg.exec(q), transaction: fn => pg.transaction(tx => fn({query:(q,v)=>tx.query(q,v),exec:q=>tx.exec(q)})) });

async function setup() {
  const pg = new PGlite();
  for (const name of fs.readdirSync('db/migrations').filter(n=>n.endsWith('.sql')).sort()) await pg.exec(fs.readFileSync(`db/migrations/${name}`, 'utf8'));
  const db = dbAdapter(pg), memory = memoryRepository(db), repo = publicationRepository(db);
  async function job(input = opportunity()) {
    const id = crypto.randomUUID(); await memory.claim(id,input,'reference');
    await runContentJob(input,{id,onUpdate:memory.save,loadLearning:memory.learn});
    return memory.approve(id);
  }
  return { pg, repo, job };
}

test('missing key is fail-closed, configured key selects OpenAI without calling it', () => {
  const old = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    assert.equal(imageProviderStatus().configured,false);
    assert.match(imageProviderStatus().reason,/OPENAI_API_KEY fehlt/);
    assert.equal(getOriginalVisualProvider(),null);
    process.env.OPENAI_API_KEY='test-only-mock-key';
    assert.equal(imageProviderStatus().configured,true);
    assert.equal(imageProviderStatus().model,DEFAULT_OPENAI_IMAGE_MODEL);
    assert.equal(getOriginalVisualProvider().name,'openai');
  } finally { if (old === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY=old; }
});

test('visual prompt stays categorical on search and excludes unverified model claims', async () => {
  const search = await runContentJob(opportunity());
  const prompt = buildOriginalVisualPrompt(search);
  assert.match(prompt,/nur die Kategorie visualisieren/);
  assert.match(prompt,/keine konkreten Eigenschaften/);
  assert.match(prompt,/Amazon- oder Händlerbranding/);
  const product = await runContentJob(opportunity('https://www.amazon.de/dp/B000000001'));
  assert.match(buildOriginalVisualPrompt(product),/Keine belegten Modellmerkmale/);
  const verified = await runContentJob(opportunity('https://www.amazon.de/dp/B000000001', [{claim:'Baumwolle laut Hersteller',source:'https://example.com/specs'}]));
  const verifiedPrompt = buildOriginalVisualPrompt(verified);
  assert.match(verifiedPrompt,/Einzige belegte konkrete Produkteigenschaften: Baumwolle laut Hersteller/);
  assert.match(verifiedPrompt,/Unbelegte Produktdetails .* nicht visuell behaupten/);
});

test('one mocked generation and Blob upload precede a single publication request; duplicate claim cannot regenerate', async () => {
  const { pg, repo, job } = await setup();
  try {
    const approved = await job();
    const steps = []; let sentBody;
    const provider = createOpenAIImageProvider('test-only-mock-key', DEFAULT_OPENAI_IMAGE_MODEL, {
      request: async (_url, init) => { steps.push('openai'); sentBody = JSON.parse(init.body); return response(pngFixture()); },
      upload: async (path, bytes, options) => {
        steps.push('blob'); assert.equal(bytes[0],137); assert.equal(options.contentType,'image/png');
        assert.match(path,/^generated\/facebook\/[a-f0-9-]+\/[a-f0-9]{64}\.png$/);
        assert.equal(options.addRandomSuffix,false);
        return { url:`https://test.public.blob.vercel-storage.com/${path}` };
      },
    });
    const claim = await repo.claimVisual(approved.id,DEFAULT_OPENAI_IMAGE_MODEL);
    assert.equal(claim.existing,null);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
    const asset = await provider.render(claim.job);
    assert.deepEqual(steps,['openai','blob']);
    assert.equal(sentBody.n,1); assert.equal(sentBody.size,'1024x1280'); assert.equal(sentBody.output_format,'png');
    assert.equal(asset.usage.totalTokens,54);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
    await assert.rejects(repo.prepareWithVisual(approved.id,'491234',{...asset,url:`https://test.public.blob.vercel-storage.com/social-cards/${approved.id}.png`}),/Originalbild fehlt/);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
    const publication = await repo.prepareWithVisual(approved.id,'491234',asset);
    steps.push('publication'); assert.deepEqual(steps,['openai','blob','publication']);
    assert.equal(publication.status,'pending'); assert.equal(publication.imageUrl,asset.url);
    const attempt=(await pg.query('SELECT * FROM original_visual_attempts WHERE job_id=$1',[approved.id])).rows[0];
    assert.equal(attempt.status,'media_ready');assert.deepEqual(attempt.usage,{inputTokens:12,outputTokens:42,totalTokens:54});
    const second=await repo.claimVisual(approved.id,DEFAULT_OPENAI_IMAGE_MODEL);
    assert.equal(second.existing.id,publication.id);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,1);
  } finally { await pg.close(); }
});

test('OpenAI, ambiguous response, invalid PNG and Blob failure never create a publication request or retry', async () => {
  const { pg, repo, job } = await setup();
  try {
    const cases = [
      { label:'HTTP', request:async()=>new Response('secret detail',{status:429}) },
      { label:'ambiguous', request:async()=>new Response(JSON.stringify({data:[]})) },
      { label:'invalid PNG', request:async()=>response(Buffer.from('invalid image bytes')) },
      { label:'Blob', request:async()=>response(pngFixture()), upload:async()=>{throw Error('mock Blob outage')} },
    ];
    for (const scenario of cases) {
      const approved=await job(); let calls=0, uploads=0;
      const provider=createOpenAIImageProvider('test-only-mock-key',DEFAULT_OPENAI_IMAGE_MODEL,{
        request:async(...args)=>{ calls++;return scenario.request(...args); },
        upload:async(...args)=>{ uploads++;return scenario.upload?.(...args) || {url:'https://test.public.blob.vercel-storage.com/ok.png'}; },
      });
      const claim=await repo.claimVisual(approved.id,DEFAULT_OPENAI_IMAGE_MODEL);
      await assert.rejects(provider.render(claim.job));
      assert.equal(calls,1,scenario.label);
      assert.equal(uploads,scenario.label==='Blob'?1:0,scenario.label);
      assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests WHERE job_id=$1',[approved.id])).rows[0].n,0);
      await assert.rejects(repo.claimVisual(approved.id,DEFAULT_OPENAI_IMAGE_MODEL),/bereits begonnen/);
    }
  } finally { await pg.close(); }
});

test('legacy weak creative cannot claim a visual; preview card is absent from publishing path', async () => {
  const source=fs.readFileSync('lib/meta/request-publication.ts','utf8');
  assert.doesNotMatch(source,/createSocialCard|from ["']\.\/card/);
  assert.match(fs.readFileSync('lib/meta/card.tsx','utf8'),/SOCIAL_CARD_PUBLISHABLE = false/);
  const {pg,repo,job}=await setup();
  try {
    const approved=await job();
    const broken={...approved,content:{...approved.content,visualConcept:undefined}};
    await pg.query('UPDATE content_jobs SET snapshot=$2 WHERE id=$1',[approved.id,JSON.stringify(broken)]);
    await assert.rejects(repo.claimVisual(approved.id,DEFAULT_OPENAI_IMAGE_MODEL),/nicht veröffentlichungsreif/);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM original_visual_attempts')).rows[0].n,0);
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n,0);
  } finally { await pg.close(); }
});

test('a previously stored social-card URL can never pass the publish gate', async () => {
  const {pg,repo,job}=await setup();
  try {
    const approved=await job();
    const legacy=await repo.prepare(approved.id,'491234');
    await repo.claimImage(legacy.id);
    await assert.rejects(repo.bindImage(legacy.id,`https://test.public.blob.vercel-storage.com/social-cards/${approved.id}.png`),/Preview-Textkarte/);
    await pg.query("UPDATE publication_requests SET status='approved',image_url=$2,whatsapp_message_id='wamid.legacy' WHERE id=$1",
      [legacy.id,`https://test.public.blob.vercel-storage.com/social-cards/${approved.id}.png`]);
    await assert.rejects(repo.claimPublish(legacy.id),/nicht freigegeben/);
    assert.equal((await repo.get(approved.id)).status,'approved');
  } finally { await pg.close(); }
});
