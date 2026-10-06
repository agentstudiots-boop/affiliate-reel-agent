const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = '../.test-build/lib';
const { buildMasterContent, AFFILIATE_DISCLOSURE } = require(`${L}/distribution/master-content`);
const { renderForPlatform, PLATFORM_ADAPTERS } = require(`${L}/distribution/platforms/adapters`);
const { publishAll, publishableContent, PlatformPublishError } = require(`${L}/distribution/publish`);
const { runTopicPipeline, handleTopicReply, routeTopicMessage } = require(`${L}/topic-pipeline/orchestrator`);
const { topicPipelineStatus } = require(`${L}/topic-pipeline/status`);
const { productCouplingBlocked, suggestProducts, productListCommand, productSelection } = require(`${L}/topic-pipeline/product-coupling`);
const { referenceCopy } = require(`${L}/topic-pipeline/copy`);
const G = require(`${L}/publishing/approval-gate`);
const { memoryLedger } = require(`${L}/visual/ledger`);
const { calendarSource, evergreenSource } = require(`${L}/topics/sources/offline`);
const { runTopicScout } = require(`${L}/topics/scout`);
const { setEventSink } = require(`${L}/observability/events`);
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { liveEnv, withEnv } = require('./helpers/live-env.cjs');
const restoreEnv = liveEnv();
process.on('exit', restoreEnv);

setEventSink(() => {});
const NOW = new Date('2026-10-05T07:00:00Z');
const OPERATOR = '491701234567';
const AFFILIATE = 'https://www.amazon.de/dp/B0TEST1234?tag=alltaeglichle-21';
const png = n => ({ kind: 'image', url: `https://x.public.blob.vercel-storage.com/generated/topics/tc/${n}.png`, sha256: String(n).repeat(64).slice(0, 64), mediaType: 'image/png', provider: 'replicate' });
const graphic = n => ({ kind: 'text_graphic', url: `https://x.public.blob.vercel-storage.com/generated/topics/tc/slide-${n}.png`, sha256: String(n).repeat(64).slice(0, 64), mediaType: 'image/png', provider: 'local_svg' });
const video = { kind: 'video', url: 'https://x.public.blob.vercel-storage.com/generated/topics/tc/video.mp4', sha256: 'f'.repeat(64), mediaType: 'video/mp4', provider: 'heygen' };
const copy = { hook: 'Beschlagene Fenster? Diese einfachen Schritte helfen im Alltag', coreMessage: 'Kurz und kräftig lüften statt kippen', body: 'Kondenswasser am Morgen kennt jeder.',
  cta: 'Speichern für später', caption: 'Caption', hashtags: ['#fenster', '#alltagstipps', '#alltäglichleichter'], videoScript: 'Skript' };
const master = (over = {}) => buildMasterContent({ contentId: 'tc_demo', topic: { topic_id: 'tp_0000000000000001', title: 'Beschlagene Fenster', trend_type: 'PRACTICAL_LIFE' },
  format: 'CAROUSEL', copy, assets: [{ role: 'slide-1', asset: png(1) }, ...[2, 3, 4, 5, 6].map(n => ({ role: `slide-${n}`, asset: graphic(n) }))],
  carousel: { slide_count: 6, slides: [1, 2, 3, 4, 5, 6].map(n => ({ slide_number: n, headline: `S${n}` })) },
  sources: [{ title: 'Richtig lüften', url: 'https://www.verbraucherzentrale.de/lueften', publisher: 'verbraucherzentrale.de', published_at: null }], runId: null, origin: 'test', ...over });
const affiliate = { product: { name: 'Fenstersauger', asin: 'B0TEST1234', sourceUrl: 'https://www.amazon.de/dp/B0TEST1234' }, affiliateUrl: AFFILIATE, approval: { channel: 'whatsapp', messageId: 'wamid.pick' } };

test('Instagram, Facebook, TikTok, YouTube and X render the same carousel master differently', () => {
  const m = master();
  const v = Object.fromEntries(PLATFORM_ADAPTERS.map(adapter => [adapter.platform, adapter.render(m)]));
  assert.equal(v.instagram.mediaFormat, 'carousel'); assert.equal(v.instagram.assetRefs.length, 6); assert.equal(v.instagram.aspectRatio, '4:5');
  assert.equal(v.facebook.mediaFormat, 'album');
  assert.equal(v.tiktok.mediaFormat, 'photo_slideshow'); assert.equal(v.tiktok.aspectRatio, '9:16');
  assert.equal(v.youtube.publishable, false); assert.match(v.youtube.skipReason, /Videoableitung/);
  assert.equal(v.x.mediaFormat, 'text_with_images'); assert.equal(v.x.assetRefs.length, 4); assert.equal(v.x.assetRefs[0], 'slide-1');
  assert.ok(v.x.text.length <= 280);
  assert.ok(v.instagram.hashtags.length <= 5 && v.x.hashtags.length <= 2);
  assert.notEqual(v.instagram.text, v.facebook.text);
});

