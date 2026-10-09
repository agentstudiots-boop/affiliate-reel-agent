const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = '../.test-build/lib';
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { approveContent } = require('./helpers/approve-content.cjs');
const { liveEnv, withEnv } = require('./helpers/live-env.cjs');
const { memoryRepository } = require(`${L}/memory/repository`);
const { productionRepository } = require(`${L}/production/repository`);
const { publicationRepository } = require(`${L}/meta/publication-gate`);
const { runContentJob } = require(`${L}/content/orchestrator`);
const { opportunitySchema } = require(`${L}/content/schema`);
const publishModule = require(`${L}/distribution/publish`);
const publishersModule = require(`${L}/distribution/publishers`);
const { publishApprovedAffiliateImage } = require(`${L}/distribution/affiliate`);
const { buildMasterContent } = require(`${L}/distribution/master-content`);
const { renderForPlatform } = require(`${L}/distribution/platforms/adapters`);
const G = require(`${L}/publishing/approval-gate`);
const { setEventSink } = require(`${L}/observability/events`);

setEventSink(() => {});
const OPERATOR = '491234';
const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'x'];
// Only the topic switches are cleared; the Meta credential names the capability check reads stay as in LIVE.
const OFF = { TOPIC_LIVE_PUBLISHING: undefined, TOPIC_PLATFORMS: undefined, WHATSAPP_APPROVER_WA_ID: OPERATOR };

// One shared set of platform publishers (spies). Both content kinds must reach exactly these instances.
function sharedPublishers(fail = {}) {
  const calls = [];
  const publishers = PLATFORMS.map(platform => ({
    platform, configured: () => ({ ok: true, missing: [] }), supports: () => true,
    async publish(variant, master) {
      calls.push({ platform, category: master.category, contentId: master.content_id, text: variant.text });
      if (fail[platform]) throw new publishModule.PlatformPublishError(fail[platform] === 'definite', 'simulierter Plattformfehler');
      return { state: 'published', externalId: `${platform}-1`, url: null };
    },
  }));
  return { calls, publishers };
}

// An affiliate image post of the existing product pipeline after its second WhatsApp approval ("Freigeben").
async function affiliatePost(db) {
  const memory = memoryRepository(db), publication = publicationRepository(db), inbound = productionRepository(db);
  const opportunity = opportunitySchema.parse({ product: { productVerifiedAt: '2026-09-26T08:00:00.000Z', productVerifiedName: 'Kuscheldecke', name: 'Kuscheldecke',
    sourceUrl: 'https://www.amazon.de/dp/B000000001', affiliateUrl: 'https://www.amazon.de/dp/B000000001?tag=alltaeglichle-21', price: '', targetGroup: 'Haushalte',
    benefits: 'Größe und Material vergleichen', notes: '' }, useCase: 'Ein kühler Herbstabend auf dem Sofa mit einer Decke.', targetPlatform: 'facebook', budget: 'low' });
  const id = crypto.randomUUID();
  await memory.claim(id, opportunity, 'reference');
  await runContentJob(opportunity, { id, onUpdate: memory.save, loadLearning: memory.learn });
  await approveContent(db, memory, id);
  const pending = await publication.prepare(id, OPERATOR);
  await publication.claimImage(pending.id);
  await publication.bindImage(pending.id, `https://x.public.blob.vercel-storage.com/generated/facebook/${id}/${'a'.repeat(64)}.png`);
  await publication.claimWhatsAppSend(pending.id);
  await publication.bindMessage(pending.id, 'wamid.pub');
  await inbound.applyIncomingWhatsApp({ id: 'wamid.ok', from: OPERATOR, body: 'Freigeben', replyToMessageId: 'wamid.pub', payload: {} });
  return { publicationId: pending.id, publication };
}

// A topic post approved through the topic pipeline's own WhatsApp request.
async function topicPost(db) {
  const master = buildMasterContent({ contentId: 'tc_shared', topic: { topic_id: 'tp_0000000000000001', title: 'Fenster', trend_type: 'PRACTICAL_LIFE' }, format: 'SINGLE_IMAGE',
    copy: { hook: 'Beschlagene Fenster?', coreMessage: 'Kurz lüften', body: 'Stoßlüften hilft.', cta: 'Speichern', caption: 'c', hashtags: [], videoScript: '' },
    assets: [{ role: 'main-image', asset: { kind: 'image', url: 'https://x.public.blob.vercel-storage.com/generated/topics/tc_shared/main.png', sha256: 'a'.repeat(64), mediaType: 'image/png', provider: 'replicate' } }],
    sources: [], runId: null, origin: 'topic_pipeline' });
  const variants = PLATFORMS.map(platform => renderForPlatform(master, platform));
  const content = publishModule.publishableContent(master, variants);
  const version = await G.registerContentVersion(db, content);
  await G.bindApprovalRequest(db, content.contentId, version.version, 'wamid.topic');
  await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR,
    evidence: { channel: 'whatsapp', messageId: 'wamid.topic.ok', replyToMessageId: 'wamid.topic', senderWaId: OPERATOR, body: 'Freigeben' } });
  return { master, variants };
}

