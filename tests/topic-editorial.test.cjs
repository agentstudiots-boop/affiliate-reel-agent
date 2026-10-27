// P1b: editorial patterns (story, aha, humour, emotion, hack) shape hook, angle, question and the model guidance of topic
// posts. Own switch TOPIC_EDITORIAL_STYLE=on; without it every text stays exactly as before. Real scout, gate and copy.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = '../.test-build/lib';
const E = require(`${L}/topics/editorial`);
const { buildCandidate, runTopicScout } = require(`${L}/topics/scout`);
const { topicTexts } = require(`${L}/topics/angles`);
const { classifyTrend, scoreCluster } = require(`${L}/topics/scoring`);
const { topicGate } = require(`${L}/topics/gate`);
const { topicCandidateSchema } = require(`${L}/topics/schema`);
const { calendarSource, evergreenSource } = require(`${L}/topics/sources/offline`);
const { referenceCopy, writeTopicCopy } = require(`${L}/topic-pipeline/copy`);
const { proposalText } = require(`${L}/topic-pipeline/messages`);
const { UNSUPPORTED_CLAIM_PATTERN } = require(`${L}/content/trend`);
const { setEventSink } = require(`${L}/observability/events`);
const { withEnv } = require('./helpers/live-env.cjs');

setEventSink(() => {});
const NOW = new Date('2026-10-05T07:00:00Z');
const DATES = ['2026-01-10', '2026-04-05', '2026-07-05', '2026-10-05', '2026-12-01'].map(day => new Date(`${day}T07:00:00Z`));
const signal = over => ({ source: 'evergreen', kind: 'evergreen', title: 'Fenster putzen ohne Schlieren', snippet: '', url: null, publisher: null, publisherUrl: null,
  publishedAt: null, eventDate: null, fetchedAt: NOW.toISOString(), strength: 0.5, tags: [], ...over });
const newsCluster = { title: 'Neue Regeln für die Mülltrennung ab Januar', signals: [
  signal({ source: 'tavily_news', kind: 'news', title: 'Neue Regeln für die Mülltrennung ab Januar', url: 'https://www.tagesschau.de/x', publisher: 'tagesschau.de',
    publisherUrl: 'https://www.tagesschau.de', publishedAt: NOW.toISOString(), strength: 0.8 }),
  signal({ source: 'google_news_rss', kind: 'news', title: 'Mülltrennung: Was sich ab Januar ändert', url: 'https://www.zdf.de/y', publisher: 'zdf.de',
    publisherUrl: 'https://www.zdf.de', publishedAt: NOW.toISOString(), strength: 0.7 }),
] };
async function offlineClusters(now) {
  const result = await runTopicScout({ now, sources: [calendarSource(), evergreenSource()], sleep: async () => {} });
  return result.candidates.map(candidate => result.clusters[candidate.topic_id]);
}

test('switch off (default): no pattern and the exact previous hook/angle', async () => {
  for (const env of [{ TOPIC_EDITORIAL_STYLE: undefined }, { TOPIC_EDITORIAL_STYLE: 'true' }]) {
    const restore = withEnv(env);
    try {
      for (const cluster of await offlineClusters(NOW)) for (const variant of [0, 1, 2]) {
        const built = buildCandidate(cluster, NOW, variant);
        assert.equal(built.editorial_pattern, undefined);
        const { type } = classifyTrend(cluster, NOW);
        const base = topicTexts(cluster, type, scoreCluster(cluster, type, NOW), NOW, variant);
        assert.equal(built.hook, base.hook.slice(0, 200)); assert.equal(built.angle, base.angle.slice(0, 300));
      }
    } finally { restore(); }
  }
  assert.equal(E.editorialStyleEnabled({ TOPIC_EDITORIAL_STYLE: 'on' }), true);
  assert.equal(E.editorialStyleEnabled({}), false);
});