test('format transformation for video and text masters', () => {
  const vid = master({ format: 'AVATAR_VIDEO', assets: [{ role: 'video', asset: video }], carousel: null, video: { script: 's', provider: 'heygen' } });
  const r = platform => renderForPlatform(vid, platform);
  assert.deepEqual(['instagram', 'facebook', 'tiktok', 'youtube', 'x'].map(p => r(p).mediaFormat), ['reel', 'video', 'video', 'short', 'video']);
  assert.ok(r('youtube').title.length <= 100);
  const text = master({ format: 'TEXT', assets: [], carousel: null });
  assert.equal(renderForPlatform(text, 'instagram').publishable, false);
  assert.equal(renderForPlatform(text, 'facebook').mediaFormat, 'text');
  assert.equal(renderForPlatform(text, 'tiktok').publishable, false);
  const missing = master({ format: 'STANDARD_VIDEO', assets: [], carousel: null });
  assert.match(renderForPlatform(missing, 'tiktok').skipReason, /Medium noch nicht vorhanden/);
});

test('link strategy and disclosure: affiliate links only where clickable and allowed; profile link elsewhere; Werbung label', () => {
  const m = master({ affiliate });
  assert.equal(m.category, 'affiliate');
  assert.deepEqual(m.disclosures.slice(0, 1), [AFFILIATE_DISCLOSURE]);
  const fb = renderForPlatform(m, 'facebook');
  assert.deepEqual(fb.links, [AFFILIATE]); assert.match(fb.text, /^Werbung \| Affiliate-Link\n/); assert.equal(fb.linkStrategy, 'affiliate_link_im_text');
  const ig = renderForPlatform(m, 'instagram');
  assert.deepEqual(ig.links, []); assert.match(ig.text, /Link im Profil/); assert.doesNotMatch(ig.text, /amazon\./); assert.equal(ig.disclosure, AFFILIATE_DISCLOSURE);
  const x = renderForPlatform(m, 'x');
  assert.match(x.text, /^Werbung \| Affiliate-Link: /); assert.ok(x.text.includes(AFFILIATE));
  const topic = renderForPlatform(master(), 'facebook');
  assert.deepEqual(topic.links, ['https://www.verbraucherzentrale.de/lueften']); assert.equal(topic.disclosure, null);
  assert.equal(renderForPlatform(master(), 'tiktok').links.length, 0);
});

test('no affiliate link without the operator\'s explicit choice, and never on a sensitive topic', () => {
  assert.equal(master({ affiliate: { ...affiliate, approval: { channel: 'whatsapp', messageId: '' } } }).affiliate_data, null);
  assert.equal(master({ affiliate: { ...affiliate, affiliateUrl: 'https://evil.example/x' } }).affiliate_data, null);
  const blocked = master({ affiliate, affiliateBlocked: true });
  assert.equal(blocked.affiliate_data, null);
  assert.equal(blocked.category, 'topic');
  assert.ok(PLATFORM_ADAPTERS.every(adapter => !adapter.render(blocked).text.includes('amazon.')));
});

function fakePublisher(platform, behaviour = 'ok') {
  const calls = [];
  return { calls, platform, configured: () => behaviour === 'missing' ? { ok: false, missing: [`${platform.toUpperCase()}_TOKEN`] } : { ok: true, missing: [] }, supports: () => true,
    async publish(variant, master, context) { calls.push(variant.platform);
      if (behaviour === 'down') throw new PlatformPublishError(true, 'HTTP 503');
      if (behaviour === 'unknown') throw new Error('timeout');
      await context.onRemoteId(`${platform}-remote`);
      if (behaviour === 'processing') return { state: 'processing', externalId: `${platform}-1`, url: null };
      return { state: 'published', externalId: `${platform}-1`, url: behaviour === 'nourl' ? null : `https://www.${platform === 'x' ? 'x' : platform}.com/p/1` }; },
    async status() { return behaviour === 'processing' ? { state: 'published', externalId: `${platform}-1`, url: `https://www.${platform}.com/p/1` } : { state: 'processing' }; } };
}
async function approvedContent(db, m, variants) {
  const content = publishableContent(m, variants);
  const version = await G.registerContentVersion(db, content);
  await G.bindApprovalRequest(db, m.content_id, version.version, 'wamid.req');
  await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: { channel: 'whatsapp', messageId: 'wamid.ok', replyToMessageId: 'wamid.req', senderWaId: OPERATOR, body: 'Freigeben' } });
}

test('dry run shows what would be published without any publisher call or claim', async () => {
  const db = await pgliteDatabase();
  try {
    const m = master();
    const variants = PLATFORM_ADAPTERS.map(adapter => adapter.render(m));
    await approvedContent(db, m, variants);
    const publishers = ['instagram', 'facebook', 'tiktok', 'x'].map(p => fakePublisher(p));
    const restore = withEnv({ TIKTOK_ACCESS_TOKEN: undefined });
    let run;
    try { run = await publishAll(db, { master: m, variants, publishers, origin: 'test', dryRun: true }); } finally { restore(); }
    assert.equal(run.dryRun, true);
    assert.equal(run.outcomes.length, 0);
    assert.ok(publishers.every(publisher => publisher.calls.length === 0));
    const plan = Object.fromEntries(run.plan.map(entry => [entry.platform, entry]));
    assert.equal(plan.instagram.wouldPublish, true);
    assert.match(plan.tiktok.reason, /Zugang fehlt: TIKTOK_ACCESS_TOKEN oder TIKTOK_REFRESH_TOKEN/);
    assert.equal(plan.youtube.wouldPublish, false);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM publish_attempts WHERE status='claimed'")).rows[0].n, 0);
  } finally { await db.close(); }
});

