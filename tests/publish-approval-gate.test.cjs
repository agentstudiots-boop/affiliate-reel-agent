const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const G = require('../.test-build/lib/publishing/approval-gate');
const A = require('../.test-build/lib/publishing/authority');
const { setEventSink } = require('../.test-build/lib/observability/events');
const pgliteDatabase = require('./helpers/pglite-db.cjs');
const { liveEnv } = require('./helpers/live-env.cjs');
// The gate also requires the live switch, platform activation and credentials: switched on for this file.
const restoreEnv = liveEnv();
process.on('exit', restoreEnv);

setEventSink(() => {});
const OPERATOR = '491701234567';
const content = (over = {}) => ({
  contentId: 'tc_demo', hook: 'Beschlagene Fenster? Diese Schritte helfen', caption: 'Drei einfache Schritte gegen Kondenswasser.', body: 'Text', cta: 'Speichern für später',
  links: ['https://example.org/landing'], disclosures: [],
  assets: [{ role: 'slide-1', kind: 'image', url: 'https://x.public.blob.vercel-storage.com/a.png', sha256: 'a'.repeat(64) }],
  variants: [
    { platform: 'instagram', title: null, text: 'IG Text', links: [], assetRefs: ['slide-1'], mediaFormat: 'CAROUSEL', disclosure: null },
    { platform: 'facebook', title: null, text: 'FB Text', links: ['https://example.org/landing'], assetRefs: ['slide-1'], mediaFormat: 'CAROUSEL', disclosure: null },
  ], ...over });
const evidence = (body, replyTo, over = {}) => ({ channel: 'whatsapp', messageId: `wamid.${Math.random()}`, replyToMessageId: replyTo, senderWaId: OPERATOR, body, ...over });

async function approved(db, item = content(), requestId = 'wamid.request.1') {
  const version = await G.registerContentVersion(db, item);
  await G.bindApprovalRequest(db, item.contentId, version.version, requestId);
  await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Freigeben', requestId) });
  return version;
}
const reason = expected => error => error instanceof G.PublishBlockedError && error.reason === expected;

test('no version and no answer (pending) mean no publish, even when everything else is ready', async () => {
  const db = await pgliteDatabase();
  try {
    await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'cron' }), reason('no_content_version'));
    const version = await G.registerContentVersion(db, content());
    await G.bindApprovalRequest(db, 'tc_demo', version.version, 'wamid.request.1');
    await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'cron' }), reason('approval_pending'));
    const blocked = await db.query("SELECT count(*)::int AS n FROM publish_attempts WHERE status='blocked'");
    assert.equal(blocked.rows[0].n, 2, 'every blocked attempt is recorded');
  } finally { await db.close(); }
});

test('reject and change requests are final for that version: no publish', async () => {
  const db = await pgliteDatabase();
  try {
    const version = await G.registerContentVersion(db, content());
    await G.bindApprovalRequest(db, 'tc_demo', version.version, 'wamid.r');
    await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Ablehnen', 'wamid.r') });
    await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'retry' }), reason('approval_rejected'));
    await assert.rejects(G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Freigeben', 'wamid.r') }), /not_pending/);

    const other = content({ contentId: 'tc_other' });
    const v2 = await G.registerContentVersion(db, other);
    await G.bindApprovalRequest(db, 'tc_other', v2.version, 'wamid.c');
    await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Mach das weniger werblich', 'wamid.c') });
    await assert.rejects(G.authorizePublish(db, { content: other, platform: 'facebook', origin: 'cron' }), reason('changes_requested'));
  } finally { await db.close(); }
});

test('only the literal approval word from the trusted operator replying to exactly this request approves', async () => {
  const db = await pgliteDatabase();
  try {
    const version = await G.registerContentVersion(db, content());
    await G.bindApprovalRequest(db, 'tc_demo', version.version, 'wamid.req');
    await assert.rejects(G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Freigeben', 'wamid.req', { senderWaId: '4900000' }) }), /untrusted_sender/);
    await assert.rejects(G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Freigeben', 'wamid.unknown') }), /unknown_request/);
    // "passt so" is not an explicit approval: recorded as change request, never as approval.
    const soft = await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('passt so, raus damit', 'wamid.req') });
    assert.equal(soft.decision, 'changes_requested');
    await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'cron' }), reason('changes_requested'));
  } finally { await db.close(); }
});

