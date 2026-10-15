const { test } = require('node:test');
const assert = require('node:assert/strict');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { approveContent } = require('./helpers/approve-content.cjs');
const { withEnv } = require('./helpers/live-env.cjs');
const L = '../.test-build/lib';
const { memoryRepository } = require(`${L}/memory/repository`);
const { runContentJob } = require(`${L}/content/orchestrator`);
const { opportunitySchema } = require(`${L}/content/schema`);
const { handleImageQualityReply } = require(`${L}/whatsapp/image-quality-reply`);
const { handleManualOrder, settleOrderFromDraft, approvedJobState } = require(`${L}/whatsapp/manual-order`);
const { startActiveOrder, loadActiveOrder } = require(`${L}/whatsapp/active-context`);
const { overrideClass, uncheckedVisual, stopNoticeText } = require(`${L}/content/image-quality/production`);
const { setEventSink } = require(`${L}/observability/events`);

// Regression tests for the known WhatsApp image-stop / order defects (Auftrag 2026-10-15, P1):
//  1. image stops not bound to job + content version   2. free „Mach es trotzdem“ mishandled
//  3. new drafts overwriting running orders             4. design vs. hard image issues not distinguished
//  5. active context lost                               6. image decision is never a publication approval
setEventSink(() => {});
const OPERATOR = '491234';
const NOTHING = { primaryMissing: false, forbiddenSeen: [], wrongProduct: false, defects: false, composition: false, technical: false };
const quality = over => ({ approved: false, uncertain: false, hard_failures: [], soft_failures: [], retry_recommended: false, findings: { ...NOTHING },
  checked: { technical: true, vision: true }, model: 'test', identity: 'not_verifiable', ...over });
const DESIGN = quality({ soft_failures: ['Hauptmotiv nicht im Vordergrund (Komposition entspricht nicht dem Briefing).'], findings: { ...NOTHING, composition: true } });
const HARD = quality({ hard_failures: ['Falsches Produkt: Kaffeemaschine.'], findings: { ...NOTHING, wrongProduct: true }, retry_recommended: true });

async function world(t) {
  const db = await pgliteDatabase(); t.after(() => db.close());
  t.after(withEnv({ WHATSAPP_APPROVER_WA_ID: OPERATOR }));
  const memory = memoryRepository(db);
  const job = async (name = 'Deko Pilze 6 Stück Herbst', asin = 'B0PILZ0001') => {
    const id = crypto.randomUUID();
    const opp = opportunitySchema.parse({ product: { productVerifiedAt: '2026-10-01T08:00:00.000Z', productVerifiedName: name, name, asin, sourceUrl: `https://www.amazon.de/dp/${asin}`,
      affiliateUrl: `https://www.amazon.de/dp/${asin}?tag=alltaeglichle-21`, price: '', targetGroup: 'Haushalte', benefits: 'Herbstliche Dekoration', notes: '' },
      useCase: 'Herbstliche Dekoration auf dem Sideboard im Wohnzimmer.', category: 'home_living', targetPlatform: 'facebook', budget: 'low' });
    await memory.claim(id, opp, 'reference'); await runContentJob(opp, { id, onUpdate: memory.save, loadLearning: memory.learn });
    return approveContent(db, memory, id);
  };
  const attempt = (jobId, no, hash, q, status = q.uncertain ? 'uncertain' : 'failed') => db.query(`INSERT INTO image_generation_attempts(job_id,attempt_no,content_hash,provider,model,prompt_sha256,status,quality_status,quality,image_url,sha256)
    VALUES($1,$2,$3,'replicate','m','p','generated',$4,$5,$6,$7)`, [jobId, no, hash, status, JSON.stringify(q), `https://x.public.blob.vercel-storage.com/generated/facebook/${jobId}/${'a'.repeat(64)}.png`, 'a'.repeat(64)]);
  const notice = (messageId, jobId, reason, no, at = 'now()') => db.query(`INSERT INTO image_quality_notices(message_id,job_id,reason,attempt_no,created_at) VALUES($1,$2,$3,$4,${at})`, [messageId, jobId, reason, no]);
  const sent = [], calls = [];
  const reply = (id, body, replyTo) => handleImageQualityReply({ id, from: OPERATOR, body, replyToMessageId: replyTo, payload: {} },
    { database: () => db, request: async (jobId, mode) => { calls.push([jobId, mode]); }, send: async text => { sent.push(text); return `wamid.out.${sent.length}`; } });
  const log = async messageId => (await db.query('SELECT action FROM whatsapp_context_log WHERE message_id=$1', [messageId])).rows.map(row => row.action);
  return { db, memory, job, attempt, notice, reply, sent, calls, log };
}