test('one platform down, missing credentials or unclear result: the others still publish; report separates them', async () => {
  const db = await pgliteDatabase();
  try {
    const m = master();
    const variants = PLATFORM_ADAPTERS.map(adapter => adapter.render(m));
    await approvedContent(db, m, variants);
    const publishers = [fakePublisher('instagram'), fakePublisher('facebook', 'nourl'), fakePublisher('tiktok', 'down'), fakePublisher('x')];
    const restore = withEnv({ X_ACCESS_TOKEN: undefined });
    let run;
    try { run = await publishAll(db, { master: m, variants, publishers, origin: 'test', dryRun: false }); } finally { restore(); }
    const by = Object.fromEntries(run.outcomes.map(item => [item.platform, item]));
    assert.equal(by.instagram.status, 'published'); assert.equal(by.facebook.status, 'published');
    assert.equal(by.tiktok.status, 'failed'); assert.equal(by.x.status, 'blocked'); assert.match(by.x.detail, /Zugangsdaten fehlen/);
    assert.equal(publishers[3].calls.length, 0, 'no call without credentials');
    assert.equal(by.youtube, undefined, 'deliberately not provided format is not a failure');
    const report = require(`${L}/publishing/report`).formatPublishReport({ category: m.category, format: 'CAROUSEL', outcomes: run.outcomes });
    assert.match(report, /^Themen-Post, Karussell teilweise veröffentlicht/);
    assert.match(report, /• Facebook – veröffentlicht – Link nicht verfügbar/);
    // A second run cannot double-post the successful platforms: their stored result is reported, no call.
    const again = await publishAll(db, { master: m, variants, publishers, origin: 'retry', dryRun: false });
    const instagram = again.outcomes.find(item => item.platform === 'instagram');
    assert.deepEqual([instagram.status, instagram.reused, instagram.url], ['published', true, 'https://www.instagram.com/p/1']);
    assert.equal(publishers[0].calls.length, 1);
  } finally { await db.close(); }
});

test('without approval nothing is published even when live publishing is on', async () => {
  const db = await pgliteDatabase();
  try {
    const m = master();
    const variants = PLATFORM_ADAPTERS.map(adapter => adapter.render(m));
    await G.registerContentVersion(db, publishableContent(m, variants));
    const ig = fakePublisher('instagram');
    const run = await publishAll(db, { master: m, variants, publishers: [ig], origin: 'cron', dryRun: false });
    assert.equal(run.outcomes[0].status, 'blocked');
    assert.equal(ig.calls.length, 0);
  } finally { await db.close(); }
});

// ---------- end to end through WhatsApp ----------
// Test double for the semantic router (the real one is a model call). Maps example sentences to what the model returns.
const R = (over = {}) => ({ domain: 'topic', content_id: null, intent: 'change', format: null, slides: null, exclude_formats: [], tone: [], new_hook: false, cheaper: false,
  product_wish: null, answer: null, clarification_question: null, confidence: 0.95, ambiguity: 'none', ...over });
function fakeInterpreter(calls = []) {
  return async (body, context) => {
    calls.push({ body, context });
    const target = context.replying_to.content_id ?? (context.topic_drafts.length === 1 ? context.topic_drafts[0].content_id : null);
    const t = body.toLowerCase();
    if (/silbermatte|produktentwurf/.test(t)) return R({ domain: 'product', intent: 'other' });
    if (/das andere|irgendwas/.test(t)) return R({ domain: 'unclear', intent: 'clarify', clarification_question: 'Meinst du den Themenbeitrag oder den Produktentwurf?' });
    if (/karussell/.test(t)) return R({ content_id: target, slides: /vier/.test(t) ? 4 : null, format: 'CAROUSEL' });
    if (/nur bild/.test(t)) return R({ content_id: target, format: 'SINGLE_IMAGE' });
    if (/werblich/.test(t)) return R({ content_id: target, tone: ['less_promotional'] });
    if (/neues thema/.test(t)) return R({ content_id: target, intent: 'new_topic' });
    if (/passendes produkt/.test(t)) return R({ content_id: target, intent: 'request_products' });
    if (/fenster-beitrag/.test(t)) return R({ content_id: context.topic_drafts.find(item => /Fenster/.test(item.title))?.content_id ?? null, tone: ['more_humor'] });
    return R({ intent: 'other', content_id: target });
  };
}

