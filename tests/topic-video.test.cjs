const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const L = '../.test-build/lib';
const { runTopicVideoCron, TOPIC_VIDEO_WINDOW } = require(`${L}/topic-pipeline/video-cron`);
const { berlinSlotKey, insideWindow } = require(`${L}/topic-pipeline/cron`);
const { handleTopicReply } = require(`${L}/topic-pipeline/orchestrator`);
const { referenceVideoBriefing, validBriefing, writeVideoBriefing, videoProviderPrompt, fitSpoken, videoBriefingSchema } = require(`${L}/topic-pipeline/video-briefing`);
const { referenceCopy } = require(`${L}/topic-pipeline/copy`);
const { planTopicVideo } = require(`${L}/topic-pipeline/video-plan`);
const { memoryLedger } = require(`${L}/visual/ledger`);
const { memoryQuota } = require(`${L}/visual/video`);
const { createRunwayStandardVideoProvider } = require(`${L}/visual/providers/runway-video`);
const { calendarSource, evergreenSource } = require(`${L}/topics/sources/offline`);
const { setEventSink } = require(`${L}/observability/events`);
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { withEnv } = require('./helpers/live-env.cjs');
const { fakeTopicGenerator } = require('./helpers/fake-topic-generator.cjs');

setEventSink(() => {});
const OPERATOR = '491701234567';
const NOON = new Date('2026-10-19T10:05:00Z'); // Monday, 12:05 Berlin (summer time)

function fakeRunway() {
  const calls = { create: [], status: 0 };
  const client = {
    textToVideo: { create: async input => { calls.create.push(input); return { id: `task_${calls.create.length}` }; } },
    tasks: { retrieve: async id => { calls.status++; return { id, status: 'SUCCEEDED', output: ['https://runway.example/video.mp4'] }; } },
  };
  const provider = createRunwayStandardVideoProvider({ client, request: async () => new Response(Buffer.from('mp4-bytes'), { headers: { 'content-type': 'video/mp4' } }),
    upload: async path => ({ url: `https://abc.public.blob.vercel-storage.com/${path}` }) });
  return { provider, calls };
}

function deps(db, sent, over = {}) {
  let n = 0;
  return { db, trustedWaId: OPERATOR, now: () => NOON, send: async text => { sent.push(text); return `wamid.video.${++n}.${sent.length}`; },
    render: { ledger: memoryLedger(), imageProvider: null, sleep: async () => {}, videoTiming: { pollIntervalMs: 0 }, ...(over.render ?? {}) },
    scoutOptions: { sources: [calendarSource(), evergreenSource()], sleep: async () => {} }, publishers: [], rasterize: async asset => asset,
    // Model copy for the post text (offline fake); the video briefing falls back to the reference built from it.
    generate: fakeTopicGenerator().generate,
    interpret: async () => { throw new Error('no model'); }, ...Object.fromEntries(Object.entries(over).filter(([key]) => key !== 'render')) };
}
const reply = (d, id, body, to) => handleTopicReply(d, { id, from: OPERATOR, body, replyToMessageId: to });

test('video cron schedule: 10/11/12 UTC give exactly two calls inside 12–14 Berlin in summer AND winter; image slots untouched', () => {
  const crons = JSON.parse(fs.readFileSync('vercel.json', 'utf8')).crons;
  const hours = crons.filter(cron => cron.path === '/api/cron/topic-video').map(cron => Number(cron.schedule.split(' ')[1]));
  assert.deepEqual(hours, [10, 11, 12]);
  for (const day of ['2026-10-19', '2026-10-26', '2027-03-29']) {
    const inside = hours.filter(hour => insideWindow(berlinSlotKey(new Date(`${day}T${String(hour).padStart(2, '0')}:30:00Z`)), TOPIC_VIDEO_WINDOW));
    assert.equal(inside.length, 2, `${day}: two calls inside the window`);
  }
  assert.deepEqual(crons.filter(cron => cron.path === '/api/cron/daily-draft').map(cron => cron.schedule), ['0 7 * * *', '0 8 * * *', '0 9 * * *', '0 16 * * *', '0 17 * * *', '0 18 * * *']);
});

