const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const loadRoute = require('./helpers/load-route.cjs');
const { applyMigrations } = require('../.test-build/lib/memory/migrations');
const { memoryRepository } = require('../.test-build/lib/memory/repository');
const productionModule = require('../.test-build/lib/production/repository');
const { facelessClient, facelessVisualDirection } = require('../.test-build/lib/production/faceless-so');
const { runContentJob } = require('../.test-build/lib/content/orchestrator');
const { opportunitySchema } = require('../.test-build/lib/content/schema');

async function fixture(t) {
  const pg = new PGlite();
  const db = { query: (q, v) => pg.query(q, v), exec: q => pg.exec(q),
    transaction: fn => pg.transaction(tx => fn({ query: (q, v) => tx.query(q, v), exec: q => tx.exec(q) })) };
  t.after(() => pg.close());
  await applyMigrations(db);
  const env = { CONTENT_STUDIO_PASSWORD: 'local-route-test', FACELESS_API_KEY: 'local-provider-test', WHATSAPP_APPROVER_WA_ID: '491234' };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) {
    if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  } });
  // Any unexpected transport fails locally; no test can reach Meta/Faceless.
  t.mock.method(global, 'fetch', async () => { throw new Error('Unexpected external network call'); });
  const calls = [], messages = [];
  const state = { credits: 20, balance: 80, charged: 20, paidUnknown: false, renderUnknown: false,
    generation: 'processing', render: 'in-progress', videoUrl: null };
  const provider = facelessClient(async (url, options) => {
    const parsed = new URL(url), method = options.method;
    assert.equal(parsed.origin, 'https://faceless.so');
    calls.push({ path: parsed.pathname, method, key: options.headers['Idempotency-Key'] });
    let data;
    switch (`${method} ${parsed.pathname}`) {
      case 'GET /api/v1/me': data = { team: { credits: state.balance }, auth: { scopes: ['videos:read', 'videos:write', 'catalog:read'] } }; break;
      case 'GET /api/v1/options': data = { kind: 'models', items: [{ value: 'storyboard', credits: state.credits }] }; break;
      case 'GET /api/v1/voices': data = [{ id: 'de-test', name: 'Test', targetLanguages: ['de'] }]; break;
      case 'POST /api/v1/videos':
        assert.equal(JSON.parse(options.body).model, 'storyboard');
        if (state.paidUnknown) throw new Error('Simulated response lost after acceptance');
        data = { id: 'video-test', model: 'storyboard', creditsUsed: state.charged }; break;
      case 'GET /api/v1/videos/video-test/status': data = { status: state.generation, ...(state.generation === 'failed' ? { errorMessages: ['Provider generation failed'] } : {}) }; break;
      case 'POST /api/v1/videos/video-test/render':
        if (state.renderUnknown) throw new Error('Simulated render response lost');
        data = { renderId: 'render-test' }; break;
      case 'GET /api/v1/renders/render-test': data = { status: state.render, url: state.render === 'done' ? 'https://example.org/test.mp4' : null }; break;
      case 'GET /api/v1/videos/video-test': data = { id: 'video-test', renderedVideoUrl: state.videoUrl }; break;
      default: throw new Error('Unexpected simulated provider endpoint');
    }
    return Response.json({ success: true, data });
  });
  const repository = productionModule.productionRepository(db);
  const route = loadRoute('app/api/production/route.ts', {
    '@/lib/memory/db': { databaseConfigured: () => true },
    '@/lib/production/repository': { ...productionModule, productionRepository: () => repository },
    '@/lib/production/faceless-so': { ...require('../.test-build/lib/production/faceless-so'), facelessClient: () => provider },
    '@/lib/whatsapp/client': { whatsappConfig: () => ({}), whatsappApprovalReady: () => true,
      sendWhatsAppText: async body => { messages.push(body); return 'wamid.test.quote'; } },
  });
  const memory = memoryRepository(db), id = crypto.randomUUID();
  const opportunity = opportunitySchema.parse({
    product: { productVerifiedAt:'2026-09-26T08:00:00.000Z', productVerifiedName:'Vakuumierer', name: 'Vakuumierer', sourceUrl: 'https://www.amazon.de/dp/B000000001', affiliateUrl: '', price: '', targetGroup: 'Familien', benefits: 'Vorräte vorbereiten', notes: '' },
    useCase: 'Oma staunt beim Familienessen über das Steak.', category: 'kitchen', useCaseKey: 'sous-vide', targetPlatform: 'facebook',
  });
  await memory.claim(id, opportunity, 'reference');
  await runContentJob(opportunity, { id, onUpdate: memory.save, loadLearning: memory.learn });
  await memory.approve(id);
  async function post(action, password = env.CONTENT_STUDIO_PASSWORD) {
    const response = await route.POST(new Request('https://local.test/api/production', { method: 'POST',
      headers: { 'x-content-password': password }, body: JSON.stringify({ action, jobId: id, voiceId: 'de-test' }) }));
    return { status: response.status, data: await response.json() };
  }
  async function approve() {
    assert.equal((await post('prepareVideo')).status, 200);
    assert.equal((await post('requestApproval')).status, 200);
    await repository.applyIncomingWhatsApp({ id: 'wamid.test.approve', from: env.WHATSAPP_APPROVER_WA_ID,
      body: 'Freigeben', replyToMessageId: 'wamid.test.quote', payload: {} });
  }
  return { pg, route, repository, id, state, calls, messages, post, approve,
    paid: () => calls.filter(c => c.method === 'POST' && c.path === '/api/v1/videos'),
    renders: () => calls.filter(c => c.method === 'POST' && c.path.endsWith('/render')) };
}

