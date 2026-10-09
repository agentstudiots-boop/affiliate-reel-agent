const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = '../.test-build/lib';
const { produceContent } = require(`${L}/visual/engine`);
const { memoryLedger } = require(`${L}/visual/ledger`);
const { memoryQuota } = require(`${L}/visual/video`);
const { createStyleBrief } = require(`${L}/visual/style`);
const { createHeyGenAvatarProvider } = require(`${L}/visual/providers/heygen`);
const { createRunwayStandardVideoProvider } = require(`${L}/visual/providers/runway-video`);
const { createReplicateBriefProvider } = require(`${L}/visual/providers/replicate`);
const { ImageGenerationError } = require(`${L}/visual/types`);
const { runTopicPipeline, handleTopicReply, resumeTopicProductions } = require(`${L}/topic-pipeline/orchestrator`);
const { calendarSource, evergreenSource } = require(`${L}/topics/sources/offline`);
const G = require(`${L}/publishing/approval-gate`);
const { setEventSink } = require(`${L}/observability/events`);
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { liveEnv } = require('./helpers/live-env.cjs');

setEventSink(() => {});
const style = createStyleBrief({ topicId: 'tp_1', trendType: 'PRACTICAL_LIFE' });
const copy = { title: 'Richtig lüften', hook: 'Drei Fehler beim Lüften im Herbst', problem: 'Feuchte Fenster', coreMessage: 'Kurz und kräftig lüften', body: 'b', caption: 'c', cta: 'Speichern',
  points: [{ headline: 'Fehler 1', text: 't' }, { headline: 'Fehler 2', text: 't' }, { headline: 'Fehler 3', text: 't' }], imageMotif: 'Fenster', videoScript: 'Skript' };
const input = (format, over = {}) => ({ contentId: 'tc_fb', format, copy, style, dryRun: false, visualPotential: 80, ...over });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const upload = async path => ({ url: `https://abc.public.blob.vercel-storage.com/${path}` });
const HEYGEN = { apiKey: 'hg', avatarId: 'a1', voiceId: 'v1', monthlyLimit: 3 };

function heygen(responses) {
  const calls = [];
  const request = async (url, init = {}) => { calls.push({ url: String(url), method: init.method || 'GET' }); const next = responses.shift(); if (!next) throw new Error('unscripted'); return typeof next === 'function' ? next(init) : next; };
  return { calls, provider: createHeyGenAvatarProvider({ ...HEYGEN, request, upload, timeoutMs: 30 }) };
}
function imageProvider(script = {}) {
  const calls = [];
  return { calls, name: 'replicate', model: 'fake', available: () => ({ ok: true }),
    async generate(brief, options) { calls.push(options.role); const step = Array.isArray(script[options.role]) ? script[options.role].shift() : script[options.role];
      if (step instanceof Error) throw step; if (options.onJobCreated) await options.onJobCreated(`job-${options.role}`);
      return { kind: 'image', url: `https://x.public.blob.vercel-storage.com/generated/topics/tc_fb/${options.role}.png`, sha256: 'a'.repeat(64), mediaType: 'image/png', provider: 'fake' }; } };
}
const ctx = (over = {}) => ({ ledger: memoryLedger(), imageProvider: imageProvider(), avatarQuota: { store: memoryQuota(), limit: 3 }, sleep: async () => {}, videoTiming: { pollIntervalMs: 0 }, ...over });
const chain = result => result.fallbacks.map(item => `${item.from}->${item.to}`);

test('video provider not available (missing credentials): Avatar → Video → Karussell without any provider call', async () => {
  const restore = require('./helpers/live-env.cjs').withEnv({ HEYGEN_API_KEY: undefined, HEYGEN_AVATAR_ID: undefined, HEYGEN_VOICE_ID: undefined, HEYGEN_MONTHLY_VIDEO_LIMIT: undefined, TOPIC_STANDARD_VIDEO_PROVIDER: undefined });
  try {
    const images = imageProvider();
    const result = await produceContent(input('AVATAR_VIDEO'), ctx({ imageProvider: images, avatarProvider: createHeyGenAvatarProvider({ request: async () => { throw new Error('no call'); } }),
      standardVideoProvider: createRunwayStandardVideoProvider() }));
    assert.equal(result.producedFormat, 'CAROUSEL');
    assert.deepEqual(chain(result), ['AVATAR_VIDEO->STANDARD_VIDEO', 'STANDARD_VIDEO->CAROUSEL']);
    assert.match(result.errors.join(' '), /HEYGEN_API_KEY.*fehlt/);
    assert.match(result.errors.join(' '), /TOPIC_STANDARD_VIDEO_PROVIDER/);
  } finally { restore(); }
});