test('the executive agent is an interface slot only: it can neither record nor carry an approval', async () => {
  const db = await pgliteDatabase();
  try {
    assert.deepEqual([...A.ACTIVE_APPROVAL_AUTHORITIES], ['whatsapp_operator']);
    assert.ok(A.APPROVAL_AUTHORITIES.includes('executive_agent'));
    assert.throws(() => A.ACTIVE_APPROVAL_AUTHORITIES.push('executive_agent'));
    const version = await G.registerContentVersion(db, content());
    await G.bindApprovalRequest(db, 'tc_demo', version.version, 'wamid.req');
    await assert.rejects(G.recordApprovalDecision(db, { authority: 'executive_agent', trustedWaId: OPERATOR, evidence: evidence('Freigeben', 'wamid.req') }), /authority_inactive/);
    // Even a row written around the gate with an inactive authority does not authorize publishing.
    await db.query("UPDATE publish_approvals SET status='approved',authority='executive_agent',decision_message_id='x',decided_at=now() WHERE content_id='tc_demo'");
    await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'executive' }), reason('authority_inactive'));
    // The schema itself refuses an approval without decision evidence.
    await assert.rejects(db.query("UPDATE publish_approvals SET status='approved',authority='whatsapp_operator',decision_message_id=NULL WHERE content_id='tc_demo'"));
  } finally { await db.close(); }
});

test('an explicit approval for exactly this content id + version permits each platform once', async () => {
  const db = await pgliteDatabase();
  try {
    await approved(db);
    const permit = await G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'approval' });
    assert.equal(permit.version, 1);
    G.assertPermitMatches(permit, content(), 'instagram');
    // Cron, retry or fallback for the same platform cannot double-post.
    await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'cron' }), reason('already_attempted'));
    const facebook = await G.authorizePublish(db, { content: content(), platform: 'facebook', origin: 'approval' });
    await G.completePublishAttempt(db, facebook, 'failed', { reason: 'http_400' });
    // A definite platform rejection published nothing: the same approved version may be tried again; unknown may not.
    const again = await G.authorizePublish(db, { content: content(), platform: 'facebook', origin: 'retry' });
    await G.completePublishAttempt(db, again, 'unknown');
    await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'facebook', origin: 'retry' }), reason('already_attempted'));
    // A platform that was not part of the approved version is blocked.
    await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'tiktok', origin: 'adapter' }), reason('platform_not_in_approved_version'));
  } finally { await db.close(); }
});

for (const [label, change] of [
  ['new hook', { hook: 'Ganz anderer Aufhänger für das Thema' }],
  ['new asset', { assets: [{ role: 'slide-1', kind: 'image', url: 'https://x.public.blob.vercel-storage.com/b.png', sha256: 'b'.repeat(64) }] }],
  ['other caption', { caption: 'Andere Caption' }],
  ['other link', { links: ['https://example.org/andere-seite'] }],
  ['other platform text', { variants: content().variants.map(v => v.platform === 'instagram' ? { ...v, text: 'Neuer IG-Text' } : v) }],
  ['added platform', { variants: [...content().variants, { platform: 'x', title: null, text: 'X', links: [], assetRefs: [], mediaFormat: 'TEXT', disclosure: null }] }],
]) {
  test(`a content change (${label}) invalidates the approval automatically and requires a new one`, async () => {
    const db = await pgliteDatabase();
    try {
      await approved(db);
      const changed = content(change);
      // Publishing changed content directly with the old approval: blocked and the old approval is voided.
      await assert.rejects(G.authorizePublish(db, { content: changed, platform: 'instagram', origin: 'adapter' }), reason('content_changed_since_approval'));
      assert.equal((await G.approvalState(db, 'tc_demo')).status, 'invalidated');
      // Registering the change creates version 2, pending; the original content is no longer publishable either.
      const v2 = await G.registerContentVersion(db, changed);
      assert.equal(v2.version, 2);
      assert.equal((await G.approvalState(db, 'tc_demo')).status, 'pending');
      await assert.rejects(G.authorizePublish(db, { content: changed, platform: 'instagram', origin: 'cron' }), reason('approval_pending'));
      await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'cron' }), reason('content_changed_since_approval'));
      // The old WhatsApp approval message cannot approve the new version.
      await assert.rejects(G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Freigeben', 'wamid.request.1') }), /not_pending|unknown_request/);
      await G.bindApprovalRequest(db, 'tc_demo', 2, 'wamid.request.2');
      await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Freigeben', 'wamid.request.2') });
      const permit = await G.authorizePublish(db, { content: changed, platform: 'instagram', origin: 'approval' });
      assert.equal(permit.version, 2);
    } finally { await db.close(); }
  });
}

test('unchanged re-registration keeps the version; key order does not change the fingerprint', async () => {
  const db = await pgliteDatabase();
  try {
    const first = await G.registerContentVersion(db, content());
    const reordered = Object.fromEntries(Object.entries(content()).reverse());
    reordered.variants = [...content().variants].reverse();
    const second = await G.registerContentVersion(db, reordered);
    assert.equal(second.version, first.version);
    assert.equal(second.changed, false);
  } finally { await db.close(); }
});