function harness(db, over = {}) {
  const sent = [];
  let n = 0;
  const imageCalls = [];
  const imageProvider = { name: 'replicate', model: 'fake', available: () => ({ ok: true }),
    async generate(brief, options) { imageCalls.push(options.role); return png(imageCalls.length); } };
  const publishers = ['instagram', 'facebook', 'tiktok', 'youtube', 'x'].map(p => fakePublisher(p, over.behaviour?.[p] ?? 'ok'));
  const deps = { db, trustedWaId: OPERATOR, now: () => NOW, send: async text => { sent.push(text); return `wamid.out.${++n}`; },
    render: { ledger: memoryLedger(), imageProvider }, scoutOptions: { sources: [calendarSource(), evergreenSource()], sleep: async () => {} },
    publishers, rasterize: async asset => asset.kind === 'text_graphic' ? { ...asset, url: `https://x.public.blob.vercel-storage.com/r/${asset.sha256}.png`, mediaType: 'image/png', svg: undefined } : asset,
    liveEnabled: true, suggester: over.suggester ?? null, resolveProduct: over.resolveProduct ?? null, interpret: over.interpret ?? fakeInterpreter(over.interpretCalls), ...over.deps };
  const reply = (body, to, id) => handleTopicReply(deps, { id: id ?? `wamid.in.${Math.random()}`, from: OPERATOR, body, replyToMessageId: to });
  const free = (body, id) => routeTopicMessage(deps, { id: id ?? `wamid.free.${Math.random()}`, from: OPERATOR, body, replyToMessageId: null });
  return { deps, sent, reply, free, publishers, imageCalls, lastId: () => `wamid.out.${n}` };
}

test('end to end: proposal → production approval → publish approval → publish → report', async () => {
  const db = await pgliteDatabase();
  try {
    const h = harness(db);
    const run = await runTopicPipeline(h.deps, { slotKey: '2026-10-05:09' });
    assert.equal(run.status, 'proposed');
    assert.match(h.sent[0], /^Themenvorschlag · Themen-Post/);
    assert.match(h.sent[0], /Referenzmodus/);
    assert.match(h.sent[0], /Produkt: keins, kein Affiliate-Link/);
    assert.equal(h.imageCalls.length, 0, 'proposal is a dry run');
    assert.deepEqual(await runTopicPipeline(h.deps, { slotKey: '2026-10-05:09' }), { status: 'already_ran' });

    await h.reply('Freigeben', 'wamid.out.1');
    const approval = h.sent.at(-1);
    assert.match(approval, /^Veröffentlichungsfreigabe · Themen-Post/);
    assert.match(approval, /Kein Affiliate-Link/);
    assert.ok(h.publishers.every(publisher => publisher.calls.length === 0), 'nothing published before the publish approval');

    await h.reply('Freigeben', h.lastId());
    const report = h.sent.at(-1);
    assert.match(report, /^Themen-Post, (Karussell|Bild|Text) (veröffentlicht|teilweise veröffentlicht)/);
    assert.match(report, /• Instagram – veröffentlicht – https:\/\/www\.instagram\.com\/p\/1/);
    const stage = (await db.query('SELECT stage FROM topic_contents')).rows[0].stage;
    assert.ok(['published', 'partially_published'].includes(stage));
  } finally { await db.close(); }
});

