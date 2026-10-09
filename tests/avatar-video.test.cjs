const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = '../.test-build/lib/visual';
const { createHeyGenAvatarProvider } = require(`${B}/providers/heygen`);
const { createRunwayStandardVideoProvider } = require(`${B}/providers/runway-video`);
const { runVideoJob, memoryQuota, postgresQuota, VideoProviderError } = require(`${B}/video`);
const { memoryLedger, postgresLedger } = require(`${B}/ledger`);
const { produceContent } = require(`${B}/engine`);
const { providerAvailability } = require(`${B}/availability`);
const { createStyleBrief } = require(`${B}/style`);
const { decideFormat } = require('../.test-build/lib/formats/router');
const { setEventSink, recentEvents, clearRecentEvents } = require('../.test-build/lib/observability/events');
const pgliteDatabase = require('./helpers/pglite-db.cjs');

setEventSink(() => {});
const noSleep = async () => {};
const config = { apiKey: 'hg_test_key', avatarId: 'avatar_123', voiceId: 'voice_123', monthlyLimit: 3 };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const mp4 = () => new Response(Buffer.from('fake-mp4-bytes'), { headers: { 'content-type': 'video/mp4' } });
const upload = async path => ({ url: `https://abc.public.blob.vercel-storage.com/${path}` });

function heygen(responses, over = {}) {
  const calls = [];
  const request = async (url, init = {}) => { calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers });
    const next = responses.shift(); if (!next) throw new Error('no scripted response'); return typeof next === 'function' ? next(init) : next; };
  return { provider: createHeyGenAvatarProvider({ ...config, request, upload, ...over }), calls };
}
const input = { contentId: 'tc_1', role: 'avatar-video', title: 'Richtig lüften', script: 'Drei Fehler beim Lüften im Herbst …', visualPrompt: 'x', aspect: '9:16' };
const job = (provider, over = {}) => runVideoJob(input, { ledger: memoryLedger(), provider, quota: { store: memoryQuota(), limit: 3 }, sleep: noSleep, pollIntervalMs: 0, ...over });
const created = () => json({ error: null, data: { video_id: 'vid_abcdef12' } });
const status = (state, extra = {}) => json({ code: 100, data: { status: state, ...extra } });

test('successful HeyGen job: one POST, polling, archive to Blob, quota counted once', async () => {
  const quota = memoryQuota();
  const { provider, calls } = heygen([created, status('processing'), status('completed', { video_url: 'https://files.heygen.ai/v.mp4?sig=x' }), mp4]);
  const result = await job(provider, { quota: { store: quota, limit: 3 } });
  assert.equal(result.state, 'completed');
  assert.match(result.asset.url, /generated\/topics\/tc_1\/avatar-[a-f0-9]{64}\.mp4$/);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(calls[0].headers['X-Api-Key'], 'hg_test_key');
  assert.deepEqual(await quota.usage('heygen', new Date().toISOString().slice(0, 7)), { planned: 0, succeeded: 1, failed: 0 });
});

test('timeout on the paid POST: outcome unknown, no second POST', async () => {
  const hanging = init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const { provider, calls } = heygen([hanging], { timeoutMs: 20 });
  const ledger = memoryLedger();
  const result = await job(provider, { ledger });
  assert.deepEqual([result.state, result.category, result.retryable], ['failed', 'timeout', false]);
  const again = await job(provider, { ledger });
  assert.equal(again.state, 'failed');
  assert.equal(calls.length, 1, 'never re-POSTed');
});

test('429 at creation is classified rate_limited; auth errors are final', async () => {
  const limited = await job(heygen([json({ message: 'Too many requests' }, 429)]).provider);
  assert.deepEqual([limited.category, limited.retryable], ['rate_limited', true]);
  const auth = await job(heygen([json({ message: 'invalid api key hg_test_key' }, 401)]).provider);
  assert.deepEqual([auth.category, auth.retryable], ['auth', false]);
});

