const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = '../.test-build/lib';
const C = require(`${L}/trendsetter/chance`);
const R = require(`${L}/trendsetter/routing`);
const Repo = require(`${L}/trendsetter/repository`);
const A = require(`${L}/trendsetter/affiliate`);
const { buildCandidate } = require(`${L}/topics/scout`);
const { ensureAutomationSchema } = require(`${L}/memory/ensure-automation-schema`);
const { setEventSink } = require(`${L}/observability/events`);
const pgliteDatabase = require('./helpers/pglite-db.cjs');

setEventSink(() => {});
const NOW = new Date('2026-10-05T08:00:00Z');
const DAY = 86_400_000;

function topicCandidate(title, now = NOW) {
  const signal = { source: 'evergreen', kind: 'evergreen', title, snippet: '', url: null, publisher: null, publisherUrl: null, publishedAt: null, eventDate: null,
    fetchedAt: now.toISOString(), strength: 0.6, tags: [] };
  const built = buildCandidate({ title, signals: [signal] }, now);
  assert.ok(!('error' in built), JSON.stringify(built));
  return built;
}
function trendCandidate(name, concept, overrides = {}) {
  return { name, searchQuery: name, kind: 'Saisontrend', category: 'Content-Chance', season: 'Herbst', whyNow: 'Herbst', reelIdea: 'Hook', targetGroup: 'Familien',
    benefitsToVerify: [], confidence: 80, priority: 1, extraPenalties: [],
    chance: { type: 'problem_solution', hook: `So bleibt ${name} im Alltag praktisch nutzbar`, concept, demonstrable: true, beforeAfter: true, wow: false, fun: false, impulse: false, gift: false,
      aesthetic: false, broadAppeal: true, seasonalFit: true },
    agent: { source: 'trend_agent', kind: 'product_opportunity', title: `Chance: ${name}`, rationale: 'r', targetNeed: 'Familien mit wenig Zeit', shareReason: '', trustRationale: 't',
      reachRationale: 'r', novelty: 'high', formatSuggestion: 'video', confidence: 80, priority: 1,
      evidence: [{ title: 'Quelle A', url: 'https://example.org/a' }, { title: 'Quelle B', url: 'https://example.org/b' }] }, ...overrides };
}
function chance(overrides = {}) {
  const scores = Object.fromEntries(C.SCORE_DIMENSIONS.map(key => [key, { score: 80, factors: [] }]));
  return { chance_id: C.chanceIdFor('test-konzept'), concept_key: 'test-konzept', title: 'Test', hook: 'Hook', origins: ['topic_scout'], origin_refs: [], sources: [],
    detected_at: NOW.toISOString(), valid_until: new Date(NOW.getTime() + 10 * DAY).toISOString(), scores, suitability: 80, recommendation: 'topic', recommendation_reasons: [],
    affiliate_angle: null, topic_angle: 'Wissen ohne Produkt', product_idea: null, sensitive: false, ...overrides };
}
const ledger = (entries) => entries.map(entry => ({ chance_id: entry.chance_id ?? C.chanceIdFor('test-konzept'), concept_key: entry.concept_key ?? 'test-konzept', pipeline: entry.pipeline,
  status: entry.status, at: new Date(NOW.getTime() - entry.daysAgo * DAY).toISOString() }));

test('chance format: unique stable ID per concept, sources, timestamps, five scores, suitability and a recommendation', () => {
  const topic = C.chanceFromTopicCandidate(topicCandidate('Fenster putzen ohne Schlieren'));
  assert.match(topic.chance_id, /^cc_[a-f0-9]{16}$/);
  assert.equal(topic.chance_id, C.chanceFromTopicCandidate(topicCandidate('Fenster putzen ohne Schlieren')).chance_id, 'same concept → same ID');
  for (const key of C.SCORE_DIMENSIONS) assert.ok(Number.isInteger(topic.scores[key].score) && topic.scores[key].score >= 0 && topic.scores[key].score <= 100, key);
  assert.equal(Math.round(Object.values(C.SUITABILITY_WEIGHTS).reduce((a, b) => a + b, 0) * 100), 100);
  assert.equal(topic.suitability, C.suitabilityOf(topic.scores));
  assert.ok(Date.parse(topic.valid_until) > Date.parse(topic.detected_at));
  assert.deepEqual(topic.origins, ['topic_scout']);
  assert.equal(topic.product_idea, null, 'the topic scout never invents a concrete product');
  assert.ok(['topic', 'none'].includes(topic.recommendation));
  const product = C.chanceFromTrendCandidate(trendCandidate('Fensterabzieher', 'fenster-putzen-schlieren'), NOW);
  assert.equal(product.recommendation, 'affiliate');
  assert.equal(product.product_idea, 'Fensterabzieher');
  assert.equal(product.sources.length, 2);
});

