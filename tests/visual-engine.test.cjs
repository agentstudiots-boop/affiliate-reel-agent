const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = '../.test-build/lib/visual';
const { planCarousel, MAX_GENERATED_PER_CAROUSEL } = require(`${B}/carousel/planner`);
const { renderCarouselPlan, carouselSourceFrom } = require(`${B}/renderers`);
const { produceContent } = require(`${B}/engine`);
const { memoryLedger, postgresLedger } = require(`${B}/ledger`);
const { runImageJob } = require(`${B}/image-job`);
const { createStyleBrief } = require(`${B}/style`);
const { ImageGenerationError } = require(`${B}/types`);
const { createReplicateBriefProvider } = require(`${B}/providers/replicate`);
const { setEventSink, recentEvents, clearRecentEvents } = require('../.test-build/lib/observability/events');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { pngFixture } = require('./helpers/png-fixture.cjs');

setEventSink(() => {});
const noSleep = async () => {};
const style = createStyleBrief({ topicId: 'tp_1', trendType: 'PRACTICAL_LIFE' });
const points = n => Array.from({ length: n }, (_, i) => ({ headline: `Punkt ${i + 1}`, text: `Erklärung ${i + 1}` }));
const copy = (n = 3) => ({ title: 'Beschlagene Fenster', hook: 'Beschlagene Fenster? So geht es besser', problem: 'Kondenswasser am Morgen', coreMessage: 'Lüften und Heizen im Gleichgewicht',
  body: 'Text', caption: 'Caption', cta: 'Speichern für später', points: points(n), imageMotif: 'Beschlagenes Fenster im Herbst', videoScript: 'Skript' });
const input = (over = {}) => ({ contentId: 'tc_1', copy: copy(), style, dryRun: false, visualPotential: 80, ...over });
const asset = n => ({ kind: 'image', url: `https://x.public.blob.vercel-storage.com/generated/topics/tc_1/${String(n).padStart(64, '0')}.png`, sha256: String(n).padStart(64, '0'), mediaType: 'image/png', provider: 'fake', providerJobId: `job${n}` });

// Fake provider: records every generate() call; failures can be scripted per role.
function fakeProvider(script = {}) {
  const calls = [];
  let n = 0;
  return { calls, name: 'fake', model: 'fake-1', available: () => ({ ok: true }),
    async generate(brief, options) {
      calls.push({ role: options.role, resume: options.resumeJobId ?? null });
      const plan = script[options.role];
      const step = Array.isArray(plan) ? plan.shift() : plan;
      if (step instanceof Error) throw step;
      if (options.onJobCreated) await options.onJobCreated(`job-${options.role}`);
      return asset(++n);
    } };
}

test('carousel plans with 3, 5 and 7 slides follow the content, not a fixed number', () => {
  const p3 = planCarousel(carouselSourceFrom(input({ copy: copy(0) }), { imageProvider: fakeProvider() }), style);
  const p5 = planCarousel(carouselSourceFrom(input({ copy: copy(2) }), { imageProvider: fakeProvider() }), style);
  const p7 = planCarousel(carouselSourceFrom(input({ copy: copy(6) }), { imageProvider: fakeProvider() }), style);
  assert.deepEqual([p3.slide_count, p5.slide_count, p7.slide_count], [3, 5, 7]);
  assert.equal(p5.slides[0].purpose, 'hook');
  assert.equal(p5.slides.at(-1).purpose, 'cta');
  assert.equal(p5.slides.at(-1).cta, 'Speichern für später');
  for (const slide of p7.slides) for (const key of ['slide_number', 'purpose', 'headline', 'supporting_text', 'visual_type', 'visual_brief', 'requires_generated_image']) assert.ok(key in slide, key);
  const requested = planCarousel(carouselSourceFrom(input({ copy: copy(6) }), { imageProvider: fakeProvider() }), style, 4);
  assert.equal(requested.slide_count, 4);
  assert.match(requested.count_reason, /Betreiberwunsch/);
});

