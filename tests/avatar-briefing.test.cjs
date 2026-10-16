const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { approveContent } = require('./helpers/approve-content.cjs');
const L = '../.test-build/lib';
const { memoryRepository } = require(`${L}/memory/repository`);
const { runContentJob } = require(`${L}/content/orchestrator`);
const { opportunitySchema } = require(`${L}/content/schema`);
const B = require(`${L}/visual/avatar-briefing`);
const P = require(`${L}/visual/avatar-preflight`);

// HeyGen product videos with the brand avatar Mia (Auftrag 15.10.): preparation only – briefing, preflight, quality checklist.
// No network call, no render, no cost; HEYGEN_ENABLED stays off by default.
const opp = (name = 'Fugenbürste mit Stiel', asin = 'B0FUGE0001') => opportunitySchema.parse({ product: { productVerifiedAt: '2026-10-01T08:00:00.000Z', productVerifiedName: name, name, asin,
  sourceUrl: `https://www.amazon.de/dp/${asin}`, affiliateUrl: `https://www.amazon.de/dp/${asin}?tag=alltaeglichle-21`, price: '', targetGroup: 'Haushalte mit Fliesen', benefits: 'Fugen reinigen', notes: '' },
  useCase: 'Verschmutzte Fugen in der Dusche ohne Knien reinigen.', category: 'household', targetPlatform: 'instagram', budget: 'low', verifiedFacts: [{ claim: 'Stiel laut Produkttitel verstellbar', source: `https://www.amazon.de/dp/${asin}` }] });
async function videoJob(t, name, asin) {
  const db = await pgliteDatabase(); t.after(() => db.close());
  const memory = memoryRepository(db);
  const id = crypto.randomUUID(); const o = opp(name, asin);
  await memory.claim(id, o, 'reference');
  const planned = await runContentJob(o, { id, onUpdate: memory.save, loadLearning: memory.learn, allowedFormats: ['video'] });
  assert.equal(planned.content.format, 'video', 'reference video draft');
  return { db, job: await approveContent(db, memory, id) };
}
const ref = (over = {}) => ({ url: 'https://x.public.blob.vercel-storage.com/uploads/fuge-front.png', source: 'operator_upload', rightsConfirmed: true, view: 'front', ...over });

test('briefing: structured fields from the approved video draft – spoken text, gestures, scenes and product references kept apart', async t => {
  const { job } = await videoJob(t);
  const result = B.buildAvatarBriefing(job, [ref()]);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const b = result.briefing;
  assert.equal(b.avatar.name, 'Mia'); assert.equal(b.aspectRatio, '9:16');
  assert.equal(b.scenes.length, job.content.scenes.length);
  b.scenes.forEach((scene, i) => {
    assert.equal(scene.spokenText, job.content.scenes[i].audio.trim(), 'spoken text = approved script, unchanged');
    assert.equal(scene.sceneDescription, job.content.scenes[i].visual.trim());
    assert.ok(scene.gesture.length > 5); assert.ok(scene.subtitle.length > 0);
  });
  assert.ok(b.scenes.some(scene => scene.productInteraction === 'hold_in_hand'), 'small product + real reference → may be held');
  assert.deepEqual(b.product.verifiedFacts, ['Stiel laut Produkttitel verstellbar (Quelle: https://www.amazon.de/dp/B0FUGE0001)']);
  assert.match(b.disclosure, /Werbung/);
  assert.equal(b.durationSeconds, job.content.scenes.reduce((s, x) => s + x.durationSeconds, 0));
  assert.equal(B.avatarBriefingSchema.safeParse(b).success, true);
  assert.equal(B.spokenScript(b).split('\n\n').length, b.scenes.length);
});