test('quota reached: locally (monthly limit) without any HeyGen call, and when HeyGen refuses for credits', async () => {
  clearRecentEvents();
  const quota = memoryQuota();
  const month = new Date().toISOString().slice(0, 7);
  for (const key of ['a', 'b', 'c']) { await quota.reserve('heygen', 'avatar_video', key, month); await quota.settle('heygen', key, 'succeeded'); }
  const { provider, calls } = heygen([]);
  const local = await job(provider, { quota: { store: quota, limit: 3 } });
  assert.equal(local.category, 'quota_exhausted');
  assert.equal(calls.length, 0);
  assert.ok(recentEvents('avatar_quota_blocked').length);
  const remote = await job(heygen([json({ error: { code: 'insufficient_credit', message: 'Insufficient credit' } }, 400)]).provider);
  assert.equal(remote.category, 'quota_exhausted');
});

test('HeyGen job failed and job stuck end the job; a stuck job is not re-created', async () => {
  const failed = await job(heygen([created, status('failed', { error: { message: 'render error' } })]).provider);
  assert.equal(failed.category, 'job_failed');
  let clock = 0;
  const realNow = Date.now;
  Date.now = () => (clock += 60_000) + realNow();
  try {
    const { provider, calls } = heygen([created, status('processing'), status('processing'), status('processing'), status('processing')]);
    const stuck = await job(provider, { stuckAfterMs: 120_000, maxWaitMs: 10 * 60_000 });
    assert.equal(stuck.category, 'job_stuck');
    assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  } finally { Date.now = realNow; }
});

test('API down while polling is transient; an in-progress job is resumed later, never generated twice', async () => {
  const ledger = memoryLedger();
  const first = heygen([created, json({}, 503), status('processing')]);
  const pending = await job(first.provider, { ledger, maxWaitMs: 0 });
  assert.deepEqual([pending.state, pending.jobId], ['in_progress', 'vid_abcdef12']);
  const second = heygen([status('completed', { video_url: 'https://files.heygen.ai/v.mp4' }), mp4]);
  const done = await job(second.provider, { ledger });
  assert.equal(done.state, 'completed');
  assert.equal(second.calls.filter(call => call.method === 'POST').length, 0, 'resumed by id, no second video');
  const third = heygen([]);
  const reused = await job(third.provider, { ledger });
  assert.equal(reused.reused, true);
  assert.equal(third.calls.length, 0);
});

test('invalid HeyGen answers are classified, keys never leak into errors', async () => {
  const bad = await job(heygen([json({ data: {} })]).provider);
  assert.equal(bad.category, 'invalid_response');
  const { provider } = heygen([json({ message: 'boom hg_test_key' }, 401)]);
  await assert.rejects(provider.create(input), error => error instanceof VideoProviderError && !/hg_test_key/.test(error.message));
});

test('missing HEYGEN credentials or monthly limit: provider unavailable, router never picks AVATAR_VIDEO', async () => {
  const saved = { ...process.env };
  for (const key of ['HEYGEN_API_KEY', 'HEYGEN_AVATAR_ID', 'HEYGEN_VOICE_ID', 'HEYGEN_MONTHLY_VIDEO_LIMIT']) delete process.env[key];
  try {
    const provider = createHeyGenAvatarProvider();
    assert.match(provider.available().reason, /HEYGEN_API_KEY.*HEYGEN_MONTHLY_VIDEO_LIMIT/);
    const availability = await providerAvailability({ ledger: memoryLedger(), imageProvider: null, avatarProvider: provider, avatarQuota: { store: memoryQuota(), limit: 0 } });
    assert.equal(availability.avatarVideo.available, false);
    const decision = decideFormat({ topic: { topic_id: 'tp_1', trend_type: 'PRACTICAL_LIFE', suggested_format: 'AVATAR_VIDEO', relevance_score: 90, virality_score: 90, visual_potential: 60,
      suitable_for_video: true, suitable_for_avatar: true, risk_score: 5, scores: { utility: { score: 90 }, video_fit: { score: 70 }, interaction: { score: 70 }, emotionality: { score: 30 } } },
      platforms: ['tiktok'], availability });
    assert.notEqual(decision.format, 'AVATAR_VIDEO');
  } finally { process.env = saved; }
});