test('disabled and outside-window calls draft nothing', async () => {
  assert.equal((await runTopicVideoCron({ enabled: false, now: NOON, deps: () => { throw new Error('must not load'); } })).status, 'disabled');
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const result = await runTopicVideoCron({ enabled: true, now: new Date('2026-10-19T08:00:00Z'), deps: () => deps(db, sent) });
    assert.equal(result.status, 'outside_window');
    assert.equal(sent.length, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM topic_video_days')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('exactly one regular video proposal per Berlin day: repeated calls are no-ops; the message carries all required facts', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const first = await runTopicVideoCron({ enabled: true, now: NOON, deps: () => deps(db, sent) });
    assert.equal(first.status, 'proposed');
    const second = await runTopicVideoCron({ enabled: true, now: new Date('2026-10-19T11:10:00Z'), deps: () => deps(db, sent) });
    assert.equal(second.status, 'already_proposed');
    assert.equal(sent.length, 1);
    const text = sent[0];
    for (const pattern of [/Themenvideo-Vorschlag/, /Content-ID tc_[a-f0-9]{16}/, /Thema: „/, /Hook \(0–3 s\)/, /Länge: \d+ s/, /9:16, Ziel 1080 × 1920/, /Videoanbieter:/, /geschätzte Produktionskosten/, /nur INHALT freigeben/]) assert.match(text, pattern);
    const row = (await db.query('SELECT stage, video, cost_message_id FROM topic_contents')).rows[0];
    assert.equal(row.stage, 'proposed');
    assert.equal(row.video.kind, 'daily_video');
    assert.equal(row.video.day, '2026-10-19');
    assert.equal(row.video.contentApprovedAt, null);
    assert.equal(row.cost_message_id, null);
    assert.deepEqual((await db.query('SELECT status, content_id IS NOT NULL AS has FROM topic_video_days')).rows[0], { status: 'proposed', has: true });
  } finally { await db.close(); }
});

test('a day without a proposal is retried by the next call, at most three attempts', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const empty = () => deps(db, sent, { scoutOptions: { sources: [], sleep: async () => {} }, scout: async () => ({ runId: 'r', startedAt: NOON.toISOString(), durationMs: 1, outcome: 'no_candidates', candidates: [], dropped: [], sourceHealth: [], clusters: {} }) });
    const results = [];
    for (let i = 0; i < 4; i++) {
      await db.query("UPDATE topic_video_days SET updated_at=now()-interval '1 hour'").catch(() => undefined);
      results.push((await runTopicVideoCron({ enabled: true, now: NOON, deps: empty })).status);
    }
    assert.equal(results[3], 'exhausted');
    assert.ok(results.slice(0, 3).every(status => ['no_topic', 'failed'].includes(status)), results.join(','));
    assert.equal(sent.length, 0);
  } finally { await db.close(); }
});

test('reference briefing: complete, gap-free 30 s timeline, hook within 3 s, spoken text fits the time, no links or invented claims', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    await runTopicVideoCron({ enabled: true, now: NOON, deps: () => deps(db, sent) });
    const { video } = (await db.query('SELECT video FROM topic_contents')).rows[0];
    const briefing = videoBriefingSchema.parse(video.briefing);
    assert.equal(validBriefing(briefing), null);
    assert.equal(briefing.durationSeconds, 30);
    assert.equal(briefing.scenes[0].start, 0);
    assert.ok(briefing.scenes[0].end <= 3);
    assert.equal(briefing.scenes.at(-1).end, 30);
    assert.deepEqual(briefing.format, { aspect: '9:16', width: 1080, height: 1920 });
    assert.equal(briefing.voiceOver.language, 'de-DE');
    assert.ok(briefing.quality.length >= 4);
    assert.ok(briefing.platform.youtube.title.length > 3 && briefing.platform.instagram.caption.length > 10);
    for (const scene of briefing.scenes) for (const key of ['spokenText', 'visual', 'camera', 'transition']) assert.ok(scene[key].length > 1, `${key} in scene ${scene.index}`);
    const prompt = videoProviderPrompt(briefing);
    assert.ok(prompt.length <= 3800);
    assert.match(prompt, /Gesprochener Text \(wörtlich, Deutsch\)/);
    assert.ok(briefing.scenes.every(scene => prompt.includes(scene.spokenText)));
  } finally { await db.close(); }
  assert.equal(fitSpoken('Eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf.', 3).split(' ').length <= 7, true);
});