test('only some slides need Replicate: exactly as many jobs as generated slides, capped, shared style', async () => {
  const provider = fakeProvider();
  const plan = planCarousel(carouselSourceFrom(input({ copy: copy(2) }), { imageProvider: provider }), style);
  assert.equal(plan.slide_count, 5);
  const generated = plan.slides.filter(slide => slide.requires_generated_image);
  assert.ok(generated.length >= 1 && generated.length < plan.slide_count && generated.length <= MAX_GENERATED_PER_CAROUSEL);
  const outcome = await renderCarouselPlan(plan, input({ copy: copy(2) }), { ledger: memoryLedger(), imageProvider: provider, sleep: noSleep });
  assert.equal(provider.calls.length, generated.length);
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.assets.length, 5);
  // Style consistency: every generated brief and every text graphic uses the one style brief.
  for (const slide of generated) assert.match(slide.visual_brief, new RegExp(style.image_style.slice(0, 30)));
  for (const item of outcome.assets.filter(entry => entry.asset.kind === 'text_graphic')) assert.match(item.asset.svg, new RegExp(style.palette.background));
});

test('one failing slide: only that slide is retried, others are never rebuilt, no duplicate jobs', async () => {
  const ledger = memoryLedger();
  const provider = fakeProvider({ 'slide-2': [new ImageGenerationError('rate_limited', true, null, 429), new ImageGenerationError('provider_error', true, null, 503), new ImageGenerationError('provider_error', true, null, 503)] });
  const plan = planCarousel(carouselSourceFrom(input({ copy: copy(3) }), { imageProvider: provider }), style);
  const first = await renderCarouselPlan(plan, input(), { ledger, imageProvider: provider, sleep: noSleep });
  assert.equal(first.status, 'degraded');
  const failed = first.carousel.slideResults.find(result => result.status === 'degraded');
  assert.equal(failed.slide_number, 2);
  assert.equal(failed.asset.kind, 'text_graphic');
  assert.equal(provider.calls.filter(call => call.role === 'slide-2').length, 3);
  const before = provider.calls.length;
  // Retry the carousel later: finished slides are reused, slide 2 has exhausted its attempts → no new paid jobs.
  const again = await renderCarouselPlan(plan, input(), { ledger, imageProvider: provider, sleep: noSleep });
  assert.equal(provider.calls.length, before);
  assert.ok(again.carousel.slideResults.filter(result => result.reused).length >= 1);
});

test('a slide that failed once with a retryable error is retried alone on the next run and then succeeds', async () => {
  const ledger = memoryLedger();
  const provider = fakeProvider({ 'slide-1': [new ImageGenerationError('rate_limited', true, null, 429)] });
  const plan = planCarousel(carouselSourceFrom(input({ copy: copy(3) }), { imageProvider: provider }), style);
  await renderCarouselPlan(plan, input(), { ledger, imageProvider: provider, sleep: noSleep, maxAttempts: 1 });
  const roles = () => provider.calls.map(call => call.role);
  const firstRun = roles().length;
  await renderCarouselPlan(plan, input(), { ledger, imageProvider: provider, sleep: noSleep, maxAttempts: 2 }, [1]);
  assert.deepEqual(roles().slice(firstRun), ['slide-1']);
});

test('a provider job that timed out while polling is resumed by id, never re-created', async () => {
  const ledger = memoryLedger();
  const provider = fakeProvider({ 'main-image': [new ImageGenerationError('timeout', true, 'pred123456789abc')] });
  const result = await runImageJob({ prompt: 'x', aspectRatio: '4:5', styleKey: 'k' }, { contentId: 'tc_1', role: 'main-image', ledger, provider, sleep: noSleep });
  assert.equal(result.ok, true);
  assert.deepEqual(provider.calls.map(call => call.resume), [null, 'pred123456789abc']);
  // Unknown POST outcome (timeout without id) is never retried automatically.
  const unknown = fakeProvider({ 'main-image': [new ImageGenerationError('timeout', false, null)] });
  const blocked = await runImageJob({ prompt: 'y', aspectRatio: '4:5', styleKey: 'k' }, { contentId: 'tc_2', role: 'main-image', ledger: memoryLedger(), provider: unknown, sleep: noSleep });
  assert.equal(blocked.ok, false);
  assert.equal(unknown.calls.length, 1);
});