test('video quota exhausted: no avatar call at all, falls back', async () => {
  const quota = memoryQuota();
  const month = new Date().toISOString().slice(0, 7);
  for (const key of ['a', 'b', 'c']) { await quota.reserve('heygen', 'avatar_video', key, month); await quota.settle('heygen', key, 'succeeded'); }
  const { calls, provider } = heygen([]);
  const result = await produceContent(input('AVATAR_VIDEO'), ctx({ avatarProvider: provider, avatarQuota: { store: quota, limit: 3 } }));
  assert.equal(calls.length, 0);
  assert.equal(result.producedFormat, 'CAROUSEL');
  assert.match(result.errors[0], /heygen_quota_exhausted/);
});

for (const [label, responses, expected] of [
  ['video job fails', [json({ error: null, data: { video_id: 'vid_abcdef12' } }), json({ data: { status: 'failed' } })], /heygen_job_failed/],
  ['provider 429', [json({ message: 'too many' }, 429)], /heygen_rate_limited/],
  ['provider timeout (outcome unknown, never re-POSTed)', [init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))], /heygen_timeout/],
  ['invalid provider response', [json({ data: {} })], /heygen_invalid_response/],
  ['auth error', [json({ message: 'bad key' }, 401)], /heygen_auth/],
]) {
  test(`${label}: falls back to the next format, the failed unit is not regenerated`, async () => {
    const { calls, provider } = heygen([...responses]);
    const ledger = memoryLedger();
    const result = await produceContent(input('AVATAR_VIDEO'), ctx({ ledger, avatarProvider: provider }));
    assert.equal(result.producedFormat, 'CAROUSEL');
    assert.match(result.errors[0], expected);
    const posts = calls.filter(call => call.method === 'POST').length;
    assert.ok(posts <= 1);
    // Running production again does not create a second avatar job for the same script (ledger blocks or reuses).
    await produceContent(input('AVATAR_VIDEO'), ctx({ ledger, avatarProvider: provider }));
    assert.equal(calls.filter(call => call.method === 'POST').length, posts + (label === 'provider 429' ? 1 : 0), 'only a definite 429 may be retried once later');
  });
}

test('carousel: one slide fails → only that slide degrades, the carousel stays; image fails → Text', async () => {
  const images = imageProvider({ 'slide-2': [new ImageGenerationError('rate_limited', true, null, 429), new ImageGenerationError('rate_limited', true, null, 429), new ImageGenerationError('rate_limited', true, null, 429)] });
  const carousel = await produceContent(input('CAROUSEL'), ctx({ imageProvider: images }));
  assert.equal(carousel.producedFormat, 'CAROUSEL');
  assert.equal(carousel.status, 'degraded');
  assert.deepEqual(carousel.carousel.slideResults.filter(item => item.status === 'degraded').map(item => item.slide_number), [2]);
  assert.equal(images.calls.filter(role => role === 'slide-1').length, 1);
  const failing = imageProvider({ 'main-image': new ImageGenerationError('provider_error', false) });
  const single = await produceContent(input('SINGLE_IMAGE'), ctx({ imageProvider: failing }));
  assert.equal(single.producedFormat, 'TEXT');
  assert.deepEqual(chain(single), ['SINGLE_IMAGE->TEXT']);
});

