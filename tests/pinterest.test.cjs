const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pinterestPublisher, refreshPinterestToken } = require('../.test-build/lib/distribution/publishers/pinterest');
const { renderForPlatform } = require('../.test-build/lib/distribution/platforms/adapters');
const { buildMasterContent } = require('../.test-build/lib/distribution/master-content');
const { activePlatforms, livePublishCapability } = require('../.test-build/lib/capabilities');
const { publishAll, publishableContent } = require('../.test-build/lib/distribution/publish');
const G = require('../.test-build/lib/publishing/approval-gate');
const dbOpen = require('./helpers/pglite-db.cjs');
const { withEnv } = require('./helpers/live-env.cjs');
const env = { VERCEL_ENV: 'production', TOPIC_LIVE_PUBLISHING: 'true', TOPIC_PLATFORMS: 'pinterest', PINTEREST_BOARD_ID: '123', PINTEREST_ACCESS_TOKEN: 'test-secret', PINTEREST_ACCESS_TOKEN_EXPIRES_AT: '2099-01-01T00:00:00Z' };
const image = { role: 'cover', asset: { kind: 'image', url: 'https://x.public.blob.vercel-storage.com/a.png', sha256: 'a'.repeat(64), mediaType: 'image/png', provider: 'test' } };
const video = { role: 'video', asset: { kind: 'video', url: 'https://x.public.blob.vercel-storage.com/a.mp4', sha256: 'b'.repeat(64), mediaType: 'video/mp4', provider: 'test' } };
const copy = { title: 'Fenster', hook: 'Lüften im Herbst', problem: 'p', coreMessage: 'k', body: 'Text', caption: 'c', hashtags: [], cta: 'Speichern', points: [], imageMotif: 'Fenster', videoScript: 's' };
const master = (format = 'SINGLE_IMAGE', assets = [image]) => buildMasterContent({ contentId: 'tc_pinterest', topic: { topic_id: 'tp_0000000000000001', title: 'Fenster', trend_type: 'PRACTICAL_LIFE' }, format, copy, assets, carousel: null, sources: [], runId: null, origin: 'test' });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const context = () => ({ permit: {}, beforePublish: async () => {}, onRemoteId: async () => {} });

test('Pinterest is opt-in, even with the global live switch and credentials; preview cannot publish', () => {
  assert.equal(activePlatforms({}).includes('pinterest'), false);
  assert.equal(livePublishCapability('pinterest', { ...env, TOPIC_PLATFORMS: undefined }).ok, false);
  assert.equal(livePublishCapability('pinterest', { ...env, VERCEL_ENV: 'preview' }).ok, false);
  assert.equal(renderForPlatform(master('CAROUSEL'), 'pinterest').publishable, false);
});

test('Pinterest image Pin preserves approved text/link and uses v5; 429 definite, 503/timeout ambiguous', async () => {
  const m = master(); const v = renderForPlatform(m, 'pinterest'); v.links = ['https://example.org/item'];
  let sent;
  const p = pinterestPublisher({ env, request: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return json({ id: '123456' }); } });
  const result = await p.publish(v, m, context());
  assert.equal(sent.url, 'https://api.pinterest.com/v5/pins');
  assert.equal(sent.body.description, v.text); assert.equal(sent.body.link, v.links[0]);
  assert.equal(result.url, 'https://www.pinterest.com/pin/123456/');
  for (const code of [429, 503, 408]) {
    await assert.rejects(pinterestPublisher({ env, request: async () => json({}, code) }).publish(v, m, context()), e => e.definite === (code === 429));
  }
  await assert.rejects(pinterestPublisher({ env, request: async () => { throw new Error('network'); } }).publish(v, m, context()), e => !e.definite);
});

test('Pinterest video uses the shared MP4 and approved cover; never sends credentials to AWS', async () => {
  const m = master('STANDARD_VIDEO', [video, image]); const v = renderForPlatform(m, 'pinterest'); const calls = [];
  const p = pinterestPublisher({ env, sleep: async () => {}, request: async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('.mp4')) return new Response(Buffer.from('mp4'));
    if (String(url).endsWith('/media')) return json({ media_id: '987', upload_url: 'https://pinterest-media-upload.s3-accelerate.amazonaws.com/', upload_parameters: { key: 'test' } });
    if (String(url).includes('amazonaws.com')) { assert.equal(init.headers, undefined); assert.ok(init.body instanceof FormData); return new Response(null, { status: 204 }); }
    if (String(url).endsWith('/media/987')) return json({ status: 'succeeded' });
    assert.equal(JSON.parse(init.body).media_source.cover_image_url, image.asset.url);
    return json({ id: '123456' });
  } });
  assert.equal((await p.publish(v, m, context())).state, 'published');
  assert.equal(calls.filter(c => c.url.endsWith('/pins')).length, 1);
  const noCover = master('STANDARD_VIDEO', [video]);
  await assert.rejects(p.publish(renderForPlatform(noCover, 'pinterest'), noCover, context()), /platform_publish_rejected/);
});