test('production handler enforces WhatsApp gate and concurrent starts buy/render once', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('prepareVideo', '')).status, 401);
  assert.equal((await f.post('prepareVideo')).status, 200);
  assert.equal((await f.post('startVideo')).status, 409);
  assert.deepEqual((await f.post('quoteVideo')).data.quote, { credits: 20, balance: 80, voices: [{ id: 'de-test', name: 'Test' }] });
  assert.equal(f.paid().length, 0);
  await f.approve();
  assert.equal((await f.post('requestApproval')).status, 409);
  assert.equal(f.messages.length, 1);
  const starts = await Promise.all([f.post('startVideo'), f.post('startVideo')]);
  assert.deepEqual(starts.map(r => r.status).sort(), [200, 409]);
  assert.equal(f.paid().length, 1); assert.ok(f.paid()[0].key);
  assert.equal((await f.post('pollVideo')).data.stage, 'processing');
  assert.equal(f.renders().length, 0);
  f.state.generation = 'completed';
  await Promise.all([f.post('pollVideo'), f.post('pollVideo')]);
  assert.equal(f.renders().length, 1); assert.ok(f.renders()[0].key);
  f.state.render = 'done';
  assert.equal((await f.post('pollVideo')).data.stage, 'ready');
  const run = await f.repository.getByJobId(f.id);
  assert.equal(run.providerJobId, 'video-test'); assert.equal(run.outputUrl, 'https://example.org/test.mp4');
  assert.equal((await f.repository.latestApproval(f.id)).status, 'consumed');
  assert.equal(await f.repository.successfulVideoCount(), 1);
  assert.equal((await f.post('startVideo')).status, 409); assert.equal(f.paid().length, 1);
});

test('unknown paid result remains claimed and cannot cause a second purchase', async t => {
  const f = await fixture(t); await f.approve(); f.state.paidUnknown = true;
  assert.equal((await f.post('startVideo')).status, 503);
  assert.equal((await f.post('startVideo')).status, 409);
  assert.equal((await f.post('pollVideo')).status, 409);
  assert.equal(f.paid().length, 1); assert.equal(f.renders().length, 0);
  const run = await f.repository.getByJobId(f.id);
  assert.equal(run.status, 'rendering'); assert.equal(run.providerJobId, null);
  assert.equal((await f.repository.latestApproval(f.id)).status, 'consumed');
});

