const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const B = '../.test-build/lib';
const { runTopicScout, clusterSignals, topicIdFor, conceptKey } = require(`${B}/topics/scout`);
const { runSource, SourceError } = require(`${B}/topics/resilience`);
const { topicGate, combineTopicVerdicts } = require(`${B}/topics/gate`);
const { discoverTopic, gateCandidates } = require(`${B}/topics/discovery`);
const { evaluateHistory } = require(`${B}/topics/history`);
const { calendarSource, evergreenSource, easterSunday, germanCalendar } = require(`${B}/topics/sources/offline`);
const { googleNewsRssSource, googleTrendsRssSource, wikipediaPageviewsSource, tavilyNewsSource } = require(`${B}/topics/sources/network`);
const { TavilyHttpError } = require(`${B}/tavily`);
const { topicCandidateSchema } = require(`${B}/topics/schema`);
const repo = require(`${B}/topics/repository`);
const { setEventSink, recentEvents, clearRecentEvents } = require(`${B}/observability/events`);
const pgliteDatabase = require('./helpers/pglite-db.cjs');

const lines = [];
setEventSink(line => lines.push(line));
const NOW = new Date('2026-10-05T07:00:00Z');
const noSleep = async () => {};
const iso = hours => new Date(NOW.getTime() - hours * 3600e3).toISOString();
const news = (title, publisher, hours, over = {}) => ({ source: 'google_news_rss', kind: 'news', title, snippet: '', url: `https://${publisher}/artikel/${encodeURIComponent(title).slice(0, 30)}`,
  publisher, publisherUrl: null, publishedAt: iso(hours), eventDate: null, fetchedAt: NOW.toISOString(), strength: 0.5, tags: [], ...over });
const source = (id, impl, over = {}) => ({ id, configured: () => true, fetch: impl, ...over });
const staticSource = (id, signals) => source(id, async () => signals);
const failing = (id, error) => source(id, async () => { throw error; });
const offline = () => [calendarSource(), evergreenSource()];

test('a healthy source delivers validated signals and an ok health record', async () => {
  const result = await runSource(staticSource('google_news_rss', [news('Zeitumstellung: Welche Uhren umstellen', 'tagesschau.de', 4)]), { now: NOW, sleep: noSleep });
  assert.equal(result.health.status, 'ok');
  assert.equal(result.health.attempts, 1);
  assert.equal(result.signals.length, 1);
});

test('a hanging source times out per attempt, is retried with backoff and then isolated', async () => {
  const delays = [];
  const hanging = source('tavily_news', () => new Promise(() => {}));
  const result = await runSource(hanging, { now: NOW, policy: { timeoutMs: 20, attempts: 2, baseDelayMs: 100 }, sleep: async ms => { delays.push(ms); } });
  assert.equal(result.health.status, 'failed');
  assert.equal(result.health.errorKind, 'timeout');
  assert.equal(result.health.attempts, 2);
  assert.deepEqual(delays, [100]);
});

test('HTTP 429 is classified as rate_limited, honours Retry-After and stops after the bounded retries', async () => {
  let calls = 0;
  const delays = [];
  const limited = source('google_trends_rss', async ({ request }) => { calls++; const response = await request('https://trends.google.com/x'); throw require(`${B}/topics/resilience`).httpError(response); });
  const request = async () => new Response('slow down', { status: 429, headers: { 'retry-after': '3' } });
  const result = await runSource(limited, { now: NOW, request, sleep: async ms => { delays.push(ms); } });
  assert.equal(result.health.errorKind, 'rate_limited');
  assert.equal(result.health.httpStatus, 429);
  assert.equal(calls, 3);
  assert.deepEqual(delays, [3000, 3000]);
});

test('auth errors and invalid responses are not retried', async () => {
  let calls = 0;
  const auth = await runSource(source('tavily_news', async () => { calls++; throw new SourceError('auth', 401); }), { now: NOW, sleep: noSleep });
  assert.equal(auth.health.errorKind, 'auth');
  assert.equal(calls, 1);
  const invalid = await runSource(source('wikipedia_pageviews', async () => [{ nonsense: true }]), { now: NOW, sleep: noSleep });
  assert.equal(invalid.health.errorKind, 'invalid_response');
  assert.equal(invalid.health.attempts, 1);
});