test('Replicate 429, timeout and invalid output through the real adapter: degrade to Text, no second paid POST after a timeout', async () => {
  const make = responses => { const calls = []; return { calls, provider: createReplicateBriefProvider({ token: 'r8', pollIntervalMs: 1, timeoutMs: 30, upload,
    request: async (url, init = {}) => { calls.push(init.method || 'GET'); const next = responses.shift(); return typeof next === 'function' ? next(init) : next; } }) }; };
  const limited = make([json({}, 429), json({}, 429), json({}, 429)]);
  assert.equal((await produceContent(input('SINGLE_IMAGE'), ctx({ imageProvider: limited.provider }))).producedFormat, 'TEXT');
  assert.equal(limited.calls.filter(method => method === 'POST').length, 3, 'definite 429 refusals: bounded retries');
  const hanging = make([init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))]);
  assert.equal((await produceContent(input('SINGLE_IMAGE'), ctx({ imageProvider: hanging.provider }))).producedFormat, 'TEXT');
  assert.equal(hanging.calls.filter(method => method === 'POST').length, 1, 'unknown outcome: never re-POSTed');
  const invalid = make([json({ id: 'abcdef123456', status: 'succeeded', output: 'https://evil.example/x.png' })]);
  assert.equal((await produceContent(input('SINGLE_IMAGE'), ctx({ imageProvider: invalid.provider }))).producedFormat, 'TEXT');
});

test('pipeline: a running avatar job is resumed (no new job); when it then fails, the fallback needs a NEW publish approval', async () => {
  const restore = liveEnv();
  const db = await pgliteDatabase();
  try {
    let status = 'processing';
    const { calls, provider } = heygen([]);
    // Scripted HeyGen: one create, then status per call.
    provider.create = async () => { calls.push({ method: 'POST' }); return { jobId: 'vid_abcdef12' }; };
    provider.status = async () => ({ state: status });
    const sent = [];
    let n = 0;
    const deps = { db, trustedWaId: '491701234567', now: () => new Date('2026-10-05T07:00:00Z'), send: async text => { sent.push(text); return `wamid.fb.${++n}`; },
      render: { ledger: memoryLedger(), imageProvider: imageProvider(), avatarProvider: provider, avatarQuota: { store: memoryQuota(), limit: 3 }, sleep: async () => {}, videoTiming: { pollIntervalMs: 0, maxWaitMs: 0 } },
      scoutOptions: { sources: [calendarSource(), evergreenSource()], sleep: async () => {} }, publishers: [], rasterize: async asset => ({ ...asset, url: asset.url ?? 'https://x.public.blob.vercel-storage.com/r/s.png' }),
      interpret: async (body, context) => ({ domain: 'topic', content_id: context.replying_to.content_id, intent: 'change', format: 'AVATAR_VIDEO', slides: null, exclude_formats: [], tone: [], new_hook: false,
        cheaper: false, product_wish: null, answer: null, clarification_question: null, confidence: 0.95, ambiguity: 'none' }) };
    const reply = (body, to) => handleTopicReply(deps, { id: `wamid.in.${Math.random()}`, from: '491701234567', body, replyToMessageId: to });
    await runTopicPipeline(deps, { slotKey: 'fallback' });
    await reply('Mach daraus ein Avatar-Video', 'wamid.fb.1');
    assert.match(sent.at(-1), /Format: Avatar-Video/);
    await reply('Freigeben', `wamid.fb.${n}`);
    assert.match(sent.at(-1), /wird noch erzeugt/);
    assert.equal((await db.query('SELECT stage FROM topic_contents')).rows[0].stage, 'in_production');
    assert.equal(calls.length, 1);
    await resumeTopicProductions(deps);           // still processing: resumed by id, no new job
    assert.equal(calls.length, 1);
    status = 'failed';
    await resumeTopicProductions(deps);           // job failed → fallback to carousel → new publish approval
    assert.equal(calls.length, 1, 'never a second avatar job');
    const approval = sent.at(-1);
    assert.match(approval, /^Veröffentlichungsfreigabe · Themen-Post, Karussell/);
    const contentId = (await db.query('SELECT content_id FROM topic_contents')).rows[0].content_id;
    assert.equal((await G.approvalState(db, contentId)).status, 'pending', 'fallback result is not approved by anything earlier');
    assert.equal((await db.query("SELECT count(*)::int AS n FROM publish_attempts WHERE status<>'blocked'")).rows[0].n, 0);
  } finally { await db.close(); restore(); }
});