test('pattern choice: no humour, hack or emotion on sensitive topics, aha only with a source, story/hack only with model copy, deterministic', () => {
  const base = { type: 'PRACTICAL_LIFE', sensitive: false, gossip: false, hasNewsSource: false, aiCopy: true };
  assert.deepEqual(E.allowedPatterns(base), ['hack', 'story', 'humor', 'emotion']);
  assert.deepEqual(E.allowedPatterns({ ...base, sensitive: true }), ['story']);
  assert.deepEqual(E.allowedPatterns({ ...base, sensitive: true, aiCopy: false }), [], 'sensitive in reference mode: no pattern, previous texts');
  assert.deepEqual(E.allowedPatterns({ ...base, aiCopy: false }), ['humor', 'emotion'], 'the rule template cannot deliver a scene or a handgrip');
  assert.deepEqual(E.allowedPatterns({ ...base, type: 'ENTERTAINMENT', gossip: true }), ['story']);
  assert.deepEqual(E.allowedPatterns({ ...base, type: 'BREAKING_NEWS' }), ['story']);
  assert.deepEqual(E.allowedPatterns({ ...base, type: 'BREAKING_NEWS', hasNewsSource: true }), ['aha', 'story']);
  for (const type of ['BREAKING_NEWS', 'SEARCH_TREND']) assert.ok(!E.allowedPatterns({ ...base, type, hasNewsSource: true }).includes('humor'), type);
  const context = { ...base, topicId: 'tp_0123456789abcdef', variant: 0 };
  assert.equal(E.choosePattern(context), E.choosePattern(context));
  assert.notEqual(E.choosePattern(context), E.choosePattern({ ...context, variant: 1 }), 'a new variant changes the pattern');
});

test('switch on: every offline topic gets a pattern, all patterns pass the gate (no claims, no sensational tone, hook quality)', async () => {
  const restore = withEnv({ TOPIC_EDITORIAL_STYLE: 'on', TOPIC_COPY_MODE: 'ai', REPLICATE_API_TOKEN: 'test-token' });
  try {
    const used = new Set();
    for (const now of DATES) for (const cluster of await offlineClusters(now)) for (const variant of [0, 1, 2]) {
      const built = buildCandidate(cluster, now, variant);
      assert.ok(E.EDITORIAL_PATTERNS.includes(built.editorial_pattern), built.title);
      assert.equal(topicCandidateSchema.safeParse(built).success, true);
      used.add(built.editorial_pattern);
      const verdict = topicGate(built, { now });
      for (const check of ['unsupported_claims', 'tone', 'quality', 'facts']) assert.equal(verdict.checks[check].passed, true, `${check}: ${built.hook}`);
      assert.doesNotMatch(`${built.hook} ${built.angle}`, UNSUPPORTED_CLAIM_PATTERN);
      assert.doesNotMatch(built.hook, /\d/, 'no invented numbers');
      assert.ok(!(built.editorial_pattern === 'aha'), 'offline topics have no source for an aha moment');
    }
    assert.ok(used.size >= 4, [...used].join(','));
  } finally { restore(); }
});

test('switch on: a news topic may become an aha moment, always attributed to its publisher', () => {
  const restore = withEnv({ TOPIC_EDITORIAL_STYLE: 'on', TOPIC_COPY_MODE: 'ai', REPLICATE_API_TOKEN: 'test-token' });
  try {
    const patterns = [0, 1, 2, 3].map(variant => buildCandidate(newsCluster, NOW, variant));
    const aha = patterns.filter(candidate => candidate.editorial_pattern === 'aha');
    assert.ok(aha.length, patterns.map(candidate => candidate.editorial_pattern).join(','));
    for (const candidate of aha) assert.match(candidate.hook, /[Ll]aut (tagesschau\.de|zdf\.de)/, candidate.hook);
    assert.ok(patterns.every(candidate => candidate.editorial_pattern !== 'humor' && candidate.editorial_pattern !== 'hack'));
  } finally { restore(); }
});

test('copy: the reference question follows the pattern; the model gets the pattern guidance on top of the unchanged rules', async () => {
  const restore = withEnv({ TOPIC_EDITORIAL_STYLE: 'on', TOPIC_COPY_MODE: 'ai', REPLICATE_API_TOKEN: 'test-token' });
  let candidate;
  try { candidate = buildCandidate((await offlineClusters(NOW))[0], NOW, 0); } finally { restore(); }
  const pattern = candidate.editorial_pattern;
  assert.equal(referenceCopy(candidate).question, E.PATTERN_QUESTION[pattern]);
  const calls = [];
  const generate = async (agent, instruction, input, schema, fallback) => { calls.push({ instruction, input }); return fallback(); };
  await writeTopicCopy(candidate, { generate });
  assert.ok(calls[0].instruction.includes(E.PATTERN_GUIDANCE[pattern]));
  assert.match(calls[0].instruction, /Erfinde keine Fakten, Zahlen, Tests/, 'base rules stay');
  assert.equal(calls[0].input.editorial_pattern, pattern);
  // Without a pattern: instruction and question exactly as before.
  const plain = { ...candidate }; delete plain.editorial_pattern;
  await writeTopicCopy(plain, { generate });
  assert.ok(!E.EDITORIAL_PATTERNS.some(item => calls[1].instruction.includes(E.PATTERN_GUIDANCE[item])));
  assert.equal(calls[1].input.editorial_pattern, undefined);
  assert.equal(referenceCopy(plain).question, 'Wie machst du das bei dir zuhause?');
  // The proposal names the pattern so the operator sees the voice before approving.
  const text = proposalText({ candidate, decision: { format: 'CAROUSEL', reason: 'Test', alternatives: [], slides: 6 }, copy: referenceCopy(candidate), production: null, revision: 1,
    product: { status: 'none' } });
  assert.match(text, new RegExp(`Erzählweise: ${E.EDITORIAL_LABEL[pattern]}`));
  assert.doesNotMatch(proposalText({ candidate: plain, decision: { format: 'CAROUSEL', reason: 'Test', alternatives: [], slides: 6 }, copy: referenceCopy(plain), production: null,
    revision: 1, product: { status: 'none' } }), /Erzählweise/);
});