test('the Postgres ledger enforces the same idempotency across processes', async () => {
  const db = await pgliteDatabase();
  try {
    const ledger = postgresLedger(db);
    const provider = fakeProvider();
    const brief = { prompt: 'p', aspectRatio: '4:5', styleKey: 'k' };
    const a = await runImageJob(brief, { contentId: 'tc_9', role: 'slide-1', ledger, provider, sleep: noSleep });
    const b = await runImageJob(brief, { contentId: 'tc_9', role: 'slide-1', ledger: postgresLedger(db), provider, sleep: noSleep });
    assert.equal(provider.calls.length, 1);
    assert.equal(b.reused, true);
    assert.equal(a.asset.url, b.asset.url);
    const row = (await db.query('SELECT status,provider_job_id FROM visual_jobs')).rows[0];
    assert.deepEqual(row, { status: 'succeeded', provider_job_id: 'job-slide-1' });
  } finally { await db.close(); }
});

const png = () => pngFixture();
const replicate = (responses, over = {}) => {
  const calls = [];
  const request = async (url, init = {}) => { calls.push({ url: String(url), method: init.method || 'GET' }); const next = responses.shift(); return typeof next === 'function' ? next(init) : next; };
  const provider = createReplicateBriefProvider({ token: 'r8_test', request, pollIntervalMs: 1, upload: async path => ({ url: `https://abc.public.blob.vercel-storage.com/${path}` }), ...over });
  return { provider, calls };
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const brief = { prompt: 'Fenster', aspectRatio: '4:5', styleKey: 'k' };
const opts = { contentId: 'tc_1', role: 'slide-1' };

test('Replicate success: one POST, polling the same prediction, PNG download, blob upload', async () => {
  const { provider, calls } = replicate([json({ id: 'abcdef123456', status: 'processing' }), json({ id: 'abcdef123456', status: 'succeeded', output: 'https://replicate.delivery/x/out.png' }),
    () => new Response(png(), { headers: { 'content-type': 'image/png' } })]);
  const result = await provider.generate(brief, opts);
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
  assert.match(result.url, /generated\/topics\/tc_1\/[a-f0-9]{64}\.png$/);
  assert.equal(result.providerJobId, 'abcdef123456');
});

test('Replicate 429 at creation is retryable (nothing accepted); auth error is not', async () => {
  await assert.rejects(replicate([json({ detail: 'throttled' }, 429)]).provider.generate(brief, opts), error => error.category === 'rate_limited' && error.retryable && error.httpStatus === 429);
  await assert.rejects(replicate([json({ detail: 'bad token r8_test' }, 401)]).provider.generate(brief, opts), error => error.category === 'auth' && !error.retryable && !/r8_test/.test(error.message));
});

test('Replicate provider error during polling keeps the prediction id for a resume; a failed prediction is final', async () => {
  await assert.rejects(replicate([json({ id: 'abcdef123456', status: 'processing' }), json({}, 502)]).provider.generate(brief, opts),
    error => error.category === 'provider_error' && error.retryable && error.providerJobId === 'abcdef123456');
  await assert.rejects(replicate([json({ id: 'abcdef123456', status: 'failed' })]).provider.generate(brief, opts), error => error.category === 'generation_failed' && !error.retryable);
});

test('Replicate timeout: before a prediction id → not retryable; while polling → resumable', async () => {
  // Like real fetch: never answers, but rejects when the request signal aborts.
  const hanging = init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  await assert.rejects(replicate([hanging], { timeoutMs: 20 }).provider.generate(brief, opts), error => error.category === 'timeout' && !error.retryable);
  await assert.rejects(replicate([json({ id: 'abcdef123456', status: 'processing' }), hanging], { timeoutMs: 30 }).provider.generate(brief, opts),
    error => error.category === 'timeout' && error.retryable && error.providerJobId === 'abcdef123456');
});

test('Replicate invalid asset (non-PNG, foreign host) is rejected', async () => {
  await assert.rejects(replicate([json({ id: 'abcdef123456', status: 'succeeded', output: 'https://evil.example/out.png' })]).provider.generate(brief, opts), error => error.category === 'invalid_asset');
  await assert.rejects(replicate([json({ id: 'abcdef123456', status: 'succeeded', output: 'https://replicate.delivery/x.png' }), () => new Response('<html>', { headers: { 'content-type': 'text/html' } })]).provider.generate(brief, opts),
    error => error.category === 'invalid_asset');
});

test('retry then final failure: bounded attempts, then the pipeline degrades instead of blocking', async () => {
  clearRecentEvents();
  const provider = fakeProvider({ 'main-image': [new ImageGenerationError('rate_limited', true), new ImageGenerationError('rate_limited', true), new ImageGenerationError('rate_limited', true)] });
  const result = await produceContent({ ...input(), format: 'SINGLE_IMAGE' }, { ledger: memoryLedger(), imageProvider: provider, sleep: noSleep });
  assert.equal(provider.calls.length, 3);
  assert.equal(result.producedFormat, 'TEXT');
  assert.equal(result.status, 'degraded');
  assert.deepEqual(result.fallbacks.map(item => `${item.from}->${item.to}`), ['SINGLE_IMAGE->TEXT']);
  assert.ok(recentEvents('image_generation_failed').length >= 3);
});

test('Replicate down: text and carousel (text graphics) keep working', async () => {
  const down = { name: 'replicate', model: 'm', available: () => ({ ok: false, reason: 'REPLICATE_API_TOKEN fehlt' }), generate: async () => { throw new Error('must not be called'); } };
  const carousel = await produceContent({ ...input(), format: 'CAROUSEL' }, { ledger: memoryLedger(), imageProvider: down, sleep: noSleep });
  assert.equal(carousel.producedFormat, 'CAROUSEL');
  assert.ok(carousel.assets.every(item => item.asset.kind === 'text_graphic'));
  const image = await produceContent({ ...input(), format: 'SINGLE_IMAGE' }, { ledger: memoryLedger(), imageProvider: down, sleep: noSleep });
  assert.equal(image.producedFormat, 'TEXT');
  assert.match(image.errors[0], /REPLICATE_API_TOKEN fehlt/);
});

test('video formats without a renderer degrade to carousel in phase 2; excluded formats are skipped', async () => {
  const result = await produceContent({ ...input(), format: 'AVATAR_VIDEO', exclude: ['STANDARD_VIDEO'] }, { ledger: memoryLedger(), imageProvider: fakeProvider(), sleep: noSleep });
  assert.equal(result.producedFormat, 'CAROUSEL');
  assert.ok(!result.fallbacks.some(item => item.to === 'STANDARD_VIDEO'));
});

test('dry run: plans slides and counts images without any provider call', async () => {
  const provider = fakeProvider();
  const result = await produceContent({ ...input({ dryRun: true }), format: 'CAROUSEL' }, { ledger: memoryLedger(), imageProvider: provider });
  assert.equal(result.status, 'dry_run');
  assert.equal(provider.calls.length, 0);
  assert.equal(result.carousel.slide_count, 6);
  assert.equal(result.dryRun.wouldGenerateImages, result.carousel.generated_images);
  assert.match(result.dryRun.notes[0], /6 Slides geplant/);
});
