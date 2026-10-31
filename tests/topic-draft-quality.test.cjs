// Content quality of topic drafts (stabilisation order 30.10.): a structurally invalid AI briefing gets one targeted
// correction inside the call budget; a thin, cut-off or internal-note fallback never reaches the operator as a production
// draft. Regression for tc_b738d9c93bfa4de2 („überspannung“: AI briefing rejected for „Hook länger als 3 Sekunden“, then a
// reference with „kostet im Alltag Zeit und Nerven“, an unfounded month, „Erstmal tief durchatmen“ and „Produkte nur
// optional und ohne.“). Real pipeline code; only I/O (database, WhatsApp, model) is replaced.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = '../.test-build/lib';
const { referenceVideoBriefing, writeVideoBriefing, validBriefing, fitSpoken, splitSentences, MISSING_SPOKEN } = require(`${L}/topic-pipeline/video-briefing`);
const { referenceCopy, writeTopicCopy } = require(`${L}/topic-pipeline/copy`);
const { draftReadiness } = require(`${L}/topic-pipeline/readiness`);
const { operatorTopicCandidate } = require(`${L}/topic-pipeline/topic-order`);
const { runTopicVideoCron } = require(`${L}/topic-pipeline/video-cron`);
const { deliverHeldProposals, requestTopicOrder, MAX_MODEL_CALLS_PER_CONTENT } = require(`${L}/topic-pipeline/orchestrator`);
const { buildCandidate } = require(`${L}/topics/scout`);
const { memoryLedger } = require(`${L}/visual/ledger`);
const { calendarSource, evergreenSource } = require(`${L}/topics/sources/offline`);
const { setEventSink } = require(`${L}/observability/events`);
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { fakeTopicGenerator } = require('./helpers/fake-topic-generator.cjs');

const events = [];
setEventSink(line => events.push(JSON.parse(line)));
const OPERATOR = '491701234567';
const NOW = new Date('2026-10-30T10:05:00Z'); // Friday, 11:05 Berlin (winter time)
const NOON = new Date('2026-10-30T11:05:00Z'); // 12:05 Berlin
const MONTHS = /Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember/;
const INTERNAL = /Produkte nur optional|ohne erfundene|Zeit und Nerven|Dein Themenauftrag|ohne Werbeversprechen/;

function deps(db, sent, over = {}) {
  let n = 0;
  return { db, trustedWaId: OPERATOR, now: () => over.at ?? NOW, send: async text => { sent.push(text); return `wamid.q.${++n}`; },
    render: { ledger: memoryLedger(), imageProvider: null, sleep: async () => {}, videoTiming: { pollIntervalMs: 0 } },
    scoutOptions: { sources: [calendarSource(), evergreenSource()], sleep: async () => {} }, publishers: [], rasterize: async asset => asset,
    interpret: async () => { throw new Error('no model'); }, ...over };
}
const order = (d, body, id = `wamid.order.${Math.random()}`) => requestTopicOrder(d, { id, from: OPERATOR, body, replyToMessageId: null });
const words = text => text.trim().split(/\s+/).length;

// A keyword topic like the trend agent delivers it (lowercase search term, one news hit without publisher, everyday words).
const keywordCandidate = () => {
  const built = buildCandidate({ title: 'überspannung', signals: [{ source: 'tavily_news', kind: 'news', title: 'Überspannung: Haushalt, Strom und Energie im Alltag',
    snippet: '', url: 'https://example.org/a', publisher: null, publisherUrl: null, publishedAt: null, eventDate: null, fetchedAt: NOW.toISOString(), strength: 0.5, tags: [] }] }, NOW);
  assert.ok(!('error' in built), JSON.stringify(built));
  return built;
};

