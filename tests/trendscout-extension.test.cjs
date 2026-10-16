const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const L = '../.test-build/lib';
const S = require(`${L}/content/strategy`);
const { discoverOpportunities, researchQueries } = require(`${L}/content/trend-scout`);
const M = require(`${L}/content/research-mix`);
const { chanceFromTrendTopic } = require(`${L}/trendsetter/chance`);
const { recordChances, openChances } = require(`${L}/trendsetter/repository`);
const { routeChance } = require(`${L}/trendsetter/routing`);

// Trendscout extension (Auftrag 15.10., P4/P5): one shared research agent for product AND topic chances, price-tier mix.
// Both behind feature flags; with the flags off the productive trend scout must behave exactly as before.
const NOW = new Date('2026-10-15T07:30:00Z');
const evidence = [{ title: 'Ordnung im Herbst', url: 'https://example.org/ordnung', content: 'Einfache Ordnungstricks für den Flur.' },
  { title: 'Gadgets, die alle teilen', url: 'https://example.org/gadgets', content: 'Ungewöhnliche Küchengadgets gehen viral.' }];
const signals = (over = {}) => ({ demonstrable: false, beforeAfter: false, wow: false, fun: false, impulse: false, gift: false, aesthetic: false, broadAppeal: false, ...over });
const opp = (over = {}) => ({ kind: 'product_opportunity', title: 'Spiralen aus Gemüse', productIdea: 'Spiralschneider Gemüse', chanceType: 'fun_impulse',
  contentChance: 'Gemüse wird in Sekunden zu Spiralen: Hingucker beim Kochen', hook: 'Aus einer Zucchini werden Spaghetti in zehn Sekunden',
  rationale: 'Sichtbarer Effekt, der zum Nachmachen anregt', targetNeed: 'Abwechslung beim Kochen', formatSuggestion: 'image', visualPotential: 'high', entertainmentPotential: 'high',
  signals: signals({ demonstrable: true, beforeAfter: true, fun: true, impulse: true, broadAppeal: true }), shareReason: 'Man zeigt es Freunden', trustRationale: 'Nur sichtbare Anwendung',
  reachRationale: 'Visuell sofort verständlich', timing: { season: null, relevance: 'none' }, novelty: 'high', similarityNote: 'Kein ähnliches Produkt kürzlich', concept: 'veggie-spirals', group: null,
  confidence: 80, evidenceUrls: ['https://example.org/gadgets'], priority: 1, ...over });
const topic = (over = {}) => opp({ kind: 'topic_opportunity', title: 'Flur in fünf Minuten aufgeräumt', productIdea: null, chanceType: 'problem_solver', concept: 'hallway-order-tricks',
  contentChance: 'Drei Handgriffe, mit denen der Flur im Herbst ordentlich bleibt', hook: 'Nasse Schuhe, Jacken, Schlüssel: so bleibt der Flur trotzdem frei',
  signals: signals({ demonstrable: true, beforeAfter: true, broadAppeal: true }), evidenceUrls: ['https://example.org/ordnung'], priority: 2, ...over });
const report = (opportunities) => ({ summary: 'Test', opportunities, noGoodCandidate: false, rejectedIdeas: [] });

test('regression: with TRENDSCOUT_TOPICS and PRODUCT_MIX unset the research, prompt and output stay exactly as before', async () => {
  assert.equal(M.trendscoutTopicsEnabled({}), false);
  assert.equal(M.productMixConfig({}).enabled, false);
  const queries = researchQueries(NOW);
  assert.deepEqual(queries.map(q => q.direction), ['problemloeser', 'fun_social', 'deko_lifestyle', 'saison']);
  const seen = [];
  const result = await discoverOpportunities({ now: NOW, slot: 's', history: S.emptyHistory(), seedIdeas: [], research: async q => { seen.push(q.direction); return evidence; },
    generate: async (agent, instruction, input) => { seen.push({ instruction, max: input.maxOpportunities }); return report([opp()]); } });
  const call = seen.find(item => typeof item === 'object');
  assert.equal(call.max, 4);
  assert.doesNotMatch(call.instruction, /Themenrecherche aktiv|Produktmix aktiv/);
  assert.equal(seen.filter(item => typeof item === 'string').length, 4, 'exactly the four existing research queries');
  assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].priceTier, undefined);
  // The orchestrator only reads the flags; the scout itself, the content-chance gate and Amazon resolution are untouched.
  const orchestrator = fs.readFileSync('lib/orchestrator.ts', 'utf8');
  assert.match(orchestrator, /assessContentChance\(candidate\.name, candidate\.chance, history, candidate\.extraPenalties\)/);
  assert.match(orchestrator, /findAmazonProduct\(candidate\.name, candidate\.searchQuery, candidate\.targetGroup\)/);
});