const style = createStyleBrief({ topicId: 'tp_1', trendType: 'PRACTICAL_LIFE' });
const renderInput = { contentId: 'tc_7', style, dryRun: false, visualPotential: 70, format: 'AVATAR_VIDEO',
  copy: { title: 'Lüften', hook: 'Drei Fehler beim Lüften', problem: 'Feuchte Fenster', coreMessage: 'Kurz und kräftig lüften', body: 'b', caption: 'c', cta: 'Speichern',
    points: [{ headline: 'Fehler 1', text: 't' }, { headline: 'Fehler 2', text: 't' }, { headline: 'Fehler 3', text: 't' }], imageMotif: 'Fenster', videoScript: 'Skript' } };

test('HeyGen down: the pipeline falls back to standard video, carousel, image or text instead of aborting', async () => {
  const down = heygen([json({}, 503)]).provider;
  const runway = createRunwayStandardVideoProvider({ client: { textToVideo: { create: async () => { const error = new Error('down'); error.status = 503; throw error; } }, tasks: { retrieve: async () => ({}) } } });
  const result = await produceContent(renderInput, { ledger: memoryLedger(), imageProvider: null, avatarProvider: down, standardVideoProvider: runway,
    avatarQuota: { store: memoryQuota(), limit: 3 }, sleep: noSleep, videoTiming: { pollIntervalMs: 0 } });
  assert.equal(result.producedFormat, 'CAROUSEL');
  assert.deepEqual(result.fallbacks.map(item => `${item.from}->${item.to}`), ['AVATAR_VIDEO->STANDARD_VIDEO', 'STANDARD_VIDEO->CAROUSEL']);
  assert.match(result.errors[0], /heygen_provider_down/);
});

test('"Kein Avatar" / dry run: no HeyGen call; dry run reports that HeyGen would be used', async () => {
  const { provider, calls } = heygen([]);
  const dry = await produceContent({ ...renderInput, dryRun: true }, { ledger: memoryLedger(), imageProvider: null, avatarProvider: provider, avatarQuota: { store: memoryQuota(), limit: 3 } });
  assert.equal(dry.dryRun.wouldUseAvatar, true);
  assert.equal(calls.length, 0);
});

test('STANDARD_VIDEO is modelled separately from HeyGen (Runway adapter, opt-in)', async () => {
  const saved = process.env.TOPIC_STANDARD_VIDEO_PROVIDER;
  delete process.env.TOPIC_STANDARD_VIDEO_PROVIDER;
  try { assert.match(createRunwayStandardVideoProvider().available().reason, /TOPIC_STANDARD_VIDEO_PROVIDER/); }
  finally { if (saved !== undefined) process.env.TOPIC_STANDARD_VIDEO_PROVIDER = saved; }
  let creates = 0;
  const client = { textToVideo: { create: async () => { creates++; return { id: 'task_1' }; } }, tasks: { retrieve: async () => ({ status: 'SUCCEEDED', output: ['https://dnznrvs05pmza.cloudfront.net/x.mp4'] }) } };
  const runway = createRunwayStandardVideoProvider({ client, request: async () => mp4(), upload });
  const result = await produceContent({ ...renderInput, format: 'STANDARD_VIDEO' }, { ledger: memoryLedger(), imageProvider: null, standardVideoProvider: runway, sleep: noSleep, videoTiming: { pollIntervalMs: 0 } });
  assert.equal(result.producedFormat, 'STANDARD_VIDEO');
  assert.equal(result.assets[0].asset.provider, 'runway');
  assert.equal(creates, 1);
});

test('Postgres ledger + quota: a second process neither generates nor counts the same video twice', async () => {
  const db = await pgliteDatabase();
  try {
    const first = heygen([created, status('completed', { video_url: 'https://files.heygen.ai/v.mp4' }), mp4]);
    await runVideoJob(input, { ledger: postgresLedger(db), provider: first.provider, quota: { store: postgresQuota(db), limit: 3 }, sleep: noSleep, pollIntervalMs: 0 });
    const second = heygen([]);
    const again = await runVideoJob(input, { ledger: postgresLedger(db), provider: second.provider, quota: { store: postgresQuota(db), limit: 3 }, sleep: noSleep });
    assert.equal(again.reused, true);
    assert.equal(second.calls.length, 0);
    const usage = (await db.query('SELECT status, count(*)::int AS n FROM provider_usage GROUP BY status')).rows;
    assert.deepEqual(usage, [{ status: 'succeeded', n: 1 }]);
  } finally { await db.close(); }
});