test('topic and affiliate posts run through the same multi-publisher and the same platform publisher instances', async t => {
  const db = await pgliteDatabase(); t.after(() => db.close());
  t.mock.method(global, 'fetch', async () => { throw new Error('no network'); });
  const spy = t.mock.method(publishModule, 'publishAll');
  const shared = sharedPublishers();
  const restore = liveEnv({ WHATSAPP_APPROVER_WA_ID: OPERATOR });
  try {
    const topic = await topicPost(db);
    const topicRun = await publishModule.publishAll(db, { master: topic.master, variants: topic.variants, publishers: shared.publishers, origin: 'whatsapp_approval' });
    const { publicationId } = await affiliatePost(db);
    const reports = [];
    const affiliateRun = await publishApprovedAffiliateImage(publicationId, { db, publishers: shared.publishers, send: async text => { reports.push(text); } });
    // Both content kinds went through publishAll (the one multi-publisher) …
    assert.equal(spy.mock.calls.length, 2);
    assert.equal(spy.mock.calls[1].arguments[1].publishers, shared.publishers, 'affiliate post uses the very same publisher set');
    assert.ok(topicRun.outcomes.length >= 2 && affiliateRun.outcomes.length === 2);
    // … and reached the same Facebook and Instagram publisher instances.
    for (const platform of ['facebook', 'instagram']) {
      assert.deepEqual(shared.calls.filter(call => call.platform === platform).map(call => call.category), ['topic', 'affiliate']);
    }
    // The affiliate variant carries exactly the approved caption (existing link and disclosure rules).
    const approved = (await db.query('SELECT caption FROM publication_requests WHERE id=$1', [publicationId])).rows[0].caption;
    const affiliateCalls = shared.calls.filter(call => call.category === 'affiliate');
    assert.ok(affiliateCalls.every(call => call.text === approved));
    assert.match(approved, /Werbung \| Affiliate-Link[\s\S]*tag=alltaeglichle-21/);
    // Platforms the product approval did not name are never published under it, even with every topic switch on.
    assert.deepEqual(affiliateCalls.map(call => call.platform), ['facebook', 'instagram']);
    assert.ok(affiliateRun.plan.filter(entry => ['tiktok', 'youtube', 'x'].includes(entry.platform)).every(entry => !entry.wouldPublish && /eigene Freigabe/.test(entry.reason)));
    assert.match(reports[0], /^Affiliate-Post, Bild veröffentlicht/);
  } finally { restore(); }
});

test('without explicit publishers the affiliate bridge uses the same default publisher factory as the topic runtime', async t => {
  const db = await pgliteDatabase(); t.after(() => db.close());
  t.mock.method(global, 'fetch', async () => { throw new Error('no network'); });
  const factory = t.mock.method(publishersModule, 'defaultPublishers');
  const restore = withEnv(OFF);
  try {
    const { publicationId, publication } = await affiliatePost(db);
    const photos = [];
    const run = await publishApprovedAffiliateImage(publicationId, { db, send: async () => 'ok', affiliate: {
      publications: () => publication, photo: async (image, caption) => { photos.push(caption); return { id: '1_2', permalink: 'https://www.facebook.com/1_2' }; },
      instagramImage: async () => ({ status: 'published', permalink: 'https://www.instagram.com/p/abc/' }) } });
    assert.equal(factory.mock.calls.length, 1);
    assert.equal(photos.length, 1);
    assert.deepEqual(run.outcomes.map(item => [item.platform, item.status]), [['facebook', 'published'], ['instagram', 'published']]);
    assert.equal((await publication.get((await db.query('SELECT job_id FROM publication_requests WHERE id=$1', [publicationId])).rows[0].job_id)).status, 'published');
  } finally { restore(); }
  const runtime = fs.readFileSync('lib/agents/topic-runtime.ts', 'utf8');
  assert.match(runtime, /publishers: defaultPublishers\(\)/, 'topic runtime publishes with the same factory');
});

test('platform failures stay isolated for both content kinds; nothing is published twice', async t => {
  const db = await pgliteDatabase(); t.after(() => db.close());
  t.mock.method(global, 'fetch', async () => { throw new Error('no network'); });
  const restore = liveEnv({ WHATSAPP_APPROVER_WA_ID: OPERATOR });
  try {
    // Affiliate: Facebook result unclear → Instagram still runs; Facebook is never repeated.
    const shared = sharedPublishers({ facebook: 'unknown' });
    const { publicationId } = await affiliatePost(db);
    const reports = [];
    const first = await publishApprovedAffiliateImage(publicationId, { db, publishers: shared.publishers, send: async text => { reports.push(text); } });
    assert.deepEqual(first.outcomes.map(item => [item.platform, item.status]), [['facebook', 'unknown'], ['instagram', 'published']]);
    assert.match(reports[0], /teilweise veröffentlicht/);
    // Redelivered approval: stored results only, no publisher call, no second report.
    const again = await publishApprovedAffiliateImage(publicationId, { db, publishers: shared.publishers, send: async text => { reports.push(text); } });
    assert.ok(again.outcomes.every(item => item.reused));
    assert.equal(shared.calls.length, 2); assert.equal(reports.length, 1);
    // Topic: TikTok rejects, X unclear → the other platforms are published anyway.
    const topicShared = sharedPublishers({ tiktok: 'definite', x: 'unknown' });
    const topic = await topicPost(db);
    const run = await publishModule.publishAll(db, { master: topic.master, variants: topic.variants, publishers: topicShared.publishers, origin: 'whatsapp_approval' });
    const status = Object.fromEntries(run.outcomes.map(item => [item.platform, item.status]));
    assert.equal(status.instagram, 'published'); assert.equal(status.facebook, 'published');
    assert.equal(status.tiktok, 'failed'); assert.equal(status.x, 'unknown');
  } finally { restore(); }
});