test('Pinterest refuses expired credentials before any call; OAuth refresh returns rotated credentials only to the secret-store caller', async () => {
  let calls = 0; const m = master();
  await assert.rejects(pinterestPublisher({ env: { ...env, PINTEREST_ACCESS_TOKEN_EXPIRES_AT: '2020-01-01' }, request: async () => { calls++; return json({}); } }).publish(renderForPlatform(m, 'pinterest'), m, context()));
  assert.equal(calls, 0);
  const result = await refreshPinterestToken({ ...env, PINTEREST_CLIENT_ID: 'id', PINTEREST_CLIENT_SECRET: 'secret' }, { accessToken: 'old', expiresAt: 0, refreshToken: 'old-refresh' }, async (url, init) => {
    assert.equal(url, 'https://api.pinterest.com/v5/oauth/token'); assert.match(init.headers.Authorization, /^Basic /);
    assert.equal(init.body.get('grant_type'), 'refresh_token'); return json({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 });
  });
  assert.equal(result.refreshToken, 'rotated'); assert.ok(result.expiresAt > Date.now());
});

test('Pinterest router: pending approval makes zero calls; an ambiguous approved POST is never repeated', async () => {
  const restore = withEnv(env); const db = await dbOpen();
  try {
    let calls = 0; const m = master(); const variants = [renderForPlatform(m, 'pinterest')];
    const p = pinterestPublisher({ env, request: async () => { calls++; throw new Error('response lost'); } });
    const input = { master: m, variants, publishers: [p], origin: 'topic_pipeline' };
    const content = publishableContent(m, variants); const version = await G.registerContentVersion(db, content);
    await G.bindApprovalRequest(db, content.contentId, version.version, 'wamid.pinrequest');
    await publishAll(db, input); assert.equal(calls, 0);
    await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: '491234', evidence: { channel: 'whatsapp', messageId: 'wamid.pinanswer', replyToMessageId: 'wamid.pinrequest', senderWaId: '491234', body: 'Freigeben' } });
    assert.equal((await publishAll(db, input)).outcomes[0].status, 'unknown');
    await publishAll(db, input); assert.equal(calls, 1);
  } finally { restore(); await db.close(); }
});

test('revoking the approved version during a Pinterest video upload prevents the final Pin', async () => {
  const restore = withEnv(env); const db = await dbOpen();
  try {
    const m = master('STANDARD_VIDEO', [video, image]); const variants = [renderForPlatform(m, 'pinterest')]; const content = publishableContent(m, variants);
    const version = await G.registerContentVersion(db, content);
    await G.bindApprovalRequest(db, content.contentId, version.version, 'wamid.videorequest');
    await G.recordApprovalDecision(db, { authority: 'whatsapp_operator', trustedWaId: '491234', evidence: { channel: 'whatsapp', messageId: 'wamid.videoanswer', replyToMessageId: 'wamid.videorequest', senderWaId: '491234', body: 'Freigeben' } });
    let pins = 0;
    const p = pinterestPublisher({ env, sleep: async()=>{}, request: async (url) => {
      if (String(url).endsWith('.mp4')) return new Response(Buffer.from('mp4'));
      if (String(url).endsWith('/media')) return json({ media_id: '987', upload_url: 'https://pinterest-media-upload.s3-accelerate.amazonaws.com/', upload_parameters: { key: 'test' } });
      if (String(url).includes('amazonaws.com')) return new Response(null, { status: 204 });
      if (String(url).endsWith('/media/987')) { await G.registerContentVersion(db, { ...content, hook: 'Changed after approval' }); return json({ status: 'succeeded' }); }
      pins++; return json({ id: '123456' });
    } });
    const result = await publishAll(db, { master: m, variants, publishers: [p], origin: 'topic_pipeline' });
    assert.equal(pins, 0); assert.equal(result.outcomes[0].status, 'blocked');
  } finally { restore(); await db.close(); }
});
