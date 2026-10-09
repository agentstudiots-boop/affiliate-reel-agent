const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadRoute = require('./helpers/load-route.cjs');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { approveContent } = require('./helpers/approve-content.cjs');
const { withEnv } = require('./helpers/live-env.cjs');
const L = '../.test-build/lib';
const { memoryRepository } = require(`${L}/memory/repository`);
const { publicationRepository, PublicationConflictError } = require(`${L}/meta/publication-gate`);
const { runContentJob } = require(`${L}/content/orchestrator`);
const { opportunitySchema } = require(`${L}/content/schema`);
const { imageSpecFor, identityClassOf, imageSpecErrors, topicImageSpec, applyLessons } = require(`${L}/content/image-quality/spec`);
const { buildProviderPrompt, validateProviderPrompt, validatedPrompt } = require(`${L}/content/image-quality/prompt`);
const { decide, identityOf, technicalCheck, checkGeneratedImage } = require(`${L}/content/image-quality/gate`);
const { produceCheckedVisual, resumeUnclearVisual, generationBudget } = require(`${L}/content/image-quality/production`);
const { feedbackFor, reviseSpecFromFeedback } = require(`${L}/content/image-quality/feedback`);
const { lessonsFor, recordExperience } = require(`${L}/content/image-quality/learning`);
const { reviseStructured } = require(`${L}/content/structured-revision`);
const { OriginalVisualError } = require(`${L}/content/providers/openai-image`);
const { handleImageQualityReply } = require(`${L}/whatsapp/image-quality-reply`);
const { produceContent } = require(`${L}/visual/engine`);
const { memoryLedger } = require(`${L}/visual/ledger`);
const { createStyleBrief } = require(`${L}/visual/style`);
const { setEventSink } = require(`${L}/observability/events`);

setEventSink(() => {});
const OPERATOR = '491234';
const MODEL = 'black-forest-labs/flux-1.1-pro';
const opportunity = (name, asin = 'B0PILZ0001', extra = {}) => opportunitySchema.parse({ product: { productVerifiedAt: '2026-10-01T08:00:00.000Z', productVerifiedName: name, name, asin,
  sourceUrl: `https://www.amazon.de/dp/${asin}`, affiliateUrl: `https://www.amazon.de/dp/${asin}?tag=alltaeglichle-21`, price: '', targetGroup: 'Haushalte', benefits: 'Herbstliche Dekoration', notes: '' },
  useCase: 'Herbstliche Dekoration auf dem Sideboard im Wohnzimmer.', category: 'home_living', targetPlatform: 'facebook', budget: 'low', ...extra });
const plan = async (name, asin) => runContentJob(opportunity(name, asin), { allowedFormats: ['image'] });
// Observations as the vision model would report them; the decision is made by the real gate code.
const seen = (over = {}) => ({ depicted_main_subject: 'dekorative Pilze auf einem Sideboard', primary_object_visible: 'yes', primary_object_prominence: 'dominant', forbidden_objects_visible: [],
  product_category_match: 'yes', other_product_instead: null, visual_defects: [], severe_defects: false, text_or_logos_visible: false, unrealistic_product_use: [],
  concept_understandable: 'yes', confidence: 0.9, ...over });
const verdict = (spec, over) => ({ ...decide(spec, seen(over)), checked: { technical: true, vision: true }, model: 'test', identity: identityOf(spec) });
const DOG = { depicted_main_subject: 'ein Hund auf dem Sofa', primary_object_visible: 'no', primary_object_prominence: 'absent', forbidden_objects_visible: ['Hund'] };