test('briefing: no invented product depiction – without a rights-confirmed own image the product is never held; big appliances are not handheld', async t => {
  const { job } = await videoJob(t);
  const noRef = B.buildAvatarBriefing(job, []).briefing;
  assert.ok(noRef.scenes.every(scene => scene.productInteraction !== 'hold_in_hand'));
  assert.match(noRef.limits.join(' '), /nicht in Mias Hand/);
  const amazon = B.buildAvatarBriefing(job, [ref({ source: 'amazon', rightsConfirmed: false })]);
  assert.equal(amazon.ok, false); assert.match(amazon.errors[0], /Nutzungsrechte/);
  assert.equal(B.interactionFor('Saugroboter mit Wischfunktion', [ref()], 2, 4), 'show_next_to');
  assert.equal(B.interactionFor('Fugenbürste', [ref()], 2, 4), 'hold_in_hand');
});

test('briefing: only approved and verified jobs; a draft awaiting approval is refused', async t => {
  const { job } = await videoJob(t);
  const pending = { ...job, status: 'awaiting_approval' };
  const result = B.buildAvatarBriefing(pending, []);
  assert.equal(result.ok, false); assert.match(result.errors.join(' '), /freigegeben/);
  const unverified = { ...job, opportunity: { ...job.opportunity, product: { ...job.opportunity.product, productVerifiedAt: undefined } } };
  assert.match(B.buildAvatarBriefing(unverified, []).errors.join(' '), /verifiziert/);
});

test('preflight: off by default, lists every missing piece, estimates cost honestly, enforces the monthly limit', async t => {
  const { job } = await videoJob(t);
  const b = B.buildAvatarBriefing(job, [ref()]).briefing;
  const off = P.avatarPreflight(b, { env: {} });
  assert.equal(off.ready, false);
  for (const text of ['HEYGEN_ENABLED', 'HEYGEN_API_KEY', 'HEYGEN_AVATAR_ID', 'HEYGEN_VOICE_ID', 'HEYGEN_MONTHLY_VIDEO_LIMIT']) assert.ok(off.blockers.some(item => item.includes(text)), text);
  assert.equal(off.estimate.usd, Math.round(b.durationSeconds * 0.05 * 100) / 100);
  assert.match(off.estimate.basis, /Annahme.*maßgeblich ist der Preis, den HeyGen/);
  assert.ok(off.warnings.some(item => /v2/.test(item)));
  const env = { HEYGEN_ENABLED: 'true', HEYGEN_API_KEY: 'k', HEYGEN_AVATAR_ID: 'mia', HEYGEN_VOICE_ID: 'de', HEYGEN_MONTHLY_VIDEO_LIMIT: '3', HEYGEN_COST_PER_SECOND_USD: '0.1' };
  const ok = P.avatarPreflight(b, { env, usedThisMonth: 1 });
  assert.equal(ok.ready, true, ok.blockers.join(' ')); assert.equal(ok.quota.remaining, 2); assert.equal(ok.estimate.usd, Math.round(b.durationSeconds * 0.1 * 100) / 100);
  assert.equal(P.avatarPreflight(b, { env, usedThisMonth: 3 }).ready, false);
  assert.equal(P.avatarPreflight({ ...b, durationSeconds: 90 }, { env }).ready, false);
  // Preflight is pure: no network, no provider call.
  const src = fs.readFileSync('lib/visual/avatar-preflight.ts', 'utf8') + fs.readFileSync('lib/visual/avatar-briefing.ts', 'utf8');
  assert.ok(!/fetch\(|\.create\(|api\.heygen\.com/.test(src));
});

test('quality: technical metadata check plus an operator checklist; nothing is approved automatically', async t => {
  const { job } = await videoJob(t);
  const b = B.buildAvatarBriefing(job, []).briefing;
  assert.equal(P.technicalVideoCheck({ width: 1080, height: 1920, durationSeconds: b.durationSeconds, hasAudio: true }, b).ok, true);
  const bad = P.technicalVideoCheck({ width: 1920, height: 1080, durationSeconds: b.durationSeconds * 3, hasAudio: false }, b);
  assert.equal(bad.ok, false); assert.equal(bad.issues.length, 4, 'landscape + too low + too long + no audio');
  assert.ok(P.VIDEO_QUALITY_CHECKLIST.filter(item => !item.automatic).length >= 6, 'lip sync, gestures, product etc. need the operator');
});