test('schema: stored candidates without a pattern stay valid; unknown patterns are rejected', async () => {
  const candidate = buildCandidate((await offlineClusters(NOW))[0], NOW, 0);
  assert.equal(topicCandidateSchema.safeParse(candidate).success, true);
  assert.equal(topicCandidateSchema.safeParse({ ...candidate, editorial_pattern: 'story' }).success, true);
  assert.equal(topicCandidateSchema.safeParse({ ...candidate, editorial_pattern: 'clickbait' }).success, false);
});

test('reference mode (no model copy): only humour and emotion, never a story or hack the template cannot deliver', async () => {
  for (const env of [{ TOPIC_COPY_MODE: undefined }, { TOPIC_COPY_MODE: 'ai', REPLICATE_API_TOKEN: undefined }]) {
    const restore = withEnv({ TOPIC_EDITORIAL_STYLE: 'on', ...env });
    try {
      for (const now of DATES) for (const cluster of await offlineClusters(now)) for (const variant of [0, 1, 2]) {
        const built = buildCandidate(cluster, now, variant);
        assert.ok([undefined, 'humor', 'emotion'].includes(built.editorial_pattern), `${built.editorial_pattern}: ${built.hook}`);
      }
    } finally { restore(); }
  }
});

test('hack guard: the model guidance rules out risky tips, and a risky hack text falls back to the reference copy', async () => {
  assert.match(E.PATTERN_GUIDANCE.hack, /Keine Reinigungs- oder Chemikalienmischungen, nichts mit Strom, Gas, offener Flamme, Lebensmittelhaltbarkeit, Schimmel oder Medikamenten/);
  assert.match(E.PATTERN_GUIDANCE.aha, /Nur was wörtlich im Quellentitel steht/);
  const restore = withEnv({ TOPIC_EDITORIAL_STYLE: 'on', TOPIC_COPY_MODE: 'ai', REPLICATE_API_TOKEN: 'test-token' });
  let hack;
  try {
    for (const now of DATES) for (const cluster of await offlineClusters(now)) for (const variant of [0, 1, 2]) {
      const built = buildCandidate(cluster, now, variant);
      if (!hack && built.editorial_pattern === 'hack') hack = built;
    }
  } finally { restore(); }
  assert.ok(hack, 'an offline topic gets the hack voice');
  const answer = text => async (agent, instruction, input, schema, fallback) => ({ ...fallback(), body: text, caption: `${text} Mehr dazu im Beitrag.` });
  for (const risky of ['Einfach Essig und Chlorreiniger mischen, dann glänzt alles.', 'Die Steckdose kurz mit einem feuchten Tuch abwischen.',
    'Verschimmeltes Brot einfach großzügig abschneiden.', 'Eine Kerze ins Regal stellen, das trocknet die Luft.']) {
    const result = await writeTopicCopy(hack, { generate: answer(risky) });
    assert.equal(result.copy.origin, 'reference_template', risky);
    assert.match(result.fallbackReason, /Kniff mit Risikobezug/);
  }
  const safe = await writeTopicCopy(hack, { generate: answer('Leg die Dinge, die du morgens brauchst, schon abends an einen festen Platz neben die Tür.') });
  assert.equal(safe.copy.origin, 'model');
  // Only the hack voice is guarded this way; other voices and the switch-off path keep their previous checks.
  const story = { ...hack, editorial_pattern: 'story' };
  assert.equal((await writeTopicCopy(story, { generate: answer('Abends noch eine Kerze, dann wird es gemütlich auf dem Sofa.') })).copy.origin, 'model');
});