test('scout texts: no generic filler, no month without a seasonal reason, internal brief stays internal', () => {
  const candidate = keywordCandidate();
  assert.equal(candidate.trend_type, 'PRACTICAL_LIFE');
  assert.doesNotMatch(candidate.audience_problem, /Zeit und Nerven/);
  assert.doesNotMatch(candidate.why_now, MONTHS, 'no season named without a seasonal signal');
  // The reference copy publishes nothing of the internal brief (core_message) and no routing notes.
  const copy = referenceCopy(candidate);
  for (const text of [copy.hook, copy.body, copy.caption, copy.coreMessage, ...copy.points.map(point => `${point.headline} ${point.text}`)]) assert.doesNotMatch(text, INTERNAL);
  // A curated seasonal topic still names its season: that IS its reason.
  const curated = buildCandidate({ title: 'Laub und Herbstschmutz im Eingangsbereich', signals: (evergreenSignal => [evergreenSignal])({ source: 'evergreen', kind: 'evergreen',
    title: 'Laub und Herbstschmutz im Eingangsbereich', snippet: 'Nasses Laub und Schmutz werden in die Wohnung getragen', url: null, publisher: null, publisherUrl: null,
    publishedAt: null, eventDate: null, fetchedAt: NOW.toISOString(), strength: 0.45, tags: ['reinigung', 'herbst'] }) }, NOW);
  assert.match(curated.why_now, /Oktober/);
  assert.equal(curated.audience_problem, 'Nasses Laub und Schmutz werden in die Wohnung getragen');
});

test('spoken text is cut at sentence ends only; dates and abbreviations are not sentence ends', () => {
  assert.deepEqual(splitSentences('Am 25. Oktober ist Zeitumstellung. Stell z. B. die Uhr im Auto um.'), ['Am 25. Oktober ist Zeitumstellung.', 'Stell z. B. die Uhr im Auto um.']);
  assert.equal(fitSpoken('Nachvollziehbare Alltagstipps zu überspannung; Produkte nur optional und ohne erfundene Eigenschaften.', 3), '', 'no fragment like „… und ohne.“');
  assert.equal(fitSpoken('Kurz lüften hilft. Danach die Heizung wieder an. Und noch ein dritter langer Satz mit vielen Wörtern dazu.', 4), 'Kurz lüften hilft. Danach die Heizung wieder an.');
});

test('reference briefing: only audience text is spoken; a missing sentence is marked and blocks readiness', () => {
  const candidate = keywordCandidate();
  const thin = { ...referenceCopy(candidate), origin: 'model', points: [{ headline: 'Erstmal', text: 'Erstmal tief durchatmen.' }] };
  const briefing = referenceVideoBriefing(candidate, thin);
  const spoken = briefing.scenes.map(scene => scene.spokenText).join(' ');
  assert.doesNotMatch(spoken, INTERNAL);
  assert.ok(!spoken.includes(candidate.core_message) && !spoken.includes(candidate.why_now));
  for (const scene of briefing.scenes) assert.doesNotMatch(scene.spokenText, /\b(und|ohne|oder)\.$/, `scene ${scene.index}`);
  const verdict = draftReadiness(candidate, thin, briefing);
  assert.equal(verdict.ready, false);
  assert.ok(verdict.reasons.some(reason => /ohne konkreten Punkt/.test(reason)), verdict.reasons.join(' | '));
  assert.ok(verdict.reasons.some(reason => /Lösungsteil des Videos zu dünn/.test(reason)), verdict.reasons.join(' | '));
  // The plain reference of a keyword topic (no model text) is never a production draft either.
  assert.equal(draftReadiness(candidate, referenceCopy(candidate)).ready, false);
  assert.ok(briefing.scenes.every(scene => scene.spokenText !== MISSING_SPOKEN) || !verdict.ready);
});