test('rejection, missing answer and change requests never publish; a change creates a new version and a new request', async () => {
  const db = await pgliteDatabase();
  try {
    const h = harness(db);
    await runTopicPipeline(h.deps, { slotKey: 's1' });
    await h.reply('Mach daraus ein Karussell, nur vier Slides', 'wamid.out.1');
    assert.match(h.sent.at(-1), /Überarbeitung 2/);
    assert.match(h.sent.at(-1), /4 Slides \(Betreiberwunsch/);
    await h.reply('Freigeben', h.lastId());
    const firstApproval = h.lastId();
    // No answer → nothing happens.
    assert.ok(h.publishers.every(publisher => publisher.calls.length === 0));
    await h.reply('Weniger werblich', firstApproval);
    const secondApproval = h.lastId();
    assert.notEqual(secondApproval, firstApproval);
    assert.match(h.sent.at(-1), /Fassung 2/);
    // The old approval message can no longer approve anything.
    await h.reply('Freigeben', firstApproval);
    assert.match(h.sent.at(-1), /nicht mehr aktuell/);
    assert.ok(h.publishers.every(publisher => publisher.calls.length === 0));
    await h.reply('Ablehnen', secondApproval);
    assert.match(h.sent.at(-1), /Abgelehnt/);
    assert.ok(h.publishers.every(publisher => publisher.calls.length === 0));
    assert.equal((await db.query("SELECT count(*)::int AS n FROM topic_history WHERE status='rejected'")).rows[0].n, 1);
  } finally { await db.close(); }
});

test('"Neues Thema" discards the proposal and proposes a different topic; replays and strangers are ignored', async () => {
  const db = await pgliteDatabase();
  try {
    const h = harness(db);
    await runTopicPipeline(h.deps, { slotKey: 's1' });
    const firstTitle = h.sent[0].split('\n')[2];
    await h.reply('Neues Thema', 'wamid.out.1', 'wamid.same');
    assert.notEqual(h.sent.at(-1).split('\n')[2], firstTitle);
    const count = h.sent.length;
    await h.reply('Neues Thema', 'wamid.out.1', 'wamid.same'); // webhook replay
    assert.equal(h.sent.length, count);
    assert.equal(await handleTopicReply(h.deps, { id: 'wamid.x', from: '4900000', body: 'Freigeben', replyToMessageId: h.lastId() }), true);
    assert.equal(h.sent.length, count);
    assert.equal(await handleTopicReply(h.deps, { id: 'wamid.y', from: OPERATOR, body: 'Freigeben', replyToMessageId: 'wamid.unrelated' }), false);
  } finally { await db.close(); }
});

test('product coupling: only on explicit request, at most three suggestions, link only after the operator picks one', async () => {
  const db = await pgliteDatabase();
  try {
    const asked = [];
    const suggester = async (topic, wish) => { asked.push(wish); return [1, 2, 3, 4, 5].map(i => ({ name: `Produkt Idee ${i}`, reason: `Grund ${i}`, category: 'Haushalt', searchQuery: `idee ${i}` })); };
    const resolveProduct = async query => ({ name: `Geprüfter Artikel (${query})`, asin: 'B0TEST1234', affiliateUrl: AFFILIATE, sourceUrl: 'https://www.amazon.de/dp/B0TEST1234' });
    const h = harness(db, { suggester, resolveProduct });
    await runTopicPipeline(h.deps, { slotKey: 's1' });
    assert.equal(asked.length, 0, 'no product search by default');
    await h.reply('Such mir dazu ein passendes Produkt', 'wamid.out.1');
    const list = h.sent.at(-1);
    assert.match(list, /^Produktvorschläge/);
    assert.equal((list.match(/^\d\. /gm) || []).length, 3);
    const suggestions = h.lastId();
    await h.reply('vielleicht das zweite', suggestions);
    assert.match(h.sent.at(-1), /Produkt 1“, „Produkt 2“/);
    await h.reply('Produkt 2', suggestions);
    assert.match(h.sent.at(-1), /Produkt: Geprüfter Artikel \(idee 2\) \(mit Affiliate-Link/);
    assert.match(h.sent.at(-1), /^Themenvorschlag \(Überarbeitung 2\) · Affiliate-Post/);
    await h.reply('Freigeben', h.lastId());
    assert.match(h.sent.at(-1), /^Veröffentlichungsfreigabe · Affiliate-Post/);
    assert.ok(h.sent.at(-1).includes(`Affiliate-Link: ${AFFILIATE}`));
    assert.match(h.sent.at(-1), /Werbung \| Affiliate-Link/);
  } finally { await db.close(); }
});

test('sensitive topics never get product suggestions; the scout is not even asked', async () => {
  const result = await runTopicScout({ now: NOW, sleep: async () => {}, sources: [evergreenSource(3)] });
  const base = result.candidates[0];
  const disaster = { ...base, title: 'Hochwasser: Unglück im Süden', source_signals: [{ ...base.source_signals[0], title: 'Hochwasser: Unglück im Süden' }] };
  let called = 0;
  const suggester = async () => { called++; return [{ name: 'X', reason: 'y', category: null, searchQuery: 'x' }]; };
  for (const sensitive of [disaster, { ...base, gossip: true }, { ...base, sensitive: true }, { ...base, risk_score: 60 }]) {
    assert.ok(productCouplingBlocked(sensitive));
    assert.equal((await suggestProducts(sensitive, suggester, null)).ok, false);
  }
  assert.equal(called, 0);
  assert.equal(productCouplingBlocked(base), null);
  // Deterministic commands only; free product requests go through the semantic router.
  assert.equal(productListCommand('Produktvorschläge'), true);
  assert.equal(productListCommand('Such mir dazu ein passendes Produkt'), false);
  assert.equal(productSelection('Produkt 3'), 3);
  assert.equal(productSelection('Kein Produkt'), 'none');
  assert.equal(productSelection('Produkt 4'), null);
});

test('reference copy invents nothing: news points are attributed headlines, evergreen points restate scout data', async () => {
  const result = await runTopicScout({ now: NOW, sleep: async () => {}, sources: [evergreenSource(3)] });
  const copyText = referenceCopy(result.candidates[0]);
  assert.equal(copyText.origin, 'reference_template');
  assert.ok(copyText.points.every(point => [result.candidates[0].audience_problem, result.candidates[0].why_now, result.candidates[0].angle].includes(point.text)));
  assert.doesNotMatch(JSON.stringify(copyText), /\d+\s?%|garantiert|getestet/);
});

test('Status gives a readable topic pipeline summary without raw logs', async () => {
  const db = await pgliteDatabase();
  try {
    const h = harness(db);
    await runTopicPipeline(h.deps, { slotKey: 's1' });
    const text = await topicPipelineStatus(db, h.deps.render);
    assert.match(text, /Themen-Scout: gesund/);
    assert.match(text, /Trendquellen ok: Kalender, Evergreen/);
    assert.match(text, /Bilder \(Replicate\): verfügbar/);
    assert.match(text, /Avatar-Video: nicht verfügbar/);
    assert.match(text, /Plattformen und Anbieter:\n• Instagram: bereit/);
    assert.match(text, /• HeyGen \(Avatar-Video\): blockiert – HEYGEN_API_KEY/);
    assert.match(text, /Offen: 1 Themenvorschlag/);
    assert.doesNotMatch(text, /\{|\}|"event"/);
  } finally { await db.close(); }
});

test('signed webhook: a reply to a topic proposal reaches the topic pipeline, never the product router or keyword chain', async t => {
  const { createHmac } = require('node:crypto');
  const loadRoute = require('./helpers/load-route.cjs');
  const db = await pgliteDatabase();
  t.after(() => db.close());
  const env = { META_APP_SECRET: 'topic-signature', WHATSAPP_PHONE_NUMBER_ID: '123456', WHATSAPP_APPROVER_WA_ID: OPERATOR, TOPIC_PIPELINE_ENABLED: 'true', WHATSAPP_ROUTER_ENABLED: 'true' };
  const old = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => { for (const key of Object.keys(env)) { if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key]; } });
  const h = harness(db);
  await runTopicPipeline(h.deps, { slotKey: 'webhook' });
  const fail = name => async () => { throw new Error(`${name} must not run for topic replies`); };
  const handler = loadRoute('app/api/whatsapp/webhook/route.ts', {
    'next/server': { after: () => {} },
    '@/lib/memory/db': { getDatabase: () => db },
    '@/lib/production/repository': { productionRepository: () => ({ applyIncomingWhatsApp: fail('keyword chain') }) },
    '@/lib/whatsapp/router': { routeOperatorMessage: fail('semantic router') },
    '@/lib/whatsapp/start-image-post': { startImagePostFromWhatsApp: fail('image post'), startProductSearch: fail('product search') },
    '@/lib/daily/draft': { createDailyDraft: fail('daily draft'), sendDailyApproval: async () => true, sendPendingDailyApprovals: async () => 0 },
    '@/lib/whatsapp/client': { sendWhatsAppText: async () => 'wamid.x' },
    '@/lib/agents/topic-runtime': { topicPipelineDeps: () => h.deps },
  });
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '123456' },
    messages: [{ id: 'wamid.topic.reply', from: OPERATOR, type: 'text', text: { body: 'Nur Bild.' }, context: { id: 'wamid.out.1' } }] } }] }] });
  const request = new Request('https://local.test/api/whatsapp/webhook', { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', env.META_APP_SECRET).update(payload).digest('hex')}` }, body: payload });
  assert.equal((await handler.POST(request)).status, 200);
  assert.match(h.sent.at(-1), /Überarbeitung 2/);
  assert.match(h.sent.at(-1), /Format: Einzelbild · Kosten: niedrig · Entscheidung: dein Wunsch/);
});

