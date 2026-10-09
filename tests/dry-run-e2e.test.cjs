const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = '../.test-build/lib';
const { runTopicPipeline, handleTopicReply, routeTopicMessage } = require(`${L}/topic-pipeline/orchestrator`);
const { topicPipelineStatus } = require(`${L}/topic-pipeline/status`);
const { defaultPublishers } = require(`${L}/distribution/publishers`);
const { memoryLedger } = require(`${L}/visual/ledger`);
const { calendarSource, evergreenSource } = require(`${L}/topics/sources/offline`);
const { setEventSink } = require(`${L}/observability/events`);
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { withEnv } = require('./helpers/live-env.cjs');

setEventSink(() => {});
const OPERATOR = '491701234567';
const NOW = new Date('2026-10-05T07:00:00Z');
const AFFILIATE = 'https://www.amazon.de/dp/B0TEST1234?tag=alltaeglichle-21';
const newsSource = signals => ({ id: 'google_news_rss', configured: () => true, fetch: async () => signals });
const news = (title, publisher, hours) => ({ source: 'google_news_rss', kind: 'news', title, snippet: '', url: `https://${publisher}/a/${encodeURIComponent(title).slice(0, 24)}`, publisher, publisherUrl: null,
  publishedAt: new Date(NOW.getTime() - hours * 3600e3).toISOString(), eventDate: null, fetchedAt: NOW.toISOString(), strength: 0.6, tags: [] });
const R = over => ({ domain: 'topic', content_id: null, intent: 'change', format: null, slides: null, exclude_formats: [], tone: [], new_hook: false, cheaper: false, product_wish: null,
  answer: null, clarification_question: null, confidence: 0.95, ambiguity: 'none', ...over });

function harness(db, extra = {}) {
  const sent = [], fetches = [];
  let n = 0;
  const interpret = async (body, context) => {
    const id = context.replying_to.content_id ?? context.topic_drafts[0]?.content_id ?? null;
    if (/karussell/i.test(body)) return R({ content_id: id, format: 'CAROUSEL', slides: 4, exclude_formats: ['AVATAR_VIDEO'] });
    if (/passendes produkt/i.test(body)) return R({ content_id: id, intent: 'request_products' });
    return R({ content_id: id, intent: 'other' });
  };
  const imageProvider = { name: 'replicate', model: 'fake', available: () => ({ ok: true }), async generate(brief, options) {
    return { kind: 'image', url: `https://x.public.blob.vercel-storage.com/generated/topics/tc/${options.role}.png`, sha256: 'a'.repeat(64), mediaType: 'image/png', provider: 'replicate' }; } };
  const deps = { db, trustedWaId: OPERATOR, now: () => NOW, send: async text => { sent.push(text); return `wamid.e2e.${++n}`; }, interpret,
    render: { ledger: memoryLedger(), imageProvider }, scoutOptions: { sources: [newsSource(extra.news ?? []), calendarSource(), evergreenSource()], sleep: async () => {} },
    // The REAL publishers: in a dry run none of them may make a network call.
    publishers: defaultPublishers(), rasterize: async asset => asset.kind === 'text_graphic' ? { ...asset, url: `https://x.public.blob.vercel-storage.com/r/${asset.sha256.slice(0, 16)}.png`, mediaType: 'image/png', svg: undefined } : asset,
    suggester: async () => [1, 2, 3, 4].map(i => ({ name: `Lüftungshelfer ${i}`, reason: `passt zum Thema (${i})`, category: 'Haushalt', searchQuery: `lueftung ${i}` })),
    resolveProduct: async query => ({ name: `Geprüfter Artikel ${query}`, asin: 'B0TEST1234', affiliateUrl: AFFILIATE, sourceUrl: 'https://www.amazon.de/dp/B0TEST1234' }), ...extra.deps };
  const reply = (body, to) => handleTopicReply(deps, { id: `wamid.in.${Math.random()}`, from: OPERATOR, body, replyToMessageId: to });
  const free = body => routeTopicMessage(deps, { id: `wamid.free.${Math.random()}`, from: OPERATOR, body, replyToMessageId: null });
  return { deps, sent, fetches, reply, free, last: () => `wamid.e2e.${n}` };
}