test('failed generation exposes read-only provider diagnostics without another purchase', async t => {
  const f = await fixture(t); await f.approve(); await f.post('startVideo');
  f.state.generation = 'failed';
  assert.equal((await f.post('pollVideo')).data.stage, 'failed');
  const response = await f.route.GET(new Request(`https://local.test/api/production?jobId=${f.id}&diagnostics=1`,
    { headers: { 'x-content-password': 'local-route-test' } }));
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).providerDiagnostics, { status: 'failed', errorMessages: ['Provider generation failed'] });
  assert.equal(f.paid().length, 1);
  assert.equal(f.renders().length, 0);
});

test('pumpkin video sends explicit visual direction to Faceless with the approved narration', async () => {
  const visual = facelessVisualDirection({opportunity:{product:{name:'YAVOCOS Halloween Kürbis Schnitzset'}}});
  assert.match(visual.masterStyle,/echter orangefarbener Kürbis/);
  assert.match(visual.globalNegativePrompt,/Keine Speisen/);
  let body;
  const provider = facelessClient(async (_url,options) => {
    body=JSON.parse(options.body);
    return Response.json({success:true,data:{id:'test-visual',model:'storyboard',creditsUsed:20}});
  });
  const previous=process.env.FACELESS_API_KEY;
  process.env.FACELESS_API_KEY='local-provider-test';
  try { await provider.create('Ein echter Kürbis wird geschnitzt.', 'de-test', 'Reel Test', 'one-use-key', visual); }
  finally { if(previous===undefined) delete process.env.FACELESS_API_KEY; else process.env.FACELESS_API_KEY=previous; }
  assert.deepEqual({script:body.script,model:body.model,masterStyle:body.masterStyle,globalNegativePrompt:body.globalNegativePrompt},
    {script:'Ein echter Kürbis wird geschnitzt.',model:'storyboard',...visual});
});

test('unknown MP4 render result is reconciled by reads only', async t => {
  const f = await fixture(t); await f.approve(); await f.post('startVideo');
  f.state.generation = 'completed'; f.state.renderUnknown = true;
  assert.equal((await f.post('pollVideo')).status, 503);
  assert.equal((await f.post('pollVideo')).status, 409);
  f.state.videoUrl = 'https://example.org/reconciled.mp4';
  assert.equal((await f.post('pollVideo')).data.stage, 'ready');
  assert.equal((await f.repository.getByJobId(f.id)).outputUrl, f.state.videoUrl);
  assert.equal(f.paid().length, 1); assert.equal(f.renders().length, 1);
});

test('insufficient balance and a higher live quote cannot consume approval or purchase', async t => {
  const f = await fixture(t); await f.approve();
  f.state.balance = 0;
  assert.equal((await f.post('startVideo')).status, 409);
  f.state.balance = 80; f.state.credits = 30;
  assert.equal((await f.post('startVideo')).status, 409);
  assert.equal(f.paid().length, 0);
  assert.equal((await f.repository.latestApproval(f.id)).status, 'approved');
  assert.equal((await f.repository.getByJobId(f.id)).status, 'approved_for_spend');
});

test('a confirmed provider ID survives an unexpected reported charge', async t => {
  const f = await fixture(t); await f.approve(); f.state.charged = 30;
  const result = await f.post('startVideo');
  assert.equal(result.status, 503); assert.match(result.data.error, /höhere Kosten/);
  assert.equal((await f.repository.getByJobId(f.id)).providerJobId, 'video-test');
  assert.equal((await f.post('startVideo')).status, 409);
  assert.equal((await f.post('pollVideo')).data.stage, 'processing');
  assert.equal(f.paid().length, 1);
});