test('a permit only fits the exact outgoing payload and cannot be forged', async () => {
  const db = await pgliteDatabase();
  try {
    await approved(db);
    const permit = await G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'approval' });
    assert.throws(() => G.assertPermitMatches(permit, content({ caption: 'manipuliert' }), 'instagram'), reason('permit_mismatch'));
    assert.throws(() => G.assertPermitMatches(permit, content(), 'facebook'), reason('permit_mismatch'));
    assert.throws(() => G.assertPermitMatches({ ...permit }, content(), 'instagram'), reason('permit_forged'));
    assert.throws(() => G.assertPermitMatches({ contentId: 'tc_demo', version: 1, platform: 'instagram' }, content(), 'instagram'), reason('permit_forged'));
  } finally { await db.close(); }
});

test('a decision on a superseded version is refused and voids that request', async () => {
  const db = await pgliteDatabase();
  try {
    const v1 = await G.registerContentVersion(db, content());
    await G.bindApprovalRequest(db, 'tc_demo', v1.version, 'wamid.old');
    await G.registerContentVersion(db, content({ hook: 'Neuer Hook für dieselbe Idee' }));
    await assert.rejects(G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Freigeben', 'wamid.old') }), /not_pending/);
  } finally { await db.close(); }
});

test('no module outside lib/publishing records approvals or bypasses the gate', () => {
  const root = path.join(__dirname, '..', 'lib');
  const offenders = [];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (full.includes(`${path.sep}publishing${path.sep}`)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (/(INSERT INTO|UPDATE|DELETE FROM)\s+(publish_approvals|content_versions|publish_attempts)/i.test(text)) offenders.push(full);
  } };
  walk(root);
  assert.deepEqual(offenders, []);
});

const { withEnv } = require('./helpers/live-env.cjs');

test('invariant: valid approval alone is not enough — live switch, platform activation and credentials are enforced by the gate', async () => {
  const db = await pgliteDatabase();
  try {
    await approved(db);
    for (const [env, expected] of [[{ TOPIC_LIVE_PUBLISHING: undefined }, 'live_publishing_disabled'], [{ TOPIC_LIVE_PUBLISHING: 'yes' }, 'live_publishing_disabled'],
      [{ TOPIC_PLATFORMS: 'facebook,x' }, 'platform_not_enabled'], [{ META_INSTAGRAM_USER_ID: undefined }, 'credentials_missing'], [{ BLOB_READ_WRITE_TOKEN: undefined }, 'credentials_missing']]) {
      const restore = withEnv(env);
      try { await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'cron' }), reason(expected), JSON.stringify(env)); }
      finally { restore(); }
    }
    // With everything in place the same approval works; nothing was claimed by the blocked attempts.
    const permit = await G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'approval' });
    assert.equal(permit.version, 1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM publish_attempts WHERE status='blocked'")).rows[0].n, 5);
  } finally { await db.close(); }
});

test('invariant: a second "Freigeben" changes nothing; repeated publish calls never claim twice; processing blocks re-publishing', async () => {
  const db = await pgliteDatabase();
  try {
    await approved(db);
    await assert.rejects(G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: OPERATOR, evidence: evidence('Freigeben', 'wamid.request.1') }), /not_pending/);
    const permit = await G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'approval' });
    await G.recordRemoteId(db, permit, 'container:42');
    await G.completePublishAttempt(db, permit, 'processing', { externalId: 'container:42' });
    for (let i = 0; i < 3; i++) await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'instagram', origin: 'cron' }), reason('already_attempted'));
    const open = await G.openAttempts(db);
    assert.deepEqual(open.map(item => [item.platform, item.status, item.remoteIds]), [['instagram', 'processing', ['container:42']]]);
    await G.settleAttempt(db, open[0].id, 'published', { externalId: '999', url: 'https://www.instagram.com/p/1/' });
    const stored = await G.platformAttempt(db, 'tc_demo', 'instagram');
    assert.deepEqual([stored.status, stored.externalId, stored.url], ['published', '999', 'https://www.instagram.com/p/1/']);
    // Reconciliation never re-opens a published attempt; an unclear attempt only becomes published on confirmation.
    await G.settleAttempt(db, open[0].id, 'failed');
    assert.equal((await G.platformAttempt(db, 'tc_demo', 'instagram')).status, 'published');
    const fb = await G.authorizePublish(db, { content: content(), platform: 'facebook', origin: 'approval' });
    await G.completePublishAttempt(db, fb, 'unknown');
    await G.settleAttempt(db, fb.attemptId, 'failed');
    assert.equal((await G.platformAttempt(db, 'tc_demo', 'facebook')).status, 'unknown');
    await assert.rejects(G.authorizePublish(db, { content: content(), platform: 'facebook', origin: 'retry' }), reason('already_attempted'));
  } finally { await db.close(); }
});