test('an unconfigured source is skipped without a network call', async () => {
  const previous = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  try {
    const result = await runSource(tavilyNewsSource(async () => { throw new Error('must not be called'); }), { now: NOW, sleep: noSleep });
    assert.equal(result.health.status, 'skipped');
    assert.equal(result.health.errorKind, 'not_configured');
  } finally { if (previous !== undefined) process.env.TAVILY_API_KEY = previous; }
});

test('one source down: the other sources keep working and the run is marked degraded', async () => {
  const result = await runTopicScout({ now: NOW, sleep: noSleep, sources: [
    failing('tavily_news', new SourceError('unavailable', 503)),
    staticSource('google_news_rss', [news('Zeitumstellung: Welche Uhren umstellen', 'tagesschau.de', 4), news('Zeitumstellung Ende Oktober: Geräte prüfen', 'spiegel.de', 6)]),
    ...offline()] });
  assert.equal(result.outcome, 'degraded');
  assert.equal(result.sourceHealth.find(item => item.source === 'tavily_news').status, 'failed');
  assert.ok(result.candidates.some(candidate => /Zeitumstellung/.test(candidate.title)));
  assert.ok(recentEvents('topic_source_failed').some(event => event.fields.source === 'tavily_news'));
});

test('all network sources down: offline calendar/evergreen fallback still yields candidates', async () => {
  const result = await runTopicScout({ now: NOW, sleep: noSleep, sources: [
    failing('tavily_news', new SourceError('timeout')), failing('google_news_rss', new SourceError('unavailable', 502)),
    failing('google_trends_rss', new SourceError('rate_limited', 429)), failing('wikipedia_pageviews', new Error('fetch failed')), ...offline()] });
  assert.equal(result.outcome, 'offline_fallback');
  assert.ok(result.candidates.length >= 3);
  assert.ok(result.candidates.every(candidate => ['calendar', 'evergreen'].includes(candidate.source_signals[0].kind)));
  for (const candidate of result.candidates) assert.equal(topicCandidateSchema.safeParse(candidate).success, true);
});

test('even a throwing scout never crashes discovery (product trend scout stays independent)', async () => {
  const selection = await discoverTopic({ now: NOW, scout: async () => { throw new TypeError('boom'); } });
  assert.equal(selection.selected, null);
  assert.match(selection.failure, /^scout_failed/);
});

test('a good current multi-source topic is accepted and selected with full structured output', async () => {
  const selection = await discoverTopic({ now: NOW, sleep: noSleep, sources: [
    staticSource('google_news_rss', [news('Zeitumstellung: Diese Geräte musst du umstellen', 'tagesschau.de', 5), news('Zeitumstellung Ende Oktober: Welche Uhren umstellen?', 'spiegel.de', 8)]),
    calendarSource()] });
  const chosen = selection.selected;
  assert.ok(chosen);
  assert.match(chosen.title, /Zeitumstellung/);
  assert.equal(chosen.trend_type, 'SEASONAL');
  assert.equal(chosen.fact_status, 'multi_source');
  for (const key of ['topic_id', 'title', 'trend_type', 'source_signals', 'source_urls', 'detected_at', 'relevance_score', 'virality_score', 'brand_fit_score', 'risk_score',
    'audience_problem', 'why_now', 'hook', 'angle', 'core_message', 'suggested_format', 'suitable_for_video', 'suitable_for_avatar', 'visual_potential', 'product_optional',
    'possible_product_category', 'confidence']) assert.ok(key in chosen, key);
  assert.equal(chosen.source_urls.length, 2);
  assert.ok(chosen.source_signals.every(signal => signal.fetched_at && 'published_at' in signal && 'event_date' in signal));
  assert.equal(chosen.source_signals.find(signal => signal.kind === 'calendar').event_date, '2026-10-25');
  for (const [key, value] of Object.entries(chosen.scores)) assert.ok(value.factors.length, `factors for ${key}`);
  assert.equal(selection.verdicts.find(item => item.topic_id === chosen.topic_id).decision, 'accept');
});