async function world(t, name = 'Deko Pilze 6 Stück Herbst', asin = 'B0PILZ0001') {
  const db = await pgliteDatabase(); t.after(() => db.close());
  const restore = withEnv({ WHATSAPP_APPROVER_WA_ID: OPERATOR, IMAGE_MAX_GENERATIONS_PER_JOB: undefined, IMAGE_DAILY_GENERATION_LIMIT: undefined, IMAGE_QUALITY_GATE: undefined });
  t.after(restore);
  const memory = memoryRepository(db), repo = publicationRepository(db);
  const newJob = async (productName = name, productAsin = asin) => {
    const id = crypto.randomUUID(); const opp = opportunity(productName, productAsin);
    await memory.claim(id, opp, 'reference'); await runContentJob(opp, { id, onUpdate: memory.save, loadLearning: memory.learn });
    return approveContent(db, memory, id);
  };
  const job = await newJob();
  const renders = [], sleeps = [];
  let failures = [];
  const provider = { name: 'replicate', resumes: 0,
    async render(current, options = {}) {
      renders.push(options.prompt);
      const next = failures.shift();
      if (next) { if (next.accepted) await options.onPrediction?.('abcdefghijklmnop'); throw next.error; }
      await options.onPrediction?.(`pred${String(renders.length).padStart(12, '0')}`);
      const sha = String(renders.length).repeat(64).slice(0, 64).replace(/[^a-f0-9]/g, 'a');
      return { url: `https://x.public.blob.vercel-storage.com/generated/facebook/${current.id}/${sha}.png`, provider: 'replicate', mediaType: 'image', model: MODEL, sha256: sha,
        generatedAt: new Date().toISOString(), usage: { predictionId: `pred${String(renders.length).padStart(12, '0')}`, predictTimeSeconds: 4 } };
    },
    async resume(predictionId, current) { this.resumes++; return { url: `https://x.public.blob.vercel-storage.com/generated/facebook/${current.id}/${'b'.repeat(64)}.png`, provider: 'replicate',
      mediaType: 'image', model: MODEL, sha256: 'b'.repeat(64), usage: { predictionId } }; } };
  const gates = [];
  const gate = queue => async ({ spec }) => { gates.push(spec); const over = queue.length > 1 ? queue.shift() : queue[0]; return over instanceof Error ? verdictUncertain(spec) : verdict(spec, over); };
  const verdictUncertain = spec => ({ approved: false, uncertain: true, hard_failures: [], soft_failures: ['Automatische Bildprüfung nicht möglich (router_failed).'], retry_recommended: false,
    findings: { primaryMissing: false, forbiddenSeen: [], wrongProduct: false, defects: false, composition: false, technical: false }, checked: { technical: true, vision: false }, model: 'test', identity: identityOf(spec) });
  const deps = queue => ({ db, provider, model: MODEL, gate: gate(queue), sleep: async ms => { sleeps.push(ms); } });
  const hash = current => repo.contentHashOf(current);
  const fail = list => { failures = list; };
  return { db, repo, memory, job, newJob, renders, sleeps, gates, deps, hash, provider, fail };
}