test('TRENDSCOUT_TOPICS=on: one shared run researches topics too; topic and product chances come back separately', async () => {
  assert.equal(M.trendscoutTopicsEnabled({ TRENDSCOUT_TOPICS: 'on' }), true);
  const queries = researchQueries(NOW, { topics: true });
  assert.deepEqual(queries.map(q => q.direction), ['problemloeser', 'fun_social', 'deko_lifestyle', 'saison', 'alltagstipps', 'wissen_kurios']);
  let calls = 0, instruction = '', max = 0;
  const result = await discoverOpportunities({ now: NOW, slot: 's', history: S.emptyHistory(), seedIdeas: [], topics: true, research: async () => evidence,
    generate: async (agent, text, input) => { calls++; instruction = text; max = input.maxOpportunities; return report([opp(), topic()]); } });
  assert.equal(calls, 1, 'one model call for both kinds');
  assert.equal(max, 6);
  assert.match(instruction, /Themenrecherche aktiv.*Alltäglich leichter.*Haushaltstipps/s);
  assert.equal(result.candidates.length, 1); assert.equal(result.topics.length, 1);
  assert.equal(result.topics[0].productIdea, null);
  // Separate quality evaluation: the product chance passes the content-chance gate; the topic becomes a Trendsetter chance
  // with its own scores and is routed by Jarvis to the topic pipeline (no product link needed).
  assert.equal(S.assessContentChance(result.candidates[0].name, result.candidates[0].chance, S.emptyHistory(), result.candidates[0].extraPenalties).passed, true);
  const chance = chanceFromTrendTopic(result.topics[0], NOW, result.evidence);
  assert.equal(chance.product_idea, null); assert.equal(chance.affiliate_angle, null);
  const route = routeChance(chance, [], NOW);
  assert.ok(['topic', 'reject'].includes(route.decision));
  assert.ok(!route.pipelines.includes('affiliate'), 'a topic chance is never routed to the affiliate pipeline');
  assert.ok(route.reasons.length > 0, 'routing is traceable');
});

test('topic chances are stored as shared research results and can be read by Jarvis\' topic selection; unsafe topics are dropped', async t => {
  const db = await pgliteDatabase(); t.after(() => db.close());
  const result = await discoverOpportunities({ now: NOW, slot: 's', history: S.emptyHistory(), seedIdeas: [], topics: true, research: async () => evidence,
    generate: async () => report([topic(), topic({ title: 'Wundermittel', concept: 'miracle', hook: 'Dieses Hausmittel heilt garantiert jede Erkältung', priority: 3 })]) });
  assert.equal(result.topics.length, 1, 'health promise dropped by the intake');
  assert.match(result.dropped[0].reason, /unbelegte/);
  const stored = await recordChances(db, result.topics.map(item => chanceFromTrendTopic(item, NOW, result.evidence)), NOW);
  assert.equal(stored.length, 1);
  const again = await recordChances(db, result.topics.map(item => chanceFromTrendTopic(item, NOW, result.evidence)), NOW);
  assert.equal(again[0].chance_id, stored[0].chance_id);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM content_chances')).rows[0].n, 1, 'idempotent: found again → merged, not duplicated');
  // Jarvis' topic selection reads exactly these open chances (lib/trendsetter/topic.ts → openChances(['topic','both'])).
  const open = await openChances(db, NOW, ['topic', 'both']);
  assert.equal(open.length, stored[0].recommendation === 'none' ? 0 : 1);
  if (open.length) assert.equal(open[0].product_idea, null);
});