test('bad brand fit (political/crime news) is rejected by Jarvis', async () => {
  const result = await runTopicScout({ now: NOW, sleep: noSleep, sources: [staticSource('google_news_rss', [
    news('Bundestagswahl: Partei streitet über Migration', 'tagesschau.de', 2), news('Bundestagswahl Partei Streit Migration Debatte', 'zeit.de', 3)])] });
  const gated = gateCandidates(result, { now: NOW });
  assert.equal(gated.verdicts[0].decision, 'reject');
  assert.ok(gated.verdicts[0].checks.brand_fit.passed === false || gated.verdicts[0].checks.risk.passed === false);
  assert.equal(gated.accepted.length, 0);
});

test('a fact without a resilient source (single unknown publisher) is blocked', async () => {
  const result = await runTopicScout({ now: NOW, sleep: noSleep, sources: [staticSource('google_news_rss', [news('Kurioser Fund: Riesenkürbis im Stadtpark aufgetaucht', 'irgendein-blog.example', 3)])] });
  const verdict = topicGate(result.candidates[0], { now: NOW });
  assert.equal(result.candidates[0].fact_status, 'unverified');
  assert.equal(verdict.decision, 'reject');
  assert.equal(verdict.checks.facts.passed, false);
  assert.match(verdict.checks.facts.note, /ohne ausreichende Quelle/);
});

test('a sensitive claim from a single tabloid source is blocked; gossip is rejected', async () => {
  const result = await runTopicScout({ now: NOW, sleep: noSleep, sources: [staticSource('google_news_rss', [
    news('Schauspieler X stirbt mit 80 Jahren', 'bild.de', 3), news('Promi Y: Liebes-Aus nach drei Jahren', 'promiflash.de', 2)])] });
  const gated = gateCandidates(result, { now: NOW });
  assert.equal(gated.accepted.length, 0);
  const gossip = result.candidates.find(candidate => /Liebes-Aus/.test(candidate.title));
  assert.equal(gossip.gossip, true);
  assert.equal(gated.verdicts.find(item => item.topic_id === gossip.topic_id).checks.gossip.passed, false);
});

test('search-only trend without a reporting source is not turned into a factual post', async () => {
  const result = await runTopicScout({ now: NOW, sleep: noSleep, sources: [staticSource('google_trends_rss', [{ source: 'google_trends_rss', kind: 'search', title: 'Max Mustermann',
    snippet: 'ca. 20000+ Suchanfragen', url: null, publisher: 'trends.google.com', publisherUrl: null, publishedAt: iso(2), eventDate: null, fetchedAt: NOW.toISOString(), strength: 0.9, tags: ['Max Mustermann'] }])] });
  assert.equal(result.candidates[0].trend_type, 'SEARCH_TREND');
  assert.equal(topicGate(result.candidates[0], { now: NOW }).decision, 'reject');
});

test('duplicates: two headlines about the same event become one candidate with a stable topic_id', async () => {
  const signals = [news('Netflix-Serie Dark: Neue Staffel startet', 'kino.de', 5), news('Netflix-Serie Dark kehrt mit neuer Staffel zurück', 'filmstarts.de', 6)];
  const clusters = clusterSignals(signals);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].signals.length, 2);
  const first = await runTopicScout({ now: NOW, sleep: noSleep, sources: [staticSource('google_news_rss', signals)] });
  const second = await runTopicScout({ now: NOW, sleep: noSleep, sources: [staticSource('google_news_rss', [...signals].reverse())] });
  assert.equal(first.candidates.length, 1);
  assert.equal(first.candidates[0].topic_id, second.candidates[0].topic_id);
  assert.equal(topicIdFor(conceptKey('Netflix-Serie Dark: Neue Staffel startet')), topicIdFor(conceptKey('Netflix-Serie Dark: Neue Staffel startet')));
});

test('old topic: news older than 30 days is dropped, older than a week is rejected by Jarvis', async () => {
  const result = await runTopicScout({ now: NOW, sleep: noSleep, sources: [staticSource('google_news_rss', [
    news('Heizkosten sparen: Tipps der Verbraucherzentrale', 'verbraucherzentrale.de', 24 * 10), news('Uralte Meldung über Kalk im Bad', 'zeit.de', 24 * 40)])] });
  assert.ok(result.dropped.some(item => /älter als 30 Tage/.test(item.reason)));
  const verdict = topicGate(result.candidates[0], { now: NOW });
  assert.equal(verdict.decision, 'reject');
  assert.match(verdict.checks.freshness.note, /Altes Thema/);
});