async function throughPublishApproval(h) {
  await runTopicPipeline(h.deps, { slotKey: `s-${Math.random()}` });
  await h.reply('Freigeben', h.lastId());          // production approval
  const approval = h.lastId();
  await h.reply('Freigeben', approval);            // publish approval
  return approval;
}

test('multi-publisher: a failing platform never marks others as failed; "Wiederholen" retries only the failed one, no double posts', async () => {
  const db = await pgliteDatabase();
  try {
    const h = harness(db, { behaviour: { tiktok: 'down' } });
    const approval = await throughPublishApproval(h);
    const first = h.sent.at(-1);
    assert.match(first, /teilweise veröffentlicht/);
    assert.match(first, /• TikTok – fehlgeschlagen \(HTTP 503\)/);
    assert.match(first, /„Wiederholen“/);
    const counts = () => Object.fromEntries(h.publishers.map(publisher => [publisher.platform, publisher.calls.length]));
    const before = counts();
    // TikTok recovers; the retry touches only TikTok.
    h.publishers.find(publisher => publisher.platform === 'tiktok').publish = async (variant, master, context) => { await context.onRemoteId('tt'); return { state: 'published', externalId: 'tt-1', url: 'https://www.tiktok.com/@a/video/1' }; };
    await h.reply('Wiederholen', approval);
    const after = counts();
    for (const platform of ['instagram', 'facebook', 'x']) assert.equal(after[platform], before[platform], `${platform} not published again`);
    const report = h.sent.at(-1);
    assert.match(report, /• TikTok – veröffentlicht – https:\/\/www\.tiktok\.com\/@a\/video\/1/);
    assert.match(report, /• Instagram – veröffentlicht/);
    const rows = (await db.query("SELECT platform, status, external_id, url FROM publish_attempts WHERE status<>'blocked' ORDER BY platform, created_at")).rows;
    assert.equal(rows.filter(row => row.status === 'published').length, new Set(rows.filter(row => row.status === 'published').map(row => row.platform)).size, 'at most one published row per platform');
    assert.ok(rows.some(row => row.platform === 'tiktok' && row.status === 'failed'));
    assert.ok(rows.every(row => row.status !== 'published' || row.external_id));
    // A second retry finds nothing to retry and publishes nothing.
    await h.reply('Wiederholen', approval);
    assert.match(h.sent.at(-1), /keine fehlgeschlagene Plattform/);
    assert.deepEqual(counts(), { ...after });
  } finally { await db.close(); }
});

test('asynchronous platforms: "processing" is completed by reconciliation, never by publishing again', async () => {
  const db = await pgliteDatabase();
  try {
    const h = harness(db, { behaviour: { tiktok: 'processing' } });
    await throughPublishApproval(h);
    assert.match(h.sent.at(-1), /• TikTok – wird noch verarbeitet/);
    const { reconcileTopicPublications } = require(`${L}/topic-pipeline/orchestrator`);
    const settled = await reconcileTopicPublications(h.deps);
    assert.equal(settled, 1);
    assert.match(h.sent.at(-1), /• TikTok – veröffentlicht – https:\/\/www\.tiktok\.com\/p\/1/);
    assert.equal(h.publishers.find(publisher => publisher.platform === 'tiktok').calls.length, 1);
    assert.equal(await reconcileTopicPublications(h.deps), 0);
  } finally { await db.close(); }
});