test('AI briefing with a too long hook: ONE targeted correction within the call budget; never beyond it', async () => {
  const accepted = operatorTopicCandidate('Laub im Garten', { now: NOW });
  const candidate = accepted.candidate;
  const { copy } = await writeTopicCopy(candidate, { generate: fakeTopicGenerator().generate });
  const valid = { ...referenceVideoBriefing(candidate, copy), origin: 'model' };
  assert.equal(validBriefing(valid), null);
  const longHook = { ...valid, scenes: valid.scenes.map((scene, index) => index === 0 ? { ...scene, end: 4 } : index === 1 ? { ...scene, start: 4 } : scene) };
  assert.equal(validBriefing(longHook), 'Hook länger als 3 Sekunden');
  const scripted = answers => { const inputs = []; return { inputs, generate: async (agent, instruction, input) => { inputs.push({ agent, instruction, input }); return answers.shift(); } }; };

  const fixed = scripted([longHook, valid]);
  const result = await writeVideoBriefing(candidate, copy, { generate: fixed.generate, maxCalls: 3 });
  assert.equal(result.briefing.origin, 'model');
  assert.equal(result.corrected, true);
  assert.equal(result.modelCalls, 2);
  assert.equal(fixed.inputs[1].input.rejection_reason, 'Hook länger als 3 Sekunden');
  assert.deepEqual(fixed.inputs[1].input.rejected_briefing.scenes[0].end, 4);
  assert.match(fixed.inputs[1].instruction, /Korrekturauftrag/);
  assert.match(fixed.inputs[0].instruction, /endet spätestens bei 3 Sekunden/, 'the rule is stated up front, not only after a failure');

  const stillBroken = scripted([longHook, longHook]);
  const twice = await writeVideoBriefing(candidate, copy, { generate: stillBroken.generate, maxCalls: 3 });
  assert.equal(twice.briefing.origin, 'reference_template');
  assert.equal(twice.modelCalls, 2);
  assert.match(twice.fallbackReason, /nach Korrektur: Hook länger als 3 Sekunden/);

  const noBudget = scripted([longHook, valid]);
  const capped = await writeVideoBriefing(candidate, copy, { generate: noBudget.generate, maxCalls: 1 });
  assert.equal(capped.modelCalls, 1);
  assert.equal(capped.briefing.origin, 'reference_template');
  const noTime = scripted([longHook, valid]);
  assert.equal((await writeVideoBriefing(candidate, copy, { generate: noTime.generate, maxCalls: 3, allowCorrection: () => false })).modelCalls, 1);
});

test('video cron: a weak AI text plus an uncorrectable briefing is NOT proposed; the day stays retryable; calls stay within the limit', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    let calls = 0;
    const generate = async (agent, instruction, input, schema, reference) => {
      calls++;
      if (agent === 'text') return schema.parse({ hook: 'Kennst du das? So wird es leichter', body: 'Manchmal ist alles zu viel. Erstmal tief durchatmen.',
        caption: 'Manchmal ist alles zu viel. Erstmal tief durchatmen.', cta: 'Speichern für später', question: 'Wie geht es dir damit?',
        points: [{ headline: 'Durchatmen', text: 'Erstmal tief durchatmen.' }], video_script: 'Erstmal tief durchatmen und weitermachen.' });
      const briefing = reference();
      return { ...briefing, origin: 'model', scenes: briefing.scenes.map((scene, index) => index === 0 ? { ...scene, end: 5 } : index === 1 ? { ...scene, start: 5 } : scene) };
    };
    const result = await runTopicVideoCron({ enabled: true, now: NOON, deps: () => deps(db, sent, { at: NOON, generate }) });
    assert.equal(result.status, 'no_topic');
    assert.equal(sent.length, 0, 'nothing unusable is sent to the operator');
    const row = (await db.query('SELECT stage, last_error, model_calls, proposal_message_id FROM topic_contents')).rows[0];
    assert.equal(row.stage, 'discarded');
    assert.equal(row.proposal_message_id, null);
    assert.match(row.last_error, /^draft_not_ready: /);
    assert.ok(row.model_calls <= MAX_MODEL_CALLS_PER_CONTENT && calls <= MAX_MODEL_CALLS_PER_CONTENT, `calls ${calls}`);
    assert.equal(calls, 3, 'text + briefing + one correction');
    const day = (await db.query('SELECT status, reason FROM topic_video_days')).rows[0];
    assert.equal(day.status, 'no_topic');
    assert.match(day.reason, /draft_not_ready/);
    assert.ok(events.some(event => event.event === 'topic_draft_not_ready'));
  } finally { await db.close(); }
});

