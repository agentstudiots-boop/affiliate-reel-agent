const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../.test-build/lib/publishing/approval-gate');
const { setEventSink } = require('../.test-build/lib/observability/events');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { liveEnv } = require('./helpers/live-env.cjs');
const restoreEnv = liveEnv();
process.on('exit', restoreEnv);
setEventSink(() => {});

// The dry-run preview (shown in the WhatsApp publish approval and in "Status") must give the same answer as the real gate:
// a platform that already has a live attempt from ANY earlier version of the same content is never published again.
const OPERATOR = '491701234567';
const content = (hook) => ({
  contentId: 'tc_preview', hook, caption: 'c', body: 'b', cta: 'x', links: [], disclosures: [],
  assets: [{ role: 'slide-1', kind: 'image', url: 'https://x.public.blob.vercel-storage.com/a.png', sha256: 'a'.repeat(64) }],
  variants: [{ platform: 'instagram', title: null, text: hook, links: [], assetRefs: ['slide-1'], mediaFormat: 'image', disclosure: null }] });
const evidence = (body, replyTo) => ({ channel: 'whatsapp', messageId: `wamid.${Math.random()}`, replyToMessageId: replyTo, senderWaId: OPERATOR, body });
async function approve(db, item, requestId) {
  const version = await G.registerContentVersion(db, item);
  await G.bindApprovalRequest(db, item.contentId, version.version, requestId);
  await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Freigeben', requestId) });
  return version;
}

for (const status of ['published', 'processing', 'unknown']) {
  test(`preview and gate agree: a ${status} attempt of version 1 blocks version 2 on the same platform`, async () => {
    const db = await pgliteDatabase();
    try {
      const v1 = content('Erste Fassung');
      await approve(db, v1, 'wamid.req.1');
      const permit = await G.authorizePublish(db, { content: v1, platform: 'instagram', origin: 'test' });
      await G.completePublishAttempt(db, permit, status, { externalId: 'm1' });
      const v2 = content('Zweite Fassung');
      await approve(db, v2, 'wamid.req.2');
      await assert.rejects(G.authorizePublish(db, { content: v2, platform: 'instagram', origin: 'test' }), error => error.reason === 'already_attempted');
      assert.deepEqual(await G.previewPublish(db, v2, 'instagram'), { allowed: false, reason: 'already_attempted' });
    } finally { await db.close(); }
  });
}
test('preview and gate agree: a definitely failed attempt of version 1 does not block version 2', async () => {
  const db = await pgliteDatabase();
  try {
    const v1 = content('Erste Fassung');
    await approve(db, v1, 'wamid.req.1');
    const permit = await G.authorizePublish(db, { content: v1, platform: 'instagram', origin: 'test' });
    await G.completePublishAttempt(db, permit, 'failed', { reason: 'rejected' });
    const v2 = content('Zweite Fassung');
    await approve(db, v2, 'wamid.req.2');
    assert.deepEqual(await G.previewPublish(db, v2, 'instagram'), { allowed: true, reason: 'approved' });
    await G.authorizePublish(db, { content: v2, platform: 'instagram', origin: 'test' });
  } finally { await db.close(); }
});