test('full dry run: scout → Jarvis → proposal → free-text change → new draft → production approval → preview → publish approval → dry-run per platform', async t => {
  // Live switch OFF (default), some credentials present, some missing: nothing may be posted, no network call.
  const restore = withEnv({ TOPIC_LIVE_PUBLISHING: undefined, TOPIC_PLATFORMS: 'instagram,facebook,tiktok,youtube,x', META_SYSTEM_USER_TOKEN: 'val-meta-token-987', META_PAGE_ID: 'val-page-1', META_INSTAGRAM_USER_ID: 'val-ig-2',
    BLOB_READ_WRITE_TOKEN: 'val-blob-3', TIKTOK_ACCESS_TOKEN: undefined, TIKTOK_REFRESH_TOKEN: undefined, YOUTUBE_REFRESH_TOKEN: undefined, X_API_KEY: undefined });
  t.after(restore);
  t.mock.method(global, 'fetch', async url => { throw new Error(`network call in dry run: ${url}`); });
  const db = await pgliteDatabase();
  t.after(() => db.close());
  const h = harness(db, { news: [news('Zeitumstellung: Diese Geräte musst du umstellen', 'tagesschau.de', 5), news('Zeitumstellung Ende Oktober: Welche Uhren umstellen?', 'spiegel.de', 8),
    news('Promi Y: Liebes-Aus nach drei Jahren', 'promiflash.de', 2)] });

  // Scout + Jarvis: gossip rejected, a topic proposed.
  const run = await runTopicPipeline(h.deps, { slotKey: 'e2e' });
  assert.equal(run.status, 'proposed');
  const verdicts = (await db.query('SELECT title, decision FROM topic_candidates')).rows;
  assert.equal(verdicts.find(row => /Liebes-Aus/.test(row.title)).decision, 'reject');
  assert.match(h.sent[0], /^Themenvorschlag · Themen-Post/);

  // Free-text change (semantic router) → new draft (revision 2) as a new proposal message.
  assert.equal(await h.free('Mach daraus lieber ein Karussell mit vier Slides, ohne Avatar'), true);
  assert.match(h.sent.at(-1), /^Themenvorschlag \(Überarbeitung 2\)/);
  assert.match(h.sent.at(-1), /4 Slides \(Betreiberwunsch/);
  const proposal = h.last();
  await h.reply('Freigeben', 'wamid.e2e.1');
  assert.match(h.sent.at(-1), /veraltet.*nichts geändert oder freigegeben/, 'the old proposal message is void');

  // First approval → production → preview (publish approval request).
  await h.reply('Freigeben', proposal);
  const preview = h.sent.at(-1);
  assert.match(preview, /^Veröffentlichungsfreigabe · Themen-Post, Karussell · Fassung 1/);
  assert.match(preview, /Live-Veröffentlichung ist ausgeschaltet/);
  assert.match(preview, /• YouTube Shorts: wird nicht veröffentlicht/);
  assert.match(preview, /Kein Affiliate-Link/);

  // Second approval → multi-publisher dry run → status per platform.
  await h.reply('Freigeben', h.last());
  const dry = h.sent.at(-1);
  assert.match(dry, /^Probelauf \(Dry-Run\): Themen-Post, Karussell – nichts veröffentlicht/);
  assert.match(dry, /• Instagram: carousel, Link: kein_link – Freigabe\/Schalter: Live-Veröffentlichung aus/);
  assert.match(dry, /• Facebook: album, Link: quellenlink – Freigabe\/Schalter: Live-Veröffentlichung aus/);
  assert.match(dry, /• TikTok: photo_slideshow.* – Zugang fehlt: TIKTOK_ACCESS_TOKEN/);
  assert.match(dry, /• YouTube Shorts: nicht vorgesehen/);
  assert.match(dry, /• X: text_with_images.* – Zugang fehlt: X_API_KEY/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM publish_attempts WHERE status IN ('claimed','processing','published','unknown')")).rows[0].n, 0);
  const status = await topicPipelineStatus(db, h.deps.render);
  assert.match(status, /• TikTok: blockiert – TIKTOK_ACCESS_TOKEN oder TIKTOK_REFRESH_TOKEN/);
  assert.match(status, /• Instagram: Zugang vorhanden, Live-Veröffentlichung aus \(TOPIC_LIVE_PUBLISHING\) – nur Dry-Run/);
  assert.doesNotMatch(status, /val-/, 'never a credential value');
  assert.doesNotMatch(dry, /val-/);
});

test('dry run with optional product coupling: max 3 candidates, link only after "Produkt N"; sensitive topics never get products', async t => {
  const restore = withEnv({ TOPIC_LIVE_PUBLISHING: undefined });
  t.after(restore);
  t.mock.method(global, 'fetch', async url => { throw new Error(`network call in dry run: ${url}`); });
  const db = await pgliteDatabase();
  t.after(() => db.close());
  const h = harness(db);
  await runTopicPipeline(h.deps, { slotKey: 'product' });
  assert.match(h.sent[0], /Produkt: keins, kein Affiliate-Link/);
  await h.reply('Such mir dazu ein passendes Produkt', 'wamid.e2e.1');
  const list = h.sent.at(-1);
  assert.equal((list.match(/^\d\. /gm) || []).length, 3);
  assert.doesNotMatch(list, /amazon\./, 'no link in suggestions');
  const proposalBefore = h.sent.find(text => text.startsWith('Themenvorschlag'));
  assert.doesNotMatch(proposalBefore, /amazon\./);
  await h.reply('Produkt 2', h.last());
  assert.match(h.sent.at(-1), /Affiliate-Post/);
  await h.reply('Freigeben', h.last());
  const preview = h.sent.at(-1);
  assert.ok(preview.includes(`Affiliate-Link: ${AFFILIATE}`));
  assert.match(preview, /Kennzeichnung: Werbung \| Affiliate-Link/);
  await h.reply('Freigeben', h.last());
  assert.match(h.sent.at(-1), /^Probelauf \(Dry-Run\): Affiliate-Post/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM publish_attempts WHERE status IN ('claimed','processing','published','unknown')")).rows[0].n, 0);

  // Sensitive topic: the product request is refused before the scout is asked.
  let asked = 0;
  const sensitive = harness(db, { news: [news('Hochwasser: Unglück im Süden mit Verletzten', 'tagesschau.de', 3)], deps: { suggester: async () => { asked++; return []; } } });
  const row = { candidate: (await db.query('SELECT candidate FROM topic_contents LIMIT 1')).rows[0].candidate };
  const { suggestProducts } = require(`${L}/topic-pipeline/product-coupling`);
  const disaster = { ...row.candidate.candidate, title: 'Hochwasser: Unglück im Süden', source_signals: [{ ...row.candidate.candidate.source_signals[0], title: 'Hochwasser: Unglück im Süden' }] };
  assert.equal((await suggestProducts(disaster, sensitive.deps.suggester, null)).ok, false);
  assert.equal(asked, 0);
});