test('affiliate posts keep their Meta channels without topic switches; other platforms follow the topic rules', async t => {
  const db = await pgliteDatabase(); t.after(() => db.close());
  t.mock.method(global, 'fetch', async () => { throw new Error('no network'); });
  const restore = withEnv(OFF);
  try {
    const { publicationId } = await affiliatePost(db);
    const shared = sharedPublishers();
    const run = await publishApprovedAffiliateImage(publicationId, { db, publishers: shared.publishers, send: async () => 'ok' });
    assert.equal(run.dryRun, false);
    assert.deepEqual(shared.calls.map(call => call.platform), ['facebook', 'instagram']);
    // An affiliate master with an additionally approved TikTok variant reaches the shared TikTok publisher only under the
    // topic rules (TOPIC_LIVE_PUBLISHING + platform enabled + credentials).
    const master = { ...buildMasterContent({ contentId: 'aff_img_extra', topic: { topic_id: 'job', title: 'Decke', trend_type: 'product' }, format: 'SINGLE_IMAGE',
      copy: { hook: 'h', coreMessage: 'm', body: 'b', cta: '', caption: 'c', hashtags: [], videoScript: '' },
      assets: [{ role: 'image', asset: { kind: 'image', url: 'https://x.public.blob.vercel-storage.com/a.png', sha256: null, mediaType: 'image/png', provider: 'product_pipeline' } }],
      sources: [], runId: null, origin: 'product_pipeline' }), category: 'affiliate', source_ref: { kind: 'facebook_publication', publicationId: 'p', jobId: 'job' } };
    const variants = [renderForPlatform(master, 'tiktok')];
    const content = publishModule.publishableContent(master, variants);
    assert.equal(content.origin, 'product_pipeline');
    const version = await G.registerContentVersion(db, content);
    await G.bindApprovalRequest(db, content.contentId, version.version, 'wamid.extra');
    await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR,
      evidence: { channel: 'whatsapp', messageId: 'wamid.extra.ok', replyToMessageId: 'wamid.extra', senderWaId: OPERATOR, body: 'Freigeben' } });
    const off = await publishModule.publishAll(db, { master, variants, publishers: shared.publishers, origin: 'test' });
    assert.equal(off.dryRun, true); assert.equal(shared.calls.length, 2);
    assert.equal(off.plan[0].wouldPublish, false); assert.match(off.plan[0].reason, /Zugang fehlt|TOPIC_LIVE_PUBLISHING/);
    const live = liveEnv({ WHATSAPP_APPROVER_WA_ID: OPERATOR });
    try { await publishModule.publishAll(db, { master, variants, publishers: shared.publishers, origin: 'test' }); } finally { live(); }
    assert.deepEqual(shared.calls.at(-1), { platform: 'tiktok', category: 'affiliate', contentId: 'aff_img_extra', text: variants[0].text });
  } finally { restore(); }
});

test('the shared layer publishes an affiliate post only with the operator approval of exactly that request', async t => {
  const db = await pgliteDatabase(); t.after(() => db.close());
  t.mock.method(global, 'fetch', async () => { throw new Error('no network'); });
  const restore = withEnv(OFF);
  try {
    const { publicationId } = await affiliatePost(db);
    // Without the stored approving reply there is no gate decision and nothing is published.
    await db.query("UPDATE whatsapp_events SET intent=NULL WHERE message_id='wamid.ok'");
    const shared = sharedPublishers();
    assert.equal(await publishApprovedAffiliateImage(publicationId, { db, publishers: shared.publishers }), null);
    assert.equal(shared.calls.length, 0);
    // A topic post never gets the affiliate Meta exception: same content without source_ref stays a topic post.
    const topic = await topicPost(db);
    assert.equal(publishModule.publishableContent(topic.master, topic.variants).origin, undefined);
    const run = await publishModule.publishAll(db, { master: topic.master, variants: topic.variants, publishers: shared.publishers, origin: 'whatsapp_approval' });
    assert.equal(run.dryRun, true); assert.equal(shared.calls.length, 0);
  } finally { restore(); }
});