test('cooldown: published or rejected topics are blocked; repeated proposals stop; similar hooks ask for a variant', async () => {
  const base = { topic_id: 'tp_0000000000000001', concept_key: 'fenster-kondenswasser', title: 'Beschlagene Fenster im Herbst', hook: 'Beschlagene Fenster? Diese einfachen Schritte helfen', audience_problem: 'Kondenswasser' };
  const at = new Date(NOW.getTime() - 3 * 86400e3).toISOString();
  assert.equal(evaluateHistory(base, [{ ...base, status: 'published', at }], NOW).blocked, true);
  assert.equal(evaluateHistory(base, [{ ...base, status: 'rejected', at }], NOW).blocked, true);
  assert.equal(evaluateHistory(base, [{ ...base, status: 'proposed', at }, { ...base, status: 'proposed', at }], NOW).blocked, true);
  assert.equal(evaluateHistory(base, [{ ...base, status: 'published', at: new Date(NOW.getTime() - 40 * 86400e3).toISOString() }], NOW).blocked, false);
  const similarHook = evaluateHistory({ ...base, topic_id: 'tp_0000000000000002', concept_key: 'anderes', title: 'Ganz anderes Thema' },
    [{ ...base, topic_id: 'tp_0000000000000009', concept_key: 'x', title: 'y', status: 'published', at }], NOW);
  assert.equal(similarHook.blocked, false);
  assert.equal(similarHook.hookRepeated, true);
  // Product history of the existing trend scout is shared.
  const products = { rejected: [{ group: null, concept: 'fenster-kondenswasser', name: 'Fenstersauger' }], recent: [] };
  assert.equal(evaluateHistory(base, [], NOW, products).blocked, true);

  const result = await runTopicScout({ now: NOW, sleep: noSleep, sources: [evergreenSource(22)] });
  const target = result.candidates[0];
  const blocked = await runTopicScout({ now: NOW, sleep: noSleep, sources: [evergreenSource(22)], history: [{ ...target, status: 'published', at }] });
  assert.ok(!blocked.candidates.some(candidate => candidate.topic_id === target.topic_id));
  assert.ok(blocked.dropped.some(item => /Cooldown/.test(item.reason)));
});

test('Jarvis accepts a good topic, revises sensational tone, asks for a variant on hook repetition and rejects unsupported claims', async () => {
  const result = await runTopicScout({ now: NOW, sleep: noSleep, sources: [evergreenSource(22)] });
  const good = result.candidates.find(candidate => /Fenster/.test(candidate.title));
  assert.equal(topicGate(good, { now: NOW }).decision, 'accept');
  const loud = topicGate({ ...good, hook: 'SCHOCK!! Beschlagene Fenster sind unfassbar gefährlich' }, { now: NOW });
  assert.equal(loud.decision, 'revise');
  assert.doesNotMatch(loud.revised.hook, /schock|unfassbar|!!/i);
  const claim = topicGate({ ...good, hook: 'Garantiert nie wieder beschlagene Fenster im Herbst' }, { now: NOW });
  assert.equal(claim.decision, 'request_variant');
  assert.equal(claim.checks.unsupported_claims.passed, false);
  // History with the same hook: Jarvis asks for a variant; discovery produces one or rejects after two tries.
  const history = [{ ...good, topic_id: 'tp_00000000000000aa', concept_key: 'other', title: 'Anderes', status: 'published', at: iso(48) }];
  assert.equal(topicGate(good, { now: NOW, history }).decision, 'request_variant');
  const gated = gateCandidates({ ...result, candidates: [good] }, { now: NOW, history });
  assert.equal(gated.verdicts[0].decision, 'accept');
  assert.notEqual(gated.candidates[0].hook, good.hook);
});

test('a model opinion can make Jarvis stricter, never more lenient', async () => {
  const result = await runTopicScout({ now: NOW, sleep: noSleep, sources: [evergreenSource(3)] });
  const rules = topicGate(result.candidates[0], { now: NOW });
  assert.equal(combineTopicVerdicts(rules, { decision: 'reject', reasons: ['zu beliebig'] }).decision, 'reject');
  const rejected = { ...rules, decision: 'reject' };
  assert.equal(combineTopicVerdicts(rejected, { decision: 'accept', reasons: [] }).decision, 'reject');
  assert.equal(combineTopicVerdicts(rules, { decision: 'nonsense' }).decision, rules.decision);
});