test('both research paths finding the same concept give ONE shared chance with both approaches', () => {
  const topic = C.chanceFromTopicCandidate(topicCandidate('Fenster putzen ohne Schlieren'));
  const product = C.chanceFromTrendCandidate(trendCandidate('Fensterabzieher', topic.concept_key), NOW);
  assert.equal(product.chance_id, topic.chance_id);
  const merged = C.mergeChances([topic, product]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].origins.sort(), ['topic_scout', 'trend_agent']);
  assert.ok(merged[0].affiliate_angle && merged[0].topic_angle);
  assert.ok(merged[0].scores.trust_potential.factors.some(factor => /zwei Recherchewegen/.test(factor)));
  assert.equal(C.mergeChances([product, product]).length, 1);
});

test('Jarvis routing: weak, expired or approach-less chances are rejected with a reason', () => {
  assert.equal(R.routeChance(chance({ suitability: 40 }), [], NOW).decision, 'reject');
  assert.match(R.routeChance(chance({ valid_until: new Date(NOW.getTime() - DAY).toISOString() }), [], NOW).reasons.at(-1), /abgelaufen/);
  assert.equal(R.routeChance(chance({ recommendation: 'none' }), [], NOW).decision, 'reject');
  const ok = R.routeChance(chance(), [], NOW);
  assert.equal(ok.decision, 'topic');
  assert.deepEqual(ok.pipelines, ['topic']);
});

test('time locks: same pipeline, recent rejection and cross-pipeline use; an expired route never locks', () => {
  assert.equal(R.routeChance(chance(), ledger([{ pipeline: 'topic', status: 'consumed', daysAgo: 3 }]), NOW).decision, 'hold');
  assert.equal(R.routeChance(chance(), ledger([{ pipeline: 'topic', status: 'published', daysAgo: R.LOCK_DAYS.topic + 1 }]), NOW).decision, 'topic');
  assert.equal(R.routeChance(chance(), ledger([{ pipeline: 'topic', status: 'rejected', daysAgo: 5 }]), NOW).decision, 'hold');
  assert.equal(R.routeChance(chance(), ledger([{ pipeline: 'affiliate', status: 'consumed', daysAgo: 2 }]), NOW).decision, 'hold', 'same concept in the other pipeline within 7 days');
  assert.equal(R.routeChance(chance(), ledger([{ pipeline: 'affiliate', status: 'consumed', daysAgo: 8 }]), NOW).decision, 'topic');
  assert.equal(R.routeChance(chance(), ledger([{ pipeline: 'topic', status: 'expired', daysAgo: 1 }]), NOW).decision, 'topic');
  // A similar concept under another ID is a duplicate too.
  const similar = ledger([{ chance_id: C.chanceIdFor('fenster-putzen-schlieren'), concept_key: 'fenster-putzen-schlieren', pipeline: 'topic', status: 'consumed', daysAgo: 1 }]);
  assert.equal(R.routeChance(chance({ concept_key: 'fenster-schlieren-putzen' }), similar, NOW).decision, 'hold');
});

