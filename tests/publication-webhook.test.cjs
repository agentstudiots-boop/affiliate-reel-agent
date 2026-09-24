const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const loadRoute = require('./helpers/load-route.cjs');
const { applyMigrations } = require('../.test-build/lib/memory/migrations');
const { memoryRepository } = require('../.test-build/lib/memory/repository');
const productionModule = require('../.test-build/lib/production/repository');
const publicationModule = require('../.test-build/lib/meta/publication-gate');
const { runContentJob } = require('../.test-build/lib/content/orchestrator');
const { opportunitySchema } = require('../.test-build/lib/content/schema');

async function fixture(t) {
  const pg = new PGlite();
  const db = { query: (q, v) => pg.query(q, v), exec: q => pg.exec(q),
    transaction: fn => pg.transaction(tx => fn({ query: (q, v) => tx.query(q, v), exec: q => tx.exec(q) })) };
  t.after(() => pg.close());
  await applyMigrations(db);
  const env = { WHATSAPP_APPROVER_WA_ID: '491234', WHATSAPP_PHONE_NUMBER_ID: '123456', META_APP_SECRET: 'local-webhook-test' };
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) {
    if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
  } });
  t.mock.method(global, 'fetch', async () => { throw new Error('Unexpected external network call'); });
  const memory = memoryRepository(db), publication = publicationModule.publicationRepository(db);
  const inbound = productionModule.productionRepository(db), id = crypto.randomUUID();
  const opportunity = opportunitySchema.parse({
    product: { name: 'Kuscheldecke', sourceUrl: 'https://www.amazon.de/s?k=Kuscheldecke', affiliateUrl: 'https://www.amazon.de/s?k=Kuscheldecke',
      price: '', targetGroup: 'Haushalte', benefits: 'Größe und Material vergleichen', notes: '' },
    useCase: 'Ein kühler Herbstabend auf dem Sofa mit einer Decke.', targetPlatform: 'facebook', budget: 'low',
  });
  await memory.claim(id, opportunity, 'reference');
  await runContentJob(opportunity, { id, onUpdate: memory.save, loadLearning: memory.learn });
  // Simulate only the already delivered first draft message. All decisions
  // below pass through the real signature-verified webhook and SQL repository.
  await pg.query("INSERT INTO daily_drafts(day,job_id,status,whatsapp_send_attempted_at,whatsapp_message_id) VALUES('2026-09-24',$1,'awaiting_approval',now(),'wamid.content')", [id]);
  const writes = [], sends = [];
  const state = { unknown: false };
  const route = loadRoute('app/api/whatsapp/webhook/route.ts', {
    '@/lib/production/repository': { productionRepository: () => inbound },
    '@/lib/meta/publication-gate': { publicationRepository: () => publication },
    '@/lib/daily/draft': { sendDailyApproval: async () => { throw new Error('Unexpected notification path'); } },
    '@/lib/meta/request-publication': { requestFacebookApproval: async jobId => {
      const pending = await publication.prepare(jobId, env.WHATSAPP_APPROVER_WA_ID);
      await publication.claimImage(pending.id);
      await publication.bindImage(pending.id, 'https://test.public.blob.vercel-storage.com/test.png');
      await publication.claimWhatsAppSend(pending.id);
      sends.push(pending.id);
      return publication.bindMessage(pending.id, 'wamid.publication');
    } },
    '@/lib/meta/publisher': { publishFacebookPhoto: async (image, caption) => {
      writes.push({ image, caption });
      if (state.unknown) throw new Error('Simulated accepted post with response lost');
      return { id: '123_456', permalink: 'https://www.facebook.com/123_456' };
    } },
  });
  function request(messageId, replyToMessageId, overrides = {}) {
    const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: {
      metadata: { phone_number_id: overrides.phone || env.WHATSAPP_PHONE_NUMBER_ID },
      messages: [{ id: messageId, from: overrides.from || env.WHATSAPP_APPROVER_WA_ID, type: 'text',
        text: { body: 'Freigeben' }, context: { id: replyToMessageId } }],
    } }] }] });
    const signature = overrides.invalidSignature ? 'sha256=invalid' : `sha256=${createHmac('sha256', env.META_APP_SECRET).update(body).digest('hex')}`;
    return new Request('https://local.test/api/whatsapp/webhook', { method: 'POST',
      headers: { 'x-hub-signature-256': signature }, body });
  }
  return { pg, id, publication, memory, route, request, writes, sends, state };
}

test('signed webhook keeps both Facebook approvals separate and publishes once on concurrent delivery', async t => {
  const f = await fixture(t);
  assert.equal((await f.route.POST(f.request('bad-signature', 'wamid.content', { invalidSignature: true }))).status, 401);
  await f.route.POST(f.request('wrong-phone', 'wamid.content', { phone: '999999' }));
  await f.route.POST(f.request('wrong-sender', 'wamid.content', { from: '499999' }));
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM whatsapp_events')).rows[0].n, 0);
  await Promise.all([f.route.POST(f.request('content-approve', 'wamid.content')), f.route.POST(f.request('content-approve', 'wamid.content'))]);
  assert.equal((await f.memory.list()).find(job => job.id === f.id).status, 'approved');
  assert.equal(f.sends.length, 1); assert.equal(f.writes.length, 0);
  assert.equal((await f.publication.get(f.id)).status, 'pending');
  const responses = await Promise.all([
    f.route.POST(f.request('publish-approve', 'wamid.publication')),
    f.route.POST(f.request('publish-approve', 'wamid.publication')),
    f.route.POST(f.request('publish-approve-another-id', 'wamid.publication')),
  ]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(f.writes.length, 1);
  const request = await f.publication.get(f.id);
  assert.equal(request.status, 'published'); assert.equal(request.metaPostId, '123_456');
  assert.equal(request.permalink, 'https://www.facebook.com/123_456');
  const publications = (await f.pg.query('SELECT * FROM publications WHERE job_id=$1', [f.id])).rows;
  assert.equal(publications.length, 1); assert.equal(publications[0].url, request.permalink);
  assert.equal((await f.pg.query("SELECT count(*)::int AS n FROM whatsapp_events WHERE intent='approve'")).rows[0].n, 2);
});

test('an unknown Facebook result survives webhook redelivery without another post', async t => {
  const f = await fixture(t);
  await f.route.POST(f.request('content-approve', 'wamid.content'));
  f.state.unknown = true;
  assert.equal((await f.route.POST(f.request('publish-approve', 'wamid.publication'))).status, 200);
  assert.equal((await f.publication.get(f.id)).status, 'unknown');
  await f.route.POST(f.request('publish-approve', 'wamid.publication'));
  await f.route.POST(f.request('new-reply-id', 'wamid.publication'));
  assert.equal(f.writes.length, 1); assert.equal(f.sends.length, 1);
  assert.equal((await f.pg.query('SELECT count(*)::int AS n FROM publications WHERE job_id=$1', [f.id])).rows[0].n, 0);
  assert.equal((await f.publication.get(f.id)).status, 'unknown');
});