test('AI briefing: a valid model briefing is used; a greeting hook, a price claim or a broken timeline fall back to the reference', async () => {
  const candidateRow = await (async () => {
    const db = await pgliteDatabase();
    try { await runTopicVideoCron({ enabled: true, now: NOON, deps: () => deps(db, []) }); return (await db.query('SELECT candidate, copy FROM topic_contents')).rows[0]; }
    finally { await db.close(); }
  })();
  const candidate = candidateRow.candidate.candidate;
  const copy = referenceCopy(candidate);
  const model = { ...referenceVideoBriefing(candidate, copy), origin: 'model', hook: { spoken: 'Warum ist der Flur immer zuerst unordentlich?', onScreen: 'Flur-Chaos?', visual: 'Schuhberg im Flur', why: 'Wiedererkennung' } };
  const generate = briefing => async () => briefing;
  const used = await writeVideoBriefing(candidate, copy, { generate: generate(model) });
  assert.equal(used.briefing.origin, 'model');
  assert.equal(used.modelCalls, 1);
  for (const broken of [
    { ...model, hook: { ...model.hook, spoken: 'Hallo zusammen, heute zeige ich euch was' } },
    { ...model, scenes: model.scenes.map((scene, index) => index === 2 ? { ...scene, spokenText: 'Nur 9,99 € im Angebot des Tages' } : scene) },
    { ...model, scenes: model.scenes.map((scene, index) => index === 1 ? { ...scene, start: scene.start + 1 } : scene) },
  ]) {
    const result = await writeVideoBriefing(candidate, copy, { generate: generate(broken) });
    assert.equal(result.briefing.origin, 'reference_template');
    assert.ok(result.fallbackReason);
  }
});

test('three separate decisions: content approval never renders; only the cost approval renders exactly once; then a publish approval with checklist', async () => {
  const db = await pgliteDatabase();
  const restore = withEnv({ TOPIC_STANDARD_VIDEO_PROVIDER: undefined, TOPIC_VIDEO_MAX_USD: undefined, TOPIC_VIDEO_MONTHLY_BUDGET_USD: undefined });
  try {
    const sent = [];
    const runway = fakeRunway();
    const d = deps(db, sent, { render: { standardVideoProvider: runway.provider, standardQuota: { store: memoryQuota(), limit: 3 } } });
    await runTopicVideoCron({ enabled: true, now: NOON, deps: () => d });
    assert.match(sent[0], /Runway WAN 3/);
    assert.match(sent[0], /ca\. 3\.00 USD/);
    const proposal = (await db.query('SELECT proposal_message_id FROM topic_contents')).rows[0].proposal_message_id;
    // 1) content approval: cost request only, no provider call
    await reply(d, 'op.1', 'Freigeben', proposal);
    assert.equal(runway.calls.create.length, 0);
    assert.match(sent.at(-1), /Kostenfreigabe Themenvideo/);
    assert.match(sent.at(-1), /ca\. 3\.00 USD/);
    assert.match(sent.at(-1), /keine Veröffentlichungsfreigabe/);
    const row = (await db.query('SELECT video, cost_message_id FROM topic_contents')).rows[0];
    assert.ok(row.video.contentApprovedAt);
    assert.ok(row.cost_message_id);
    // 2) cost approval: exactly one render with the storyboard prompt (spoken text verbatim)
    await reply(d, 'op.2', 'Freigeben', row.cost_message_id);
    assert.equal(runway.calls.create.length, 1);
    assert.match(runway.calls.create[0].promptText, /Gesprochener Text \(wörtlich, Deutsch\)/);
    // 3) publish approval message with the review checklist; nothing published
    assert.match(sent.at(-1), /Veröffentlichungsfreigabe/);
    assert.match(sent.at(-1), /Vor „Freigeben“ bitte im Video prüfen/);
    assert.equal((await db.query('SELECT stage FROM topic_contents')).rows[0].stage, 'awaiting_publish_approval');
    // Replayed or repeated cost approval: no second render
    await reply(d, 'op.2', 'Freigeben', row.cost_message_id);
    await reply(d, 'op.3', 'Freigeben', row.cost_message_id);
    assert.equal(runway.calls.create.length, 1);
    assert.match(sent.at(-1), /nicht mehr offen/);
    const video = (await db.query('SELECT video FROM topic_contents')).rows[0].video;
    assert.equal(video.estimateUsd, 3);
    assert.ok(video.costApprovedAt);
  } finally { restore(); await db.close(); }
});

test('cost rejection: no render, no cost; no provider: the content approval yields only an information message without an approvable cost request', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const runway = fakeRunway();
    const d = deps(db, sent, { render: { standardVideoProvider: runway.provider, standardQuota: { store: memoryQuota(), limit: 3 } } });
    await runTopicVideoCron({ enabled: true, now: NOON, deps: () => d });
    const proposal = (await db.query('SELECT proposal_message_id FROM topic_contents')).rows[0].proposal_message_id;
    await reply(d, 'op.1', 'Freigeben', proposal);
    const cost = (await db.query('SELECT cost_message_id FROM topic_contents')).rows[0].cost_message_id;
    await reply(d, 'op.2', 'Ablehnen', cost);
    assert.equal(runway.calls.create.length, 0);
    assert.equal((await db.query('SELECT stage FROM topic_contents')).rows[0].stage, 'rejected');
    assert.match(sent.at(-1), /keine Kosten/);
  } finally { await db.close(); }
  const db2 = await pgliteDatabase();
  try {
    const sent = [];
    const d = deps(db2, sent); // no video provider configured (production today)
    await runTopicVideoCron({ enabled: true, now: NOON, deps: () => d });
    assert.match(sent[0], /kein Videoanbieter aktiv/);
    assert.match(sent[0], /Rendering derzeit nicht möglich/);
    const proposal = (await db2.query('SELECT proposal_message_id FROM topic_contents')).rows[0].proposal_message_id;
    await reply(d, 'op.1', 'Freigeben', proposal);
    assert.match(sent.at(-1), /Kostenfreigabe ist gerade nicht möglich/);
    assert.equal((await db2.query('SELECT cost_message_id FROM topic_contents')).rows[0].cost_message_id, null);
    assert.ok((await db2.query('SELECT video FROM topic_contents')).rows[0].video.contentApprovedAt);
  } finally { await db2.close(); }
});