test('price tiers: deterministic estimates per product type; configurable limits and target mix; invalid config falls back', () => {
  assert.equal(M.priceTierOf('Saugroboter mit Wischfunktion'), 'high');
  assert.equal(M.priceTierOf('Kaffeevollautomat'), 'high');
  assert.equal(M.priceTierOf('Heißluftfritteuse XXL'), 'mid');
  assert.equal(M.priceTierOf('Kühlschrank'), 'high');
  assert.equal(M.priceTierOf('Fugenbürste'), 'low');
  assert.equal(M.priceTierOf('Sternenhimmel Projektor'), null);
  const config = M.productMixConfig({ PRODUCT_MIX: 'balance', PRODUCT_PRICE_TIER_LIMITS: '25,200', PRODUCT_MIX_TARGET: 'low:2,mid:1,high:1', PRODUCT_MIX_WINDOW: '8' });
  assert.equal(config.enabled, true); assert.deepEqual(config.limits, { lowMax: 25, midMax: 200 });
  assert.deepEqual(config.target, { low: 50, mid: 25, high: 25 }); assert.equal(config.window, 8);
  const fallback = M.productMixConfig({ PRODUCT_MIX: 'balance', PRODUCT_PRICE_TIER_LIMITS: '200,30', PRODUCT_MIX_TARGET: 'low:x', PRODUCT_MIX_WINDOW: '1' });
  assert.deepEqual(fallback.limits, { lowMax: 30, midMax: 150 }); assert.deepEqual(fallback.target, { low: 40, mid: 35, high: 25 }); assert.equal(fallback.window, 12);
});

test('PRODUCT_MIX=balance: only near-ties move (max. one rank), towards under-represented tiers; every decision has a reason; nothing is added', async () => {
  const config = M.productMixConfig({ PRODUCT_MIX: 'balance' });
  // Last products were all cheap gadgets: high and mid are under-represented.
  const state = M.mixState(['Fugenbürste', 'Gemüsereibe', 'Kabel-Organizer', 'Duschabzieher', 'Pizzaschere', 'Brotdose'], config);
  assert.deepEqual(state.counts, { low: 6, mid: 0, high: 0 });
  assert.ok(state.deficit.high >= 10 && state.deficit.low <= -10);
  const pool = [{ name: 'Gemüsespiralschneider', priority: 1, priceTier: 'low' }, { name: 'Saugroboter', priority: 2 }, { name: 'Partyspiel Karten', priority: 3, priceTier: 'low' }];
  const { ordered, decisions } = M.balanceByPriceTier(pool, state);
  assert.deepEqual(ordered.map(item => item.name), ['Saugroboter', 'Gemüsespiralschneider', 'Partyspiel Karten']);
  assert.equal(ordered.length, pool.length, 'no candidate added or removed');
  assert.equal(decisions.length, 3); assert.ok(decisions.every(item => item.reason.length > 5));
  // A clearly stronger chance is not overtaken by more than one rank.
  const strong = M.balanceByPriceTier([{ name: 'Fugenbürste', priority: 1 }, { name: 'Partyspiel', priority: 2 }, { name: 'Kaffeevollautomat', priority: 4 }], state);
  assert.equal(strong.ordered.at(-1).name, 'Kaffeevollautomat');
  // The instruction asks for tier estimates as planning data and forbids prices in posts.
  assert.match(M.mixInstruction(config, state), /priceTier.*niemals ein Preis im Beitrag.*Teuer ist nicht automatisch besser/s);
  // The agent's tier estimate travels with the candidate through Jarvis' intake.
  const result = await discoverOpportunities({ now: NOW, slot: 's', history: S.emptyHistory(), seedIdeas: [], mixNote: M.mixInstruction(config, state), research: async () => evidence,
    generate: async (agent, text) => { assert.match(text, /Produktmix aktiv/); return report([opp({ priceTier: 'mid', purchaseIntent: 'high' })]); } });
  assert.equal(result.candidates[0].priceTier, 'mid'); assert.equal(result.candidates[0].purchaseIntent, 'high');
});