// ---------- semantic routing: topic vs. product, several drafts, ambiguity ----------
async function openProductDraft(db) {
  const { memoryRepository } = require(`${L}/memory/repository`);
  const { publicationRepository } = require(`${L}/meta/publication-gate`);
  const { runContentJob } = require(`${L}/content/orchestrator`);
  const { opportunitySchema } = require(`${L}/content/schema`);
  const { approveContent } = require('./helpers/approve-content.cjs');
  const restore = withEnv({ WHATSAPP_APPROVER_WA_ID: OPERATOR });
  try {
    const memory = memoryRepository(db), publication = publicationRepository(db);
    const opportunity = opportunitySchema.parse({ product: { productVerifiedAt: '2026-10-05T06:00:00.000Z', productVerifiedName: 'Silbermatte', name: 'Silbermatte',
      sourceUrl: 'https://www.amazon.de/dp/B000000009', affiliateUrl: 'https://www.amazon.de/dp/B000000009?tag=alltaeglichle-21', price: '', targetGroup: 'Haushalte',
      benefits: 'Maße prüfen', notes: '' }, useCase: 'Backen ohne Backpapier an einem Sonntagnachmittag.', targetPlatform: 'facebook', budget: 'low' });
    const id = crypto.randomUUID();
    await memory.claim(id, opportunity, 'reference');
    await runContentJob(opportunity, { id, onUpdate: memory.save, loadLearning: memory.learn });
    await approveContent(db, memory, id);
    const pending = await publication.prepare(id, OPERATOR);
    await publication.claimImage(pending.id);
    await publication.bindImage(pending.id, `https://x.public.blob.vercel-storage.com/generated/facebook/${id}/${'b'.repeat(64)}.png`);
    await publication.claimWhatsAppSend(pending.id);
    await publication.bindMessage(pending.id, 'wamid.product.approval');
    return { jobId: id, publicationId: pending.id };
  } finally { restore(); }
}