test('both pipelines only with two different approaches and enough added value; an invitation is not a lock', () => {
  const both = chance({ recommendation: 'both', affiliate_angle: 'Abzieher im Einsatz am Badfenster zeigen', topic_angle: 'Drei Fehler beim Fensterputzen erklären', product_idea: 'Abzieher' });
  assert.equal(R.routeChance(both, [], NOW).decision, 'both');
  const same = { ...both, topic_angle: 'Abzieher im Einsatz am Badfenster zeigen' };
  const sameRoute = R.routeChance(same, [], NOW);
  assert.equal(sameRoute.decision, 'topic');
  assert.ok(sameRoute.reasons.some(reason => /unterschiedlichem Ansatz/.test(reason)));
  assert.equal(R.routeChance({ ...both, suitability: 60 }, [], NOW).decision, 'topic');
  // Topic consumed + affiliate invited ("both" decided earlier): the affiliate pipeline may still take it.
  const invited = ledger([{ pipeline: 'topic', status: 'consumed', daysAgo: 1 }, { pipeline: 'affiliate', status: 'routed', daysAgo: 1 }]);
  assert.deepEqual(R.routeChance(both, invited, NOW, ['affiliate']).pipelines, ['affiliate']);
});

test('priority is traceable and deterministic', () => {
  const a = chance({ chance_id: C.chanceIdFor('a'), concept_key: 'a', suitability: 70 });
  const b = chance({ chance_id: C.chanceIdFor('b'), concept_key: 'b', suitability: 70, origins: ['topic_scout', 'trend_agent'] });
  const ranked = R.prioritize([a, b], [], NOW);
  assert.equal(ranked[0].chance.chance_id, b.chance_id);
  assert.ok(ranked[0].route.reasons.some(reason => /beiden Recherchewegen/.test(reason)));
  assert.deepEqual(R.prioritize([b, a], [], NOW).map(item => item.chance.chance_id), ranked.map(item => item.chance.chance_id));
});

test('repository: idempotent shared results, one open route per chance and pipeline, invitation take-over, expiry and outcome', async () => {
  const db = await pgliteDatabase();
  try {
    await ensureAutomationSchema(db);
    const topic = C.chanceFromTopicCandidate(topicCandidate('Fenster putzen ohne Schlieren'));
    await Repo.recordChances(db, [topic], NOW);
    await Repo.recordChances(db, [topic, C.chanceFromTrendCandidate(trendCandidate('Fensterabzieher', topic.concept_key), NOW)], NOW);
    const rows = (await db.query('SELECT * FROM content_chances')).rows;
    assert.equal(rows.length, 1);
    assert.deepEqual([...rows[0].origins].sort(), ['topic_scout', 'trend_agent']);
    const stored = Repo.chanceFromRow(rows[0]);
    const route = R.routeChance(stored, [], NOW);
    assert.equal(await Repo.openRoute(db, route, 'topic', 'consumed', 'tc_1'), true);
    assert.equal(await Repo.openRoute(db, route, 'topic', 'consumed', 'tc_2'), false, 'no double processing');
    assert.equal(await Repo.openRoute(db, route, 'affiliate', 'routed', null), true);
    assert.equal(await Repo.openRoute(db, route, 'affiliate', 'consumed', 'Fensterabzieher'), true, 'the affiliate pipeline takes up the invitation');
    assert.equal(Number((await db.query("SELECT count(*)::int AS n FROM content_chance_routes WHERE pipeline='affiliate'")).rows[0].n), 1);
    await Repo.closeRoute(db, { chanceId: stored.chance_id, pipeline: 'topic', status: 'published', ref: 'tc_1' });
    const entries = await Repo.loadLedger(db);
    assert.ok(entries.some(entry => entry.pipeline === 'topic' && entry.status === 'published'));
    assert.equal(R.routeChance(stored, entries, NOW, ['topic']).decision, 'hold', 'published concept is locked for the topic pipeline');
    // A route nobody finished expires after the lock window and may be opened again.
    await db.query("UPDATE content_chance_routes SET updated_at=now()-interval '40 days' WHERE pipeline='affiliate'");
    assert.equal(await Repo.openRoute(db, route, 'affiliate', 'consumed', 'again'), true);
    assert.equal((await db.query("SELECT status FROM content_chance_routes WHERE pipeline='affiliate' ORDER BY created_at")).rows[0].status, 'expired');
  } finally { await db.close(); }
});