test('German calendar: Easter, DST change, Advent and Black Friday are computed correctly', async () => {
  assert.equal(easterSunday(2026).toISOString().slice(0, 10), '2026-04-05');
  assert.equal(easterSunday(2027).toISOString().slice(0, 10), '2027-03-28');
  const events = Object.fromEntries(germanCalendar(2026).map(event => [event.key, event.date.toISOString().slice(0, 10)]));
  assert.equal(events['zeitumstellung-winter'], '2026-10-25');
  assert.equal(events['zeitumstellung-sommer'], '2026-03-29');
  assert.equal(events['erster-advent'], '2026-11-29');
  assert.equal(events['black-friday'], '2026-11-27');
  assert.equal(events['muttertag'], '2026-05-10');
  const signals = await calendarSource().fetch({ now: NOW });
  assert.ok(signals.some(signal => signal.eventDate === '2026-10-25'));
  assert.ok(signals.every(signal => signal.url === null && signal.kind === 'calendar'));
});

const rss = items => `<?xml version="1.0"?><rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss"><channel><title>x</title>${items}</channel></rss>`;

test('Google News RSS items are parsed into dated, attributed news signals', async () => {
  const xml = rss(`<item><title>Zeitumstellung: Welche Uhren umstellen? - tagesschau.de</title><link>https://news.google.com/rss/articles/abc</link>
    <pubDate>Mon, 05 Oct 2026 05:00:00 GMT</pubDate><source url="https://www.tagesschau.de">tagesschau.de</source></item>
    <item><title><![CDATA[Kürbis &amp; Co. - Der Spiegel]]></title><link>https://news.google.com/rss/articles/def</link><pubDate>Mon, 05 Oct 2026 04:00:00 GMT</pubDate><source url="https://www.spiegel.de">Der Spiegel</source></item>`);
  const request = async () => new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } });
  const signals = await googleNewsRssSource().fetch({ now: NOW, signal: AbortSignal.timeout(1000), request });
  assert.equal(signals[0].title, 'Zeitumstellung: Welche Uhren umstellen?');
  assert.equal(signals[0].publisher, 'tagesschau.de');
  assert.equal(signals[0].publishedAt, '2026-10-05T05:00:00.000Z');
  assert.equal(signals[1].title, 'Kürbis & Co.');
  assert.equal(signals[1].publisher, 'spiegel.de');
});

test('Google Trends RSS yields a search signal plus linked news items; non-RSS is an invalid response', async () => {
  const xml = rss(`<item><title>Zeitumstellung</title><ht:approx_traffic>50000+</ht:approx_traffic><pubDate>Mon, 05 Oct 2026 03:00:00 GMT</pubDate>
    <ht:news_item><ht:news_item_title>Wann wird die Uhr umgestellt?</ht:news_item_title><ht:news_item_url>https://www.zdf.de/nachrichten/uhr</ht:news_item_url><ht:news_item_source>ZDFheute</ht:news_item_source></ht:news_item></item>
    <item><title>Kürbissuppe</title><ht:approx_traffic>2000+</ht:approx_traffic></item>`);
  const signals = await googleTrendsRssSource().fetch({ now: NOW, signal: AbortSignal.timeout(1000), request: async () => new Response(xml) });
  assert.equal(signals.filter(signal => signal.kind === 'search').length, 2);
  const linked = signals.find(signal => signal.kind === 'news');
  assert.equal(linked.url, 'https://www.zdf.de/nachrichten/uhr');
  assert.equal(linked.publisher, 'zdf.de');
  assert.ok(signals[0].strength > signals.find(signal => signal.title === 'Kürbissuppe').strength);
  await assert.rejects(googleTrendsRssSource().fetch({ now: NOW, signal: AbortSignal.timeout(1000), request: async () => new Response('<html>consent</html>') }), error => error.kind === 'invalid_response');
});