test('free text without a quote: one open topic draft → changed; product messages are left to the product router', async () => {
  const db = await pgliteDatabase();
  try {
    const calls = [];
    const h = harness(db, { interpretCalls: calls });
    await runTopicPipeline(h.deps, { slotKey: 'r1' });
    assert.equal(await h.free('Mach daraus bitte ein Karussell mit vier Slides'), true);
    assert.match(h.sent.at(-1), /^Themenvorschlag \(Überarbeitung 2\)/);
    assert.match(h.sent.at(-1), /4 Slides \(Betreiberwunsch/);
    assert.equal(calls.at(-1).context.replying_to.kind, 'none');
    const count = h.sent.length;
    assert.equal(await h.free('Such mir lieber eine Silbermatte'), false, 'product pipeline message is not taken');
    assert.equal(h.sent.length, count);
    assert.equal(await h.free('Freigeben'), false, 'deterministic words never go through the topic router');
    assert.equal(await h.free('Status'), false);
  } finally { await db.close(); }
});

test('product and topic drafts open at the same time: unclear messages get a clarification, nothing is changed; replay is idempotent', async () => {
  const db = await pgliteDatabase();
  try {
    await openProductDraft(db);
    const calls = [];
    const h = harness(db, { interpretCalls: calls });
    await runTopicPipeline(h.deps, { slotKey: 'r2' });
    const before = (await db.query('SELECT revision FROM topic_contents')).rows[0].revision;
    assert.equal(await h.free('Ändere das andere bitte', 'wamid.same'), true);
    const clarification = h.sent.at(-1);
    assert.match(clarification, /Themenbeitrag oder den Produktentwurf/);
    assert.match(clarification, /• Themenbeitrag „/);
    assert.match(clarification, /• Produktentwurf „Silbermatte/);
    assert.equal(calls.at(-1).context.product_drafts.length, 1);
    assert.equal((await db.query('SELECT revision FROM topic_contents')).rows[0].revision, before);
    const count = h.sent.length;
    assert.equal(await h.free('Ändere das andere bitte', 'wamid.same'), true);
    assert.equal(h.sent.length, count, 'replay sends nothing');
    // A quoted product approval is never handled by the topic pipeline.
    assert.equal(await h.reply('Mach es weniger werblich', 'wamid.product.approval'), false);
  } finally { await db.close(); }
});

test('several topic drafts: the router picks the right one; without a clear target nothing changes', async () => {
  const db = await pgliteDatabase();
  try {
    const h = harness(db);
    await runTopicPipeline(h.deps, { slotKey: 'a' });
    await runTopicPipeline(h.deps, { slotKey: 'b', exclude: [(await db.query('SELECT topic_id FROM topic_contents')).rows[0].topic_id] });
    const rows = () => db.query("SELECT content_id, revision, candidate->'candidate'->>'title' AS title FROM topic_contents ORDER BY created_at").then(result => result.rows);
    const [first, second] = await rows();
    assert.equal(await h.free('Bitte etwas weniger werblich'), true);
    assert.match(h.sent.at(-1), /Welchen Entwurf meinst du/);
    assert.deepEqual((await rows()).map(row => row.revision), [1, 1]);
    const fenster = [first, second].find(row => /Fenster/.test(row.title));
    if (fenster) {
      assert.equal(await h.free('Beim Fenster-Beitrag bitte mehr Humor'), true);
      const after = await rows();
      assert.equal(after.find(row => row.content_id === fenster.content_id).revision, 2);
      assert.equal(after.find(row => row.content_id !== fenster.content_id).revision, 1);
    }
  } finally { await db.close(); }
});

test('quoted topic message: router failure or a product-domain answer changes nothing (no pattern fallback)', async () => {
  const db = await pgliteDatabase();
  try {
    const failing = harness(db, { interpret: async () => { throw new (require(`${L}/whatsapp/route-llm`).RouterUnavailable)('router_http_503'); } });
    await runTopicPipeline(failing.deps, { slotKey: 'f' });
    await failing.reply('Mach daraus ein Karussell', 'wamid.out.1');
    assert.match(failing.sent.at(-1), /nicht sicher verstehen.*nichts geändert/);
    assert.equal((await db.query('SELECT revision FROM topic_contents')).rows[0].revision, 1);
    const product = harness(db, { interpret: async () => R({ domain: 'product', intent: 'other' }) });
    await product.reply('Bild vom Produkt neu', 'wamid.out.1');
    assert.match(product.sent.at(-1), /Produktentwurf, nicht nach dem Themenbeitrag/);
    assert.equal((await db.query('SELECT revision FROM topic_contents')).rows[0].revision, 1);
  } finally { await db.close(); }
});

test('a change during the publish approval voids that approval at once; the old approval message cannot approve the new version', async () => {
  const db = await pgliteDatabase();
  try {
    const h = harness(db);
    await runTopicPipeline(h.deps, { slotKey: 'c' });
    await h.reply('Freigeben', 'wamid.out.1');
    const firstApproval = h.lastId();
    const contentId = (await db.query('SELECT content_id FROM topic_contents')).rows[0].content_id;
    assert.equal((await G.approvalState(db, contentId)).status, 'pending');
    // Free text without a quote, semantically assigned to the only open topic draft.
    assert.equal(await h.free('Mach das weniger werblich'), true);
    const versions = (await db.query('SELECT version, status, reason FROM publish_approvals ORDER BY version')).rows;
    assert.deepEqual(versions.map(row => [row.version, row.status]), [[1, 'invalidated'], [2, 'pending']]);
    assert.equal(versions[0].reason, 'operator_change');
    assert.match(h.sent.at(-1), /Fassung 2/);
    await h.reply('Freigeben', firstApproval);
    assert.match(h.sent.at(-1), /nicht mehr aktuell/);
    assert.ok(h.publishers.every(publisher => publisher.calls.length === 0));
  } finally { await db.close(); }
});

test('signed webhook: a free message without a quote is assigned to the open topic draft before the product router', async t => {
  const { createHmac } = require('node:crypto');
  const loadRoute = require('./helpers/load-route.cjs');
  const db = await pgliteDatabase();
  t.after(() => db.close());
  const restore = withEnv({ META_APP_SECRET: 'topic-signature-2', WHATSAPP_PHONE_NUMBER_ID: '123456', WHATSAPP_APPROVER_WA_ID: OPERATOR, TOPIC_PIPELINE_ENABLED: 'true', WHATSAPP_ROUTER_ENABLED: 'true' });
  t.after(restore);
  const h = harness(db);
  await runTopicPipeline(h.deps, { slotKey: 'webhook-free' });
  const fail = name => async () => { throw new Error(`${name} must not run`); };
  const handler = loadRoute('app/api/whatsapp/webhook/route.ts', {
    'next/server': { after: () => {} }, '@/lib/memory/db': { getDatabase: () => db },
    '@/lib/production/repository': { productionRepository: () => ({ applyIncomingWhatsApp: fail('keyword chain') }) },
    '@/lib/whatsapp/router': { routeOperatorMessage: fail('product router') },
    '@/lib/whatsapp/start-image-post': { startImagePostFromWhatsApp: fail('image post'), startProductSearch: fail('product search') },
    '@/lib/daily/draft': { createDailyDraft: fail('daily draft'), sendDailyApproval: async () => true, sendPendingDailyApprovals: async () => 0 },
    '@/lib/whatsapp/client': { sendWhatsAppText: async () => 'wamid.x' },
    '@/lib/agents/topic-runtime': { topicPipelineDeps: () => h.deps },
  });
  const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: '123456' },
    messages: [{ id: 'wamid.topic.free', from: OPERATOR, type: 'text', text: { body: 'Mach das bitte weniger werblich' } }] } }] }] });
  const request = () => new Request('https://local.test/api/whatsapp/webhook', { method: 'POST', headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', 'topic-signature-2').update(payload).digest('hex')}` }, body: payload });
  assert.equal((await handler.POST(request())).status, 200);
  assert.match(h.sent.at(-1), /Überarbeitung 2/);
  const count = h.sent.length;
  assert.equal((await handler.POST(request())).status, 200, 'Meta redelivery');
  assert.equal(h.sent.length, count);
});

test('invariant: a second "Freigeben" after publishing publishes nothing again', async () => {
  const db = await pgliteDatabase();
  try {
    const h = harness(db);
    const approval = await throughPublishApproval(h);
    const calls = () => h.publishers.reduce((sum, publisher) => sum + publisher.calls.length, 0);
    const before = calls();
    assert.ok(before > 0);
    await h.reply('Freigeben', approval);
    assert.match(h.sent.at(-1), /nicht mehr aktuell oder bereits entschieden/);
    assert.equal(calls(), before);
  } finally { await db.close(); }
});