test('affiliate pipeline: off touches nothing; record only stores; route lets only routed chances through to the product scout', async () => {
  assert.equal(A.trendsetterAffiliateMode({}), 'off');
  assert.equal(A.trendsetterAffiliateMode({ TRENDSETTER_AFFILIATE: 'route' }), 'route');
  assert.equal(A.trendsetterAffiliateMode({ TRENDSETTER_AFFILIATE: 'yes' }), 'off');
  const untouchable = { query: () => { throw new Error('must not touch the database'); } };
  const off = await A.affiliateTrendsetter(untouchable, { candidates: [trendCandidate('Fensterabzieher', 'fenster-putzen-schlieren')], topics: [], evidence: [], now: NOW, mode: 'off' });
  assert.equal(off.allowed, null);
  const db = await pgliteDatabase();
  try {
    await ensureAutomationSchema(db);
    const recorded = await A.affiliateTrendsetter(db, { candidates: [trendCandidate('Fensterabzieher', 'fenster-putzen-schlieren')], topics: [], evidence: [], now: NOW, mode: 'record' });
    assert.equal(recorded.allowed, null);
    assert.equal(Number((await db.query('SELECT count(*)::int AS n FROM content_chances')).rows[0].n), 1);
    assert.equal(Number((await db.query('SELECT count(*)::int AS n FROM content_chance_routes')).rows[0].n), 0);
    const first = await A.affiliateTrendsetter(db, { candidates: [trendCandidate('Fensterabzieher', 'fenster-putzen-schlieren'), trendCandidate('Heizdecke', 'heizdecke-sofa-abend')], topics: [], evidence: [], now: NOW, mode: 'route' });
    assert.deepEqual([...first.allowed].sort(), ['Fensterabzieher', 'Heizdecke']);
    const again = await A.affiliateTrendsetter(db, { candidates: [trendCandidate('Fensterabzieher', 'fenster-putzen-schlieren')], topics: [], evidence: [], now: new Date(NOW.getTime() + DAY), mode: 'route' });
    assert.equal(again.allowed.size, 0, 'time lock: the same concept is not searched again the next day');
    assert.match(again.held[0].reason, /Affiliate-Pipeline/);
  } finally { await db.close(); }
});

test('topic pipeline: Jarvis opens the topic route before proposing, stores the chance and a rejection locks the concept', async () => {
  const { runTopicPipeline, handleTopicReply } = require(`${L}/topic-pipeline/orchestrator`);
  const { memoryLedger } = require(`${L}/visual/ledger`);
  const { calendarSource, evergreenSource } = require(`${L}/topics/sources/offline`);
  const db = await pgliteDatabase();
  try {
    const sent = [];
    let n = 0;
    const deps = { db, trustedWaId: '491701234567', now: () => NOW, send: async text => { sent.push(text); return `wamid.ts.${++n}`; },
      render: { ledger: memoryLedger(), imageProvider: null }, scoutOptions: { sources: [calendarSource(), evergreenSource()], sleep: async () => {} }, publishers: [],
      interpret: async () => { throw new Error('no model'); } };
    const run = await runTopicPipeline(deps, { slotKey: '2026-10-05:10' });
    assert.equal(run.status, 'proposed');
    const row = (await db.query('SELECT * FROM topic_contents WHERE content_id=$1', [run.contentId])).rows[0];
    const chanceId = row.candidate.chance_id;
    assert.match(chanceId, /^cc_[a-f0-9]{16}$/);
    const route = (await db.query("SELECT * FROM content_chance_routes WHERE chance_id=$1 AND pipeline='topic'", [chanceId])).rows[0];
    assert.equal(route.status, 'consumed');
    assert.equal(route.ref, run.contentId);
    assert.ok(Number((await db.query('SELECT count(*)::int AS n FROM content_chances')).rows[0].n) >= 1, 'all accepted topics are stored as shared results');
    await handleTopicReply(deps, { id: 'wamid.in.1', from: '491701234567', body: 'Ablehnen', replyToMessageId: row.proposal_message_id });
    assert.equal((await db.query("SELECT status FROM content_chance_routes WHERE chance_id=$1 AND pipeline='topic'", [chanceId])).rows[0].status, 'rejected');
    const next = await runTopicPipeline(deps, { slotKey: null });
    if (next.status === 'proposed') {
      const nextRow = (await db.query('SELECT candidate FROM topic_contents WHERE content_id=$1', [next.contentId])).rows[0];
      assert.notEqual(nextRow.candidate.chance_id, chanceId, 'a rejected concept is not proposed again within the lock window');
    }
  } finally { await db.close(); }
});