test('Wikipedia pageviews: special pages are filtered, a missing day falls back to the day before', async () => {
  const urls = [];
  const request = async url => { urls.push(String(url)); if (urls.length === 1) return new Response('{}', { status: 404 });
    return Response.json({ items: [{ articles: [{ article: 'Hauptseite', views: 1e6, rank: 1 }, { article: 'Spezial:Suche', views: 5e5, rank: 2 }, { article: 'Zeitumstellung', views: 90000, rank: 3 }] }] }); };
  const signals = await wikipediaPageviewsSource().fetch({ now: NOW, signal: AbortSignal.timeout(1000), request });
  assert.equal(urls.length, 2);
  assert.match(urls[1], /2026\/10\/03$/);
  assert.deepEqual(signals.map(signal => signal.title), ['Zeitumstellung']);
  assert.equal(signals[0].kind, 'attention');
});

test('Tavily news: HTTP errors keep their status for classification (429 → rate_limited)', async () => {
  process.env.TAVILY_API_KEY = 'test-key';
  try {
    const search = async () => { throw new TavilyHttpError('limit', 429, '2'); };
    const result = await runSource(tavilyNewsSource(search), { now: NOW, sleep: noSleep, policy: { attempts: 1 } });
    assert.equal(result.health.errorKind, 'rate_limited');
    const ok = tavilyNewsSource(async () => [{ id: 't1', title: 'Wetter: Erster Frost am Wochenende', url: 'https://www.dwd.de/frost', content: 'Frost', score: 0.9, publishedDate: 'Mon, 05 Oct 2026 06:00:00 GMT' }]);
    const signals = await ok.fetch({ now: NOW, signal: AbortSignal.timeout(1000), request: fetch });
    assert.equal(signals[0].publisher, 'dwd.de');
    assert.equal(signals[0].publishedAt, '2026-10-05T06:00:00.000Z');
  } finally { delete process.env.TAVILY_API_KEY; }
});

test('the topic scout never imports production providers, publishers or WhatsApp', () => {
  const root = path.join(__dirname, '..', 'lib', 'topics');
  const files = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { if (entry.isDirectory()) walk(path.join(dir, entry.name)); else files.push(path.join(dir, entry.name)); } };
  walk(root);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /from ["'][^"']*(visual|distribution|whatsapp|meta\/|replicate|heygen|runway|image-provider|topic-pipeline)[^"']*["']/i, file);
  }
});

test('persistence: runs claim a slot once, candidates and verdicts are stored, history feeds the next cooldown', async () => {
  const db = await pgliteDatabase();
  try {
    const selection = await discoverTopic({ now: NOW, sleep: noSleep, sources: offline() });
    const runId = selection.scout.runId;
    assert.equal(await repo.claimTopicRun(db, runId, '2026-10-05:morning', NOW.toISOString()), true);
    assert.equal(await repo.claimTopicRun(db, require('node:crypto').randomUUID(), '2026-10-05:morning', NOW.toISOString()), false);
    await repo.saveTopicRun(db, runId, selection.scout, selection.verdicts, selection.candidates, selection.selected, null);
    const stored = await db.query('SELECT count(*)::int AS n FROM topic_candidates WHERE run_id=$1', [runId]);
    assert.equal(stored.rows[0].n, selection.candidates.length);
    await repo.recordTopicHistory(db, selection.selected, 'proposed', runId);
    await repo.recordTopicHistory(db, selection.selected, 'proposed', runId); // idempotent
    await repo.recordTopicHistory(db, selection.selected, 'published', 'post-1');
    const history = await repo.loadTopicHistory(db);
    assert.equal(history.length, 2);
    const next = await discoverTopic({ now: NOW, sleep: noSleep, sources: offline(), history });
    assert.notEqual(next.selected.topic_id, selection.selected.topic_id);
    const latest = await repo.latestTopicRun(db);
    assert.equal(latest.selected_topic_id, selection.selected.topic_id);
  } finally { await db.close(); }
});

test('events are structured and never contain secrets or query strings', async () => {
  clearRecentEvents();
  lines.length = 0;
  require(`${B}/observability/events`).emitEvent('topic_source_failed', { source: 'x', apiKey: 'sk-secret', authorization: 'Bearer abc', url: 'https://www.amazon.de/dp/B000000000?tag=foo-21' });
  const line = lines.at(-1);
  assert.doesNotMatch(line, /sk-secret|Bearer|tag=foo/);
  assert.equal(JSON.parse(line).event, 'topic_source_failed');
});