test('A + C: the quality gate rejects a dog picture for mushroom decoration and accepts a fitting one', async t => {
  const w = await world(t);
  const spec = imageSpecFor(w.job);
  assert.equal(spec.primary_object, 'dekorative Pilze (Dekoration)');
  const dog = verdict(spec, DOG);
  assert.equal(dog.approved, false);
  assert.match(dog.hard_failures[0], /Pflichtmotiv „dekorative Pilze \(Dekoration\)“ nicht erkennbar \(stattdessen: ein Hund/);
  assert.ok(dog.hard_failures.some(item => /Hund/.test(item)));
  assert.equal(dog.retry_recommended, true);
  const good = verdict(spec, {});
  assert.equal(good.approved, true); assert.deepEqual(good.hard_failures, []);
  const outcome = await produceCheckedVisual(w.job, w.hash(w.job), w.deps([{}]));
  assert.equal(outcome.status, 'passed'); assert.equal(w.renders.length, 1);
  const attempt = (await w.db.query('SELECT status,quality_status,prediction_id,cost FROM image_generation_attempts WHERE job_id=$1', [w.job.id])).rows[0];
  assert.equal(attempt.status, 'generated'); assert.equal(attempt.quality_status, 'passed'); assert.match(attempt.prediction_id, /^pred/);
  assert.equal(attempt.cost.estimatedUsd, 0.04);
});

test('B: the mandatory motif reaches the provider prompt; a faulty prompt is corrected first or never sent', async t => {
  const w = await world(t);
  const spec = imageSpecFor(w.job);
  const prompt = buildProviderPrompt(spec, w.job);
  assert.ok(validateProviderPrompt(spec, prompt).ok);
  assert.match(prompt.split('\n')[0], /MAIN SUBJECT .*dekorative Pilze/);
  // A builder that drops the subject (as the old prompt assembly could): the faulty text never reaches the provider.
  const lost = 'Photorealistic editorial lifestyle photo, vertical 4:5. A dog lies on a cozy sofa next to a window.';
  assert.ok(!validateProviderPrompt(spec, lost).ok);
  const outcome = await produceCheckedVisual(w.job, w.hash(w.job), { ...w.deps([{}]), buildPrompt: () => lost });
  assert.equal(outcome.status, 'passed');
  assert.match(w.renders[0], /^MAIN SUBJECT \(dominant, in the foreground\): dekorative Pilze/);
  // An excluded object only mentioned as an exclusion is removed: FLUX has no negative prompt.
  const fixed = validatedPrompt({ ...spec, forbidden_objects: ['hund'] }, `${prompt}\nKein Hund im Bild.`);
  assert.ok(fixed.ok); assert.doesNotMatch(fixed.prompt, /hund/i);
  // A contradictory briefing (main subject excluded) stops before any provider call.
  const before = w.renders.length;
  const job = structuredClone(w.job);
  job.content.imageSpec = { ...spec, forbidden_objects: ['pilze'] };
  assert.match(imageSpecErrors(job.content.imageSpec)[0], /widersprüchlich/);
  const stopped = await produceCheckedVisual(job, w.hash(w.job), w.deps([{}]));
  assert.equal(stopped.status, 'stopped'); assert.equal(stopped.reason, 'briefing_invalid'); assert.equal(w.renders.length, before);
});

test('D: a picture of another product is rejected', async t => {
  const w = await world(t);
  const result = verdict(imageSpecFor(w.job), { product_category_match: 'no', other_product_instead: 'Kaffeemaschine', depicted_main_subject: 'eine Kaffeemaschine' });
  assert.equal(result.approved, false);
  assert.match(result.hard_failures.join(' '), /Falsches Produkt: Kaffeemaschine/);
});

test('E: an atmosphere change keeps the mushroom decoration as main subject in briefing and prompt', async t => {
  const w = await world(t);
  const draft = await plan('Deko Pilze 6 Stück Herbst');
  const next = reviseStructured(draft, { intent: 'revise_image', confidence: 0.98, keep_product: true, keep_content_id: true, image_instruction: 'Mach das Bild gemütlicher',
    text_instruction: null, product_instruction: null, requires_new_generation: true, requires_new_approval: true, publish_requested: false, product_context_matches: true, text_operations: [] });
  const spec = imageSpecFor(next);
  assert.equal(spec.primary_object, 'dekorative Pilze (Dekoration)');
  assert.deepEqual(spec.change_instructions, ['Mach das Bild gemütlicher']);
  assert.equal(next.content.slides[0].visual, draft.content.slides[0].visual, 'the scene stays; only the atmosphere changes');
  const prompt = buildProviderPrompt(spec, next);
  assert.match(prompt, /MAIN SUBJECT.*dekorative Pilze/); assert.match(prompt, /gemütlicher/);
  // Removing an object becomes an exclusion; a complete re-do keeps the main subject.
  const noDog = reviseStructured(draft, { ...instructionOf('Entferne den Hund') });
  assert.deepEqual(imageSpecFor(noDog).forbidden_objects, ['hund']);
  assert.doesNotMatch(buildProviderPrompt(imageSpecFor(noDog), noDog), /hund/i);
  const other = reviseStructured(draft, { ...instructionOf('Mach ein komplett anderes Bild') });
  assert.match(other.content.slides[0].visual, /^dekorative Pilze \(Dekoration\) als Hauptmotiv im Vordergrund/);
  assert.equal(w.renders.length, 0, 'a revision never calls a provider');
});
const instructionOf = wish => ({ intent: 'revise_image', confidence: 0.98, keep_product: true, keep_content_id: true, image_instruction: wish, text_instruction: null, product_instruction: null,
  requires_new_generation: true, requires_new_approval: true, publish_requested: false, product_context_matches: true, text_operations: [] });

test('F + I (budget): two failed generations stop the job; no third automatic generation; the daily cap applies', async t => {
  const w = await world(t);
  const first = await produceCheckedVisual(w.job, w.hash(w.job), w.deps([DOG]));
  assert.equal(first.status, 'stopped'); assert.equal(first.reason, 'quality_failed');
  assert.equal(w.renders.length, 2); assert.equal(first.used, 2); assert.equal(first.allowed, 2);
  const again = await produceCheckedVisual(w.job, w.hash(w.job), w.deps([{}]));
  assert.equal(again.reason, 'budget_exhausted'); assert.equal(w.renders.length, 2);
  // An explicit operator decision allows exactly one more attempt.
  await w.db.query("INSERT INTO image_generation_grants(message_id,job_id,kind) VALUES('wamid.grant',$1,'new_attempt')", [w.job.id]);
  assert.deepEqual(await generationBudget(w.db, w.job).then(b => [b.used, b.allowed]), [2, 3]);
  const granted = await produceCheckedVisual(w.job, w.hash(w.job), w.deps([DOG]));
  assert.equal(granted.reason, 'quality_failed'); assert.equal(w.renders.length, 3);
  // Daily cap over all jobs.
  const restore = withEnv({ IMAGE_DAILY_GENERATION_LIMIT: '3' }); t.after(restore);
  const other = await w.newJob('Pilzlampe LED Tischleuchte aus Holz', 'B0PILZ0002');
  const capped = await produceCheckedVisual(other, w.hash(other), w.deps([{}]));
  assert.equal(capped.reason, 'daily_budget_exhausted'); assert.equal(w.renders.length, 3);
});

test('G: parallel identical runs and a redelivered reply create no duplicate paid job', async t => {
  const w = await world(t);
  const results = await Promise.all([produceCheckedVisual(w.job, w.hash(w.job), w.deps([{}])), produceCheckedVisual(w.job, w.hash(w.job), w.deps([{}]))]);
  assert.deepEqual(results.map(item => item.status).sort(), ['passed', 'stopped']);
  assert.equal(results.find(item => item.status === 'stopped').reason, 'concurrent');
  assert.equal(w.renders.length, 1);
  await w.db.query("INSERT INTO image_quality_notices(message_id,job_id,reason) VALUES('wamid.notice',$1,'quality_failed')", [w.job.id]);
  const calls = [], sent = [];
  const reply = () => handleImageQualityReply({ id: 'wamid.reply', from: OPERATOR, body: 'Neues Bild: Pilze größer im Vordergrund', replyToMessageId: 'wamid.notice', payload: {} },
    { database: () => w.db, request: async (jobId, mode) => { calls.push([jobId, mode]); }, send: async text => { sent.push(text); return 'wamid.x'; } });
  assert.deepEqual(await Promise.all([reply(), reply()]), [true, true]);
  assert.deepEqual(calls, [[w.job.id, 'continue']]);
  assert.equal((await w.db.query('SELECT count(*)::int AS n FROM image_generation_grants')).rows[0].n, 1);
});

test('H: HTTP 429 with a provider retry hint is retried with exponential backoff and costs nothing; without a hint the claim is given back', async t => {
  const w = await world(t);
  const throttled = () => new OriginalVisualError('Replicate hat die Bildanfrage abgelehnt (Rate Limit).', true, 'rate_limit', 3);
  w.fail([{ error: throttled() }, { error: throttled() }]);
  const outcome = await produceCheckedVisual(w.job, w.hash(w.job), w.deps([{}]));
  assert.equal(outcome.status, 'passed'); assert.equal(w.renders.length, 3);
  assert.deepEqual(w.sleeps, [3000, 4000]);
  assert.equal((await generationBudget(w.db, w.job)).used, 1, 'refused requests are not paid attempts');
  const other = await w.newJob('Pilzlampe LED Tischleuchte aus Holz', 'B0PILZ0002');
  w.fail([{ error: new OriginalVisualError('Replicate hat die Bildanfrage abgelehnt (Rate Limit).', true, 'rate_limit', null) }]);
  await assert.rejects(produceCheckedVisual(other, w.hash(other), w.deps([{}])), /Rate Limit/);
  assert.equal((await w.db.query("SELECT status FROM image_generation_attempts WHERE job_id=$1", [other.id])).rows[0].status, 'rejected_by_provider');
  assert.equal((await generationBudget(w.db, other)).used, 0);
});

test('I: an unclear provider result is never regenerated blindly; the accepted job is looked up instead', async t => {
  const w = await world(t);
  w.fail([{ accepted: true, error: new OriginalVisualError('Replicate-Bildversuch fehlgeschlagen oder Ergebnis unklar.', false, 'timeout') }]);
  const unclear = await produceCheckedVisual(w.job, w.hash(w.job), w.deps([{}]));
  assert.equal(unclear.status, 'stopped'); assert.equal(unclear.reason, 'provider_unclear'); assert.equal(w.renders.length, 1);
  const row = (await w.db.query('SELECT status,prediction_id FROM image_generation_attempts WHERE job_id=$1', [w.job.id])).rows[0];
  assert.deepEqual(row, { status: 'unclear', prediction_id: 'abcdefghijklmnop' });
  const resumed = await resumeUnclearVisual(w.job, w.hash(w.job), w.deps([{}]));
  assert.equal(resumed.status, 'passed'); assert.equal(w.provider.resumes, 1); assert.equal(w.renders.length, 1, 'no second paid generation');
});

test('J + H(identity) + O: through the real request path the operator approval stays mandatory; stops are reported on the right job', async t => {
  const w = await world(t);
  const sent = [];
  const request = loadRoute('lib/meta/request-publication.ts', { '../memory/db': { getDatabase: () => w.db },
    '../whatsapp/client': { sendWhatsAppText: async text => { sent.push(text); return `wamid.out.${sent.length}`; }, whatsappApprovalReady: () => true, WhatsAppRejectedError: class extends Error {} },
    './publication-gate': { publicationRepository: () => w.repo, PublicationConflictError },
    '../content/image-provider': { getOriginalVisualProvider: () => w.provider, imageProviderStatus: () => ({ model: MODEL, reason: '' }) } });
  await w.db.query("INSERT INTO whatsapp_events(message_id,wa_id,body,payload) VALUES('window',$1,'Hallo','{}')", [OPERATOR]);
  // Without content approval nothing is generated.
  const unapproved = await plan('Deko Pilze 6 Stück Herbst', 'B0PILZ0003');
  await w.memory.claim(unapproved.id, unapproved.opportunity, 'reference').catch(() => {});
  await assert.rejects(request.requestFacebookApproval(unapproved.id, 'new', { provider: w.provider, gate: async () => { throw new Error('unexpected'); } }));
  // A passed check leads only to the operator's publication approval, with honest statements about check and identity.
  const result = await request.requestFacebookApproval(w.job.id, 'new', { provider: w.provider, gate: async ({ spec }) => verdict(spec, {}) });
  assert.equal(result.approvalSent, true); assert.equal(result.publication.status, 'pending');
  assert.match(sent.at(-1), /Automatische Bildprüfung: bestanden.*ersetzt deine Prüfung nicht/s);
  assert.match(sent.at(-1), /Produktidentität: nicht automatisch prüfbar/);
  assert.equal((await w.db.query('SELECT count(*)::int AS n FROM publications')).rows[0].n, 0, 'nothing is published by the image step');
  // A stopped job sends one notice and binds replies to exactly this job.
  const second = await w.newJob('Pilzlampe LED Tischleuchte aus Holz', 'B0PILZ0002');
  await assert.rejects(request.requestFacebookApproval(second.id, 'new', { provider: w.provider, gate: async ({ spec }) => verdict(spec, DOG), sleep: async () => {} }),
    error => request.alreadyNotified(error));
  assert.match(sent.at(-1), /Bildauftrag „Pilzlampe.*angehalten.*Pflichtmotiv „Pilz-Leuchte aus Holz“ nicht erkennbar.*2 von 2.*„Neues Bild“/s);
  const notice = (await w.db.query('SELECT job_id,reason FROM image_quality_notices')).rows;
  assert.deepEqual(notice, [{ job_id: second.id, reason: 'quality_failed' }]);
  // "Neues Bild" on that notice: one more attempt for exactly that job, still checked.
  await handleImageQualityReply({ id: 'wamid.new', from: OPERATOR, body: 'Neues Bild: Pilzlampe größer im Vordergrund', replyToMessageId: sent.length && `wamid.out.${sent.length}`, payload: {} },
    { database: () => w.db, request: (jobId, mode) => request.requestFacebookApproval(jobId, mode, { provider: w.provider, gate: async ({ spec }) => verdict(spec, {}) }),
      send: async text => { sent.push(text); return `wamid.out.${sent.length}`; }, notified: request.alreadyNotified });
  assert.match(sent.at(-1), /Veröffentlichungsfreigabe für Facebook und Instagram/);
  const grant = (await w.db.query('SELECT job_id,change_instruction FROM image_generation_grants')).rows[0];
  assert.deepEqual(grant, { job_id: second.id, change_instruction: 'Pilzlampe größer im Vordergrund' });
  assert.match(w.renders.at(-1), /Pilzlampe größer im Vordergrund/);
});

test('M + N: an unreachable image and an uncertain vision result are never approved and never regenerated', async t => {
  assert.match((await technicalCheck('https://x.public.blob.vercel-storage.com/a.png', async () => new Response('', { status: 404 })))[0], /nicht abrufbar \(HTTP 404\)/);
  assert.match((await technicalCheck('https://x.public.blob.vercel-storage.com/a.png', async () => { throw new Error('dns'); }))[0], /nicht abrufbar/);
  let observed = 0;
  const unreachable = await checkGeneratedImage({ url: 'https://x.public.blob.vercel-storage.com/a.png', spec: topicImageSpec({ motif: 'Pilze im Wald', title: 'Pilzzeit' }) },
    { request: async () => new Response('', { status: 404 }), observe: async () => { observed++; return seen(); } });
  assert.equal(unreachable.approved, false); assert.equal(unreachable.retry_recommended, false); assert.equal(observed, 0);
  const png = require('./helpers/png-fixture.cjs');
  const image = async () => new Response(await pngOf(png, 1024, 1280), { headers: { 'content-type': 'image/png' } });
  const spec = topicImageSpec({ motif: 'Pilze im Wald', title: 'Pilzzeit' });
  for (const observe of [async () => { throw new Error('vision down'); }, async () => seen({ confidence: 0.3 }), async () => seen({ primary_object_visible: 'unclear' }), async () => ({ nonsense: true })]) {
    const result = await checkGeneratedImage({ url: 'https://x.public.blob.vercel-storage.com/a.png', spec }, { request: image, observe });
    assert.equal(result.approved, false); assert.equal(result.uncertain, true); assert.equal(result.retry_recommended, false);
  }
  const w = await world(t);
  const stopped = await produceCheckedVisual(w.job, w.hash(w.job), w.deps([new Error('uncertain')]));
  assert.equal(stopped.reason, 'quality_uncertain'); assert.equal(w.renders.length, 1);
});
async function pngOf(helper, width, height) {
  if (typeof helper === 'function') return helper(width, height);
  if (helper.pngFixture) return helper.pngFixture(width, height);
  return Object.values(helper)[0](width, height);
}

test('K: the topic pipeline uses the same gate and degrades instead of paying again', async () => {
  const asset = { kind: 'image', url: 'https://x.public.blob.vercel-storage.com/generated/topics/tc/main.png', sha256: 'a'.repeat(64), mediaType: 'image/png', provider: 'replicate' };
  const ledger = memoryLedger();
  let generations = 0;
  const imageProvider = { name: 'replicate', model: 'flux', available: () => ({ ok: true }), generate: async () => { generations++; return asset; } };
  const copy = { title: 'Pilzzeit', hook: 'Pilze', problem: 'p', coreMessage: 'c', body: 'b', caption: 'c', cta: 'c', points: [], imageMotif: 'Pilze im herbstlichen Wald', videoScript: '' };
  const request = { contentId: 'tc_pilz', copy, style: createStyleBrief({ topicId: 'tp_pilz', trendType: 'SEASONAL' }), dryRun: false, visualPotential: 0.8, format: 'SINGLE_IMAGE' };
  const rejected = await produceContent(request, { ledger, imageProvider, imageQuality: async () => ({ approved: false, reasons: ['Pflichtmotiv fehlt'] }) });
  assert.equal(rejected.producedFormat, 'TEXT'); assert.equal(generations, 1);
  assert.ok(rejected.fallbacks.some(item => item.reason === 'image_quality_rejected'));
  // The finished image is reused from the ledger: approving it costs no second generation.
  const accepted = await produceContent(request, { ledger, imageProvider, imageQuality: async () => ({ approved: true, reasons: [] }) });
  assert.equal(accepted.producedFormat, 'SINGLE_IMAGE'); assert.equal(generations, 1);
});

test('supplement A + B: different products of one category get different briefings; the main subject survives every stage', async t => {
  const lamp = await plan('Pilzlampe LED Tischleuchte aus Holz', 'B0PILZ0002');
  const figure = await plan('Keramik Pilz Dekofigur 3er Set', 'B0PILZ0004');
  const garden = await plan('Pilz Gartenstecker wetterfest Herbstdeko', 'B0PILZ0005');
  const specs = [lamp, figure, garden].map(job => imageSpecFor(job));
  assert.deepEqual(specs.map(spec => spec.product_type), ['Leuchte', 'Dekofigur', 'Gartenstecker']);
  assert.deepEqual(specs.map(spec => spec.primary_object), ['Pilz-Leuchte aus Holz', 'Pilz-Dekofigur aus Keramik', 'Pilz-Gartenstecker']);
  assert.match(specs[2].setting, /draußen im Garten/);
  assert.ok(specs[0].missing_information.includes('Lichtfarbe und Helligkeit nicht belegt'), 'no invented lamp properties');
  assert.equal(new Set(specs.map(spec => spec.composition)).size, 3);
  // Briefing → prompt → validation → gate: the same main subject everywhere.
  const w = await world(t, 'Pilzlampe LED Tischleuchte aus Holz', 'B0PILZ0002');
  await produceCheckedVisual(w.job, w.hash(w.job), w.deps([{}]));
  assert.match(w.renders[0], /MAIN SUBJECT.*Pilz-Leuchte aus Holz/);
  assert.equal(w.gates[0].primary_object, 'Pilz-Leuchte aus Holz');
});

test('supplement C + D: structured quality feedback reaches the briefing; a successful correction is stored separately', async t => {
  const w = await world(t);
  const outcome = await produceCheckedVisual(w.job, w.hash(w.job), w.deps([DOG, {}]));
  assert.equal(outcome.status, 'passed'); assert.equal(w.renders.length, 2);
  const [first] = (await w.db.query('SELECT quality FROM image_generation_attempts WHERE job_id=$1 ORDER BY attempt_no', [w.job.id])).rows;
  const feedback = first.quality.feedback;
  const missing = feedback.find(item => item.code === 'primary_missing');
  assert.equal(missing.violated_requirement, 'primary_object_required');
  assert.ok(['generation', 'briefing'].includes(missing.cause)); assert.ok(['likely', 'uncertain'].includes(missing.certainty));
  assert.match(missing.correction, /dominant|größtes/); assert.ok(missing.keep.some(item => /Hauptmotiv: dekorative Pilze/.test(item)));
  assert.ok(feedback.some(item => item.code === 'forbidden_object' && item.object === 'hund'));
  // The creative briefing applied exactly that feedback to the second attempt.
  assert.match(w.renders[1], /largest, sharpest object/); assert.match(w.gates[1].composition, /^Nahaufnahme: dekorative Pilze/);
  assert.ok(w.gates[1].forbidden_objects.includes('hund')); assert.doesNotMatch(w.renders[1], /hund/i);
  const experiences = (await w.db.query('SELECT attempt_no,outcome,correction_result,product_type,generations FROM image_quality_experiences WHERE job_id=$1 ORDER BY attempt_no', [w.job.id])).rows;
  assert.deepEqual(experiences, [{ attempt_no: 1, outcome: 'failed', correction_result: null, product_type: 'Dekoration', generations: 1 },
    { attempt_no: 2, outcome: 'passed', correction_result: 'success', product_type: 'Dekoration', generations: 2 }]);
});

test('supplement E + F + G: confirmed experience shapes a similar new briefing; irrelevant and uncertain experience does not', async t => {
  const w = await world(t);
  const spec = imageSpecFor(w.job);
  const record = async (job, attemptNo, issues, outcome = 'failed', correction = null, productType = 'Dekoration', category = 'home_living') =>
    recordExperience(w.db, { jobId: job.id, attemptNo, category, spec: { ...spec, product_type: productType }, promptSha: 'x', imageUrl: null,
      quality: { approved: outcome === 'passed', uncertain: false, findings: { technical: false } }, feedback: issues, correction, generations: attemptNo, costUsd: 0.04 });
  const likely = { code: 'primary_not_dominant', cause: 'briefing', certainty: 'likely' };
  // Uncertain causes only: stored, but never a rule (G).
  const a = await w.newJob('Deko Pilze 6 Stück Herbst', 'B0PILZ0006'), b = await w.newJob('Deko Pilze 6 Stück Herbst', 'B0PILZ0007'), c = await w.newJob('Deko Pilze 6 Stück Herbst', 'B0PILZ0008');
  for (const job of [a, b, c]) await record(job, 1, [{ ...likely, certainty: 'uncertain', cause: 'generation' }]);
  assert.deepEqual((await lessonsFor(w.db, { category: 'home_living', productType: 'Dekoration' })).rules, []);
  // Irrelevant experience of another product type and category (F).
  const vacuum = await w.newJob('Roborock Qrevo Edge 2 Saugroboter', 'B0ROBO0001');
  for (const attempt of [1, 2, 3]) await record(vacuum, attempt, [{ code: 'forbidden_object', object: 'hund', cause: 'prompt_transformation', certainty: 'likely' }], 'failed', null, 'Saugroboter', 'household');
  // Confirmed experience of the same product type from two jobs with a successful correction (E).
  await record(a, 2, [likely]); await record(b, 2, [likely]); await record(c, 2, [likely]);
  await record(c, 3, [], 'passed', [{ code: 'primary_not_dominant', object: null, correction: 'Nahaufnahme' }]);
  const lessons = await lessonsFor(w.db, { category: 'home_living', productType: 'Dekoration' });
  assert.deepEqual(lessons.rules.map(rule => rule.key), ['primary_not_dominant']);
  assert.equal(lessons.dominant, true); assert.deepEqual(lessons.forbidden, []);
  assert.match(lessons.guidance[0], /Nahaufnahme/);
  const fresh = await w.newJob('Deko Pilze 6 Stück Herbst', 'B0PILZ0009');
  await produceCheckedVisual(fresh, w.hash(fresh), w.deps([{}]));
  assert.match(w.renders.at(-1), /Erfahrung: Nahaufnahme wählen/);
  assert.equal(w.gates.at(-1).primary_object, 'dekorative Pilze (Dekoration)', 'the product-specific briefing stays leading');
  // Experience never overrides the main subject.
  assert.equal(applyLessons(spec, { guidance: [], forbidden: ['pilze', 'katze'], dominant: false }).forbidden_objects.includes('pilze'), false);
});

test('supplement H: the identity of a brand article is never confirmed from a generated picture', async t => {
  assert.equal(identityClassOf('Roborock Qrevo Edge 2 Saugroboter mit Wischfunktion'), 'brand_article');
  assert.equal(identityClassOf('Deko Pilze 6 Stück Herbst'), 'generic_product');
  const w = await world(t, 'Roborock Qrevo Edge 2 Saugroboter mit Wischfunktion', 'B0ROBO0002');
  const spec = imageSpecFor(w.job);
  assert.equal(spec.identity_class, 'brand_article');
  const result = verdict(spec, { depicted_main_subject: 'Saugroboter', product_category_match: 'yes' });
  assert.equal(result.approved, true); assert.equal(result.identity, 'not_verifiable');
  assert.match(buildProviderPrompt(spec, w.job), /generic, unbranded Saugroboter/);
  assert.equal(identityOf(topicImageSpec({ motif: 'Pilze', title: 't' })), 'not_applicable');
  // Feedback marks a wrong product of a precisely typed briefing as an uncertain generation deviation, not a briefing rule.
  const wrong = verdict(spec, { product_category_match: 'no', other_product_instead: 'Staubsauger' });
  const [item] = feedbackFor(wrong, { spec, attemptNo: 1, promptCorrected: false, previous: [] }).filter(entry => entry.code === 'wrong_product');
  assert.deepEqual([item.cause, item.certainty], ['generation', 'uncertain']);
  assert.match(reviseSpecFromFeedback(spec, [item]).composition, /Eindeutig als Saugroboter erkennbar/);
});