test('override classes: hard failures are never overridable; design-only and uncertain checks are', () => {
  assert.equal(overrideClass(HARD), 'hard');
  assert.equal(overrideClass(DESIGN), 'design');
  assert.equal(overrideClass(quality({ uncertain: true, checked: { technical: true, vision: false } })), 'uncertain');
  assert.equal(overrideClass(quality({ hard_failures: ['Bild-URL nicht abrufbar.'], findings: { ...NOTHING, technical: true }, checked: { technical: true, vision: false } })), 'hard');
  assert.equal(overrideClass(quality({ checked: { technical: true, vision: false } })), 'hard', 'no vision check: nothing to override');
  assert.equal(overrideClass(null), 'hard');
  const base = { status: 'stopped', reason: 'quality_failed', detail: [], attemptNo: 2, used: 2, allowed: 2 };
  assert.match(stopNoticeText('Pilze', { ...base, quality: DESIGN }), /Bild trotzdem senden“ \(nur gestalterische Mängel/);
  const hard = stopNoticeText('Pilze', { ...base, quality: HARD });
  assert.doesNotMatch(hard, /Bild trotzdem senden/); assert.match(hard, /Harte Prüfregel verletzt/);
});

test('4: „Bild trotzdem senden“ works for design-only issues, is refused for hard failures; it never publishes', async t => {
  const w = await world(t);
  const design = await w.job(), hard = await w.job('Pilzlampe LED Tischleuchte aus Holz', 'B0PILZ0002');
  await w.attempt(design.id, 1, 'h1', DESIGN); await w.notice('wamid.n.design', design.id, 'quality_failed', 1);
  await w.attempt(hard.id, 1, 'h2', HARD); await w.notice('wamid.n.hard', hard.id, 'quality_failed', 1);
  assert.equal(await w.reply('wamid.r1', 'Bild trotzdem senden', 'wamid.n.hard'), true);
  assert.deepEqual(w.calls, []);
  assert.match(w.sent.at(-1), /harte Prüfregel/);
  assert.equal(await w.reply('wamid.r2', 'Bild trotzdem senden', 'wamid.n.design'), true);
  assert.deepEqual(w.calls, [[design.id, 'send_unchecked']]);
  assert.deepEqual(await w.log('wamid.r1'), ['image:override_refused']);
  assert.deepEqual(await w.log('wamid.r2'), ['image:send_unchecked']);
  // The production step turns the design override into an image for the operator's own publication approval, marked as
  // not automatically confirmed; a hard failure stays stopped.
  const deps = { db: w.db, provider: { name: 'replicate' }, model: 'm' };
  const passed = await uncheckedVisual(design, 'h1', deps);
  assert.equal(passed.status, 'passed'); assert.equal(passed.manualOverride, true); assert.equal(passed.checked, false);
  assert.equal((await w.db.query('SELECT quality_status FROM image_generation_attempts WHERE job_id=$1', [design.id])).rows[0].quality_status, 'manual_override');
  const refused = await uncheckedVisual(hard, 'h2', deps);
  assert.equal(refused.status, 'stopped');
  assert.equal((await w.db.query('SELECT count(*)::int AS n FROM publications')).rows[0].n, 0);
  assert.equal((await w.db.query('SELECT count(*)::int AS n FROM publication_requests')).rows[0].n, 0, 'an image decision is no publication approval');
});

test('2: a free „Mach es trotzdem“ on an image notice asks back and starts nothing', async t => {
  const w = await world(t);
  const job = await w.job();
  await w.attempt(job.id, 1, 'h1', DESIGN); await w.notice('wamid.n1', job.id, 'quality_failed', 1);
  for (const [id, body] of [['wamid.a1', 'Mach es trotzdem'], ['wamid.a2', 'Schick es trotzdem'], ['wamid.a3', 'passt so'], ['wamid.a4', 'trotzdem senden!']]) {
    assert.equal(await w.reply(id, body, 'wamid.n1'), true);
    assert.match(w.sent.at(-1), /antworte auf die Bildnachricht mit genau „Bild trotzdem senden“/, body);
  }
  const hardJob = await w.job('Pilzlampe LED Tischleuchte aus Holz', 'B0PILZ0002');
  await w.attempt(hardJob.id, 1, 'h2', HARD); await w.notice('wamid.n2', hardJob.id, 'quality_failed', 1);
  await w.reply('wamid.a5', 'Mach es trotzdem', 'wamid.n2');
  assert.match(w.sent.at(-1), /kann ich nicht trotzdem verwenden: Es verletzt eine harte Prüfregel/);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(await w.log('wamid.a1'), ['image:clarify_anyway']);
  // Idempotent: a redelivered webhook answers nothing twice.
  const before = w.sent.length;
  await w.reply('wamid.a1', 'Mach es trotzdem', 'wamid.n1');
  assert.equal(w.sent.length, before);
});

test('1: replies bind to the newest notice, the same content version and a still valid content approval', async t => {
  const w = await world(t);
  const job = await w.job();
  await w.attempt(job.id, 1, 'old-hash', DESIGN); await w.notice('wamid.old', job.id, 'quality_failed', 1, "now()-interval '1 hour'");
  await w.attempt(job.id, 2, 'old-hash', DESIGN); await w.notice('wamid.new', job.id, 'quality_failed', 2);
  await w.reply('wamid.r1', 'Neues Bild', 'wamid.old');
  assert.match(w.sent.at(-1), /nicht mehr die aktuelle/);
  assert.deepEqual(w.calls, []);
  assert.equal((await w.db.query('SELECT count(*)::int AS n FROM image_generation_grants')).rows[0].n, 0, 'no paid attempt granted from an outdated notice');
  // A newer content version (new hash) makes the notice of the old version invalid.
  await w.attempt(job.id, 3, 'new-hash', DESIGN);
  await w.reply('wamid.r2', 'Neues Bild', 'wamid.new');
  assert.match(w.sent.at(-1), /älteren Fassung/);
  assert.deepEqual(w.calls, []);
  // Without a valid content approval (draft changed back to review) nothing starts either.
  const other = await w.job('Pilzlampe LED Tischleuchte aus Holz', 'B0PILZ0002');
  await w.attempt(other.id, 1, 'h', DESIGN); await w.notice('wamid.o', other.id, 'quality_failed', 1);
  await w.db.query("UPDATE content_jobs SET status='awaiting_approval' WHERE id=$1", [other.id]);
  await w.reply('wamid.r3', 'Bild trotzdem senden', 'wamid.o');
  assert.match(w.sent.at(-1), /keine gültige Inhaltsfreigabe/);
  assert.deepEqual(w.calls, []);
  assert.deepEqual(await w.log('wamid.r1'), ['image:stale_notice']);
  assert.deepEqual(await w.log('wamid.r2'), ['image:stale_version']);
  // The valid case still works: newest notice, current version.
  await w.db.query("UPDATE content_jobs SET status='approved' WHERE id=$1", [other.id]);
  await w.reply('wamid.r4', 'Neues Bild: Lampe größer', 'wamid.o');
  assert.deepEqual(w.calls, [[other.id, 'continue']]);
});

test('3 + 5: „Mach es trotzdem“ without quote never starts a new draft for an approved, image-stopped order; the context stays', async t => {
  const w = await world(t);
  const job = await w.job();
  await startActiveOrder(w.db, { waId: OPERATOR, messageId: 'wamid.order', productLabel: 'Deko Pilze', searchTerm: 'Deko Pilze', status: 'awaiting_approval', jobId: job.id });
  await w.attempt(job.id, 1, 'h1', DESIGN); await w.notice('wamid.n1', job.id, 'quality_failed', 1);
  assert.equal(await approvedJobState(w.db, job.id), 'image_stopped');
  const starts = [];
  const handled = await handleManualOrder({ id: 'wamid.anyway', from: OPERATOR, body: 'Mach es trotzdem', replyToMessageId: null, payload: {} },
    { database: () => w.db, start: async (...args) => { starts.push(args); return { status: 'awaiting_approval' }; }, send: async text => { w.sent.push(text); return 'x'; } });
  assert.equal(handled, true);
  assert.deepEqual(starts, [], 'no new draft');
  assert.match(w.sent.at(-1), /Meinst du den angehaltenen Bildauftrag zu „Deko Pilze“\?.*direkt auf die Bildnachricht/s);
  const order = await loadActiveOrder(w.db, OPERATOR);
  assert.equal(order.jobId, job.id); assert.equal(order.sourceMessageId, 'wamid.order', 'active context unchanged');
  // Once the publication approval is pending the follow-up points there, still without a new draft.
  await w.db.query("INSERT INTO publication_requests(id,job_id,platform,status,content_hash,caption,approver_wa_id) VALUES($1,$2,'facebook','pending','h1','Text',$3)", [crypto.randomUUID(), job.id, OPERATOR]);
  assert.equal(await approvedJobState(w.db, job.id), 'in_publication');
  await handleManualOrder({ id: 'wamid.anyway2', from: OPERATOR, body: 'Mach es trotzdem', replyToMessageId: null, payload: {} },
    { database: () => w.db, start: async (...args) => { starts.push(args); return { status: 'awaiting_approval' }; }, send: async text => { w.sent.push(text); return 'x'; } });
  assert.deepEqual(starts, []);
  assert.match(w.sent.at(-1), /wartet auf die Veröffentlichungsfreigabe/);
});

test('3 + 5: a refused duplicate never repoints the active order to an empty placeholder draft', async t => {
  const w = await world(t);
  const job = await w.job();
  await startActiveOrder(w.db, { waId: OPERATOR, messageId: 'wamid.o1', productLabel: 'Deko Pilze', jobId: job.id, status: 'in_progress' });
  await settleOrderFromDraft(w.db, OPERATOR, 'wamid.o1', { status: 'needs_input', jobId: crypto.randomUUID(), reason: 'product_already_open' });
  const order = await loadActiveOrder(w.db, OPERATOR);
  assert.equal(order.jobId, job.id);
  assert.equal(order.status, 'blocked'); assert.equal(order.reason, 'product_already_open');
});