test('cost ceilings: over the per-video maximum or the monthly budget nothing can be approved', async () => {
  const runway = fakeRunway();
  const render = { ledger: memoryLedger(), imageProvider: null, standardVideoProvider: runway.provider, standardQuota: { store: memoryQuota(), limit: 3 } };
  const ok = await planTopicVideo(render, 30, { env: {}, spentThisMonth: 0 });
  assert.deepEqual([ok.provider, ok.estimateUsd, ok.blockers.length], ['Runway WAN 3', 3, 0]);
  assert.ok((await planTopicVideo(render, 30, { env: { TOPIC_VIDEO_MAX_USD: '2' }, spentThisMonth: 0 })).blockers.some(text => /Höchstbetrag/.test(text)));
  assert.ok((await planTopicVideo(render, 30, { env: { TOPIC_VIDEO_MONTHLY_BUDGET_USD: '10' }, spentThisMonth: 8 })).blockers.some(text => /Monatsbudget/.test(text)));
});

test('a change after the content approval voids it and the open cost request (new version, new decisions)', async () => {
  const db = await pgliteDatabase();
  try {
    const sent = [];
    const runway = fakeRunway();
    const d = deps(db, sent, { render: { standardVideoProvider: runway.provider, standardQuota: { store: memoryQuota(), limit: 3 } },
      interpret: async () => ({ domain: 'topic', intent: 'change', content_id: null, format: null, slides: null, exclude_formats: [], tone: ['less_promotional'], new_hook: false, cheaper: false,
        product_wish: null, answer: null, clarification_question: null, confidence: 0.9, ambiguity: 'none' }) });
    await runTopicVideoCron({ enabled: true, now: NOON, deps: () => d });
    const proposal = (await db.query('SELECT proposal_message_id FROM topic_contents')).rows[0].proposal_message_id;
    await reply(d, 'op.1', 'Freigeben', proposal);
    const oldCost = (await db.query('SELECT cost_message_id FROM topic_contents')).rows[0].cost_message_id;
    await reply(d, 'op.2', 'Anderer Aufhänger bitte', proposal);
    const row = (await db.query('SELECT revision, video, cost_message_id, proposal_message_id FROM topic_contents')).rows[0];
    assert.equal(row.revision, 2);
    assert.equal(row.video.contentApprovedAt, null);
    assert.equal(row.cost_message_id, null);
    assert.notEqual(row.proposal_message_id, proposal);
    assert.match(sent.at(-1), /Themenvideo-Vorschlag \(Überarbeitung 2\)/);
    await reply(d, 'op.3', 'Freigeben', oldCost);
    assert.equal(runway.calls.create.length, 0, 'the outdated cost approval cannot start a render');
    assert.match(sent.at(-1), /veraltet/);
  } finally { await db.close(); }
});

test('video route: 401 without the cron secret; disabled without both switches and without loading the runtime wiring', async () => {
  const loadRoute = require('./helpers/load-route.cjs');
  for (const env of [{ TOPIC_PIPELINE_ENABLED: undefined, TOPIC_DAILY_VIDEO: 'true' }, { TOPIC_PIPELINE_ENABLED: 'true', TOPIC_DAILY_VIDEO: undefined }]) {
    const restore = withEnv({ CRON_SECRET: 'cron-secret-123', VERCEL_ENV: 'production', ...env });
    try {
      const route = loadRoute('app/api/cron/topic-video/route.ts', { '@/lib/agents/topic-runtime': new Proxy({}, { get() { throw new Error('runtime must not load'); } }) });
      assert.equal((await route.GET(new Request('https://local.test/api/cron/topic-video'))).status, 401);
      const response = await route.GET(new Request('https://local.test/api/cron/topic-video', { headers: { authorization: 'Bearer cron-secret-123' } }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).status, 'disabled');
    } finally { restore(); }
  }
});