test('topic order without usable text: honest refusal, nothing proposed; with model text different harmless topics work alike', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const bare = deps(db, sent);
    assert.equal(await order(bare, 'Mach etwas über Laub im Garten'), true);
    assert.match(sent.at(-1), /^Zum Themenauftrag „Laub im Garten“ ist kein brauchbarer Entwurf entstanden \(.*KI-Text fehlt.*\)\. Ich lege keinen unfertigen Vorschlag vor\./);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM topic_contents WHERE stage='discarded'")).rows[0].n, 1);

    const withModel = deps(db, sent, { generate: fakeTopicGenerator().generate });
    for (const topic of ['Fenster putzen ohne Schlieren', 'Brotdosen packen', 'Kabelsalat am Schreibtisch', 'Wäsche trocknen im Winter']) {
      assert.equal(await order(withModel, `Thema: ${topic}`), true);
      assert.match(sent.at(-1), /^Themenvorschlag · Themen-Post/, topic);
      assert.match(sent.at(-1), new RegExp(`Dein Themenauftrag: „${topic}“`));
      assert.match(sent.at(-1), /KI-Modus/);
      assert.doesNotMatch(sent.at(-1), /Produkte nur optional|Zeit und Nerven/, 'the operator note may name the order; the draft text carries no internal brief');
    }
    assert.equal((await db.query("SELECT count(*)::int AS n FROM topic_contents WHERE stage='proposed'")).rows[0].n, 4);
  } finally { await db.close(); }
});

test('held proposals from before the readiness check: a thin one is not delivered late, a usable one is', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    let open = false;
    const thin = deps(db, sent, { serviceWindowOpen: async () => open });
    // Held while the window was closed (curated reference = usable post) …
    await (require(`${L}/topic-pipeline/cron`).runTopicCron)({ enabled: true, now: new Date('2026-10-30T07:05:00Z'), deps: () => ({ ...thin, now: () => new Date('2026-10-30T07:05:00Z') }) });
    // … and a second, thin one written by the old code (simulated: reference copy of a keyword topic, stored as held).
    const candidate = keywordCandidate();
    const copy = referenceCopy(candidate);
    await db.query(`INSERT INTO topic_contents(content_id,run_id,topic_id,category,stage,format,revision,candidate,decision,override,copy,product,model_calls,delivery)
      VALUES('tc_thin00000000000',NULL,$1,'topic','proposed','SINGLE_IMAGE',1,$2,$3,'{}',$4,'{"status":"none"}',2,'awaiting_window')`,
      [candidate.topic_id, JSON.stringify({ candidate, cluster: null, variant: 0 }), JSON.stringify({ format: 'SINGLE_IMAGE', reason: 'x', alternatives: [], slides: null }), JSON.stringify(copy)]);
    open = true;
    assert.equal(await deliverHeldProposals(thin), 1, 'only the usable proposal is delivered');
    assert.match(sent.at(-1), /Nachgeliefert/);
    const stale = (await db.query("SELECT stage, delivery, last_error FROM topic_contents WHERE content_id='tc_thin00000000000'")).rows[0];
    assert.deepEqual([stale.stage, stale.delivery], ['discarded', 'not_ready']);
    assert.match(stale.last_error, /^draft_not_ready: Referenzvorlage ohne konkrete Inhalte/);
  } finally { await db.close(); }
});

test('an arrow in audience text is fine; only the scout\'s structure lines count as internal notes', () => {
  const candidate = operatorTopicCandidate('Fenster putzen ohne Schlieren', { now: NOW }).candidate;
  const base = { ...referenceCopy(candidate), origin: 'model', points: [{ headline: 'Reihenfolge', text: 'Erst Rahmen, dann Glas → so tropft nichts auf die frisch geputzte Scheibe.' }] };
  assert.equal(draftReadiness(candidate, base).reasons.some(reason => /interne Redaktionsnotiz/.test(reason)), false);
  const leaked = { ...base, body: 'Problem → einfache Lösungsschritte' };
  assert.ok(draftReadiness(candidate, leaked).reasons.some(reason => /Text: interne Redaktionsnotiz/.test(reason)));
});

test('the bounded word limit matches the validator (one rule for model and reference)', () => {
  const { spokenWordLimit } = require(`${L}/topic-pipeline/video-briefing`);
  assert.equal(spokenWordLimit(3), 9);
  assert.ok(words(fitSpoken('Eins zwei drei vier fünf. Sechs sieben acht neun zehn elf.', 3)) <= spokenWordLimit(3));
});